/**
 * Browser-use provider for the Web testing application. It exposes the controlled
 * Host↔Main automation channel as observe, screenshot, element input, restricted navigation, and reload tools, and
 * nothing else: the channel has no script evaluation, no DevTools command, and no route
 * to a second target, so a model driving it cannot obtain an arbitrary CDP channel.
 *
 * The provider owns no browser. Every command is submitted to the one target its Host
 * generation owns, and the Main decides whether that command may act. Tool results
 * distinguish confirmed non-execution from unknown outcomes that may have changed the page.
 * @module @deepseek-ai/dsh-experimental-browser-use-web-test
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import type {
  DesktopBrowserCommandBody,
  DesktopBrowserCommandResult,
  DesktopBrowserDenialReason,
  DesktopBrowserControl,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { SessionResources } from '@deepseek-ai/dsh-experimental-browser-use-runtime'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WebTestBrowserAutomationConfig } from './types.ts'
// Type-only: resolves the `agents`, `browserUse`, `tools`, and `webTest` declarations
// this provider injects. The agent declaration arrives from the tool runtime.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-browser-use'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-web-test'
import type {} from '@deepseek-ai/dsh-web-test-policy'

export type * from './types.ts'
export { DesktopBrowserExecutionGroups } from './group-execution.ts'
export type { BrowserRoleExecutor } from './group-execution.ts'

/** Cordis identity for the Web testing browser automation provider. */
export const name = 'web-test-browser-automation'

/** Services this provider consumes: the exclusive browser-use slot, Agents, tools, and availability. */
export const inject = ['browserUse', 'agents', 'tools', 'webTest']

/** Provider name recorded in the exclusive browser-use slot. */
const PROVIDER_NAME = 'web-test-browser'

/** Label used in this provider's lifecycle diagnostics. */
const LABEL = 'web-test-browser-automation'

/** Entry point whose availability this provider owns. */
export const ENTRY_POINT = 'web-test.browser-automation'

/** Profile-owned wiring for the controlled channel. */
export type Config = WebTestBrowserAutomationConfig

/** Loader validation for the one profile-owned field. */
export const Config: Schema<WebTestBrowserAutomationConfig> = Schema.object({
  controlled: Schema.boolean().default(false),
})

/**
 * What each denial means for the model that issued the command. A refusal is always one
 * of these; the provider never reports an admission decision as a tool failure.
 */
const REFUSALS = {
  'session-not-authorized': 'This Session has no explicit permission to control the test page. Ask for its browser target to be bound before using browser tools.',
  'unknown-operation': 'The browser channel does not offer that operation, so nothing was run.',
  'wrong-target': 'The test page this Session controls is not the one the browser channel serves, so nothing was run.',
  'stale-observation': 'The page changed after your most recent observation, so that element reference no longer describes it. Run web_browser_observe again and act on a reference from that observation.',
  'epoch-mismatch': 'The browser session was replaced, so this command addressed a previous one. Run web_browser_observe again.',
  'revoked': 'The test page was closed, so nothing can act on it. Ask for the page to be opened again.',
  'navigation-denied': 'Navigation may change only the query or fragment of the currently observed test page. Its origin and pathname must stay the same, and the destination must satisfy the browser permission rules.',
  'action-failed': 'The browser could not validate the action, so it was not executed. Run web_browser_observe again to see the page as it is now.',
} satisfies Record<DesktopBrowserDenialReason, string>

const UNKNOWN_OUTCOME = 'The browser command outcome is unknown. The action may already have changed the page. '
  + 'Check the page and the business result before deciding whether to repeat the action.'

/** The correlated success branch of one command result. */
type AcceptedResult = Extract<DesktopBrowserCommandResult, { readonly ok: true }>

type AutomationConnection = DesktopBrowserControl

/**
 * Submit for the calling Agent's explicitly bound Session, preserving its admitted
 * target while earlier commands settle. The Host service validates wire correlation.
 * @param resources - live Agent admission and command serialization.
 * @param exec - the tool execution, which names the calling Agent and its cancellation.
 * @param body - one of the allowlisted operations the channel allows.
 * @returns the result the Main accepted for this exact request.
 */
async function send(
  resources: SessionResources<AutomationConnection>,
  exec: ToolRunContext,
  body: DesktopBrowserCommandBody,
): Promise<AcceptedResult> {
  const agent = exec.agent
  if (agent === undefined) {
    throw new Error(`${LABEL} tools require the Session that owns the test page`)
  }
  const owner = agent.ctx.get('desktopBrowserControl')
  const admittedBinding = owner?.binding(agent.session.id)
  if (admittedBinding === undefined) throw new Error(REFUSALS['session-not-authorized'])
  return resources.run(agent, exec.signal, async (channel, signal) => {
    signal.throwIfAborted()
    const control = exec.agent?.ctx.get('desktopBrowserControl')
    const binding = control?.binding(agent.session.id)
    if (control === undefined || binding === undefined
      || binding.target !== admittedBinding.target || binding.hostEpoch !== admittedBinding.hostEpoch) {
      throw new Error(REFUSALS['session-not-authorized'])
    }
    let result: DesktopBrowserCommandResult
    try { result = await channel.submit(agent.session.id, body, signal) }
    catch (_error) { throw new Error(UNKNOWN_OUTCOME) }
    if (!result.ok) throw new Error(result.outcome === 'unknown' ? UNKNOWN_OUTCOME : REFUSALS[result.reason])
    const observation = result.observation
    if (observation !== undefined && (observation.target !== binding.target || observation.hostEpoch !== binding.hostEpoch)) {
      throw new Error(UNKNOWN_OUTCOME)
    }
    return result
  })
}

/** Element projection shared by the observation schema and the model's rendering. */
const ELEMENT_PROPERTIES = {
  ref: { type: 'string', required: true, description: 'Reference to pass back in a click or type command.' },
  role: { type: 'string', required: true, description: 'Element kind, for example button or textbox.' },
  name: { type: 'string', required: true, description: 'Accessible name, empty when the page exposes none.' },
  x: { type: 'number', required: true, description: 'Left edge in CSS pixels relative to the document.' },
  y: { type: 'number', required: true, description: 'Top edge in CSS pixels relative to the document.' },
  width: { type: 'number', required: true, description: 'Element width in CSS pixels.' },
  height: { type: 'number', required: true, description: 'Element height in CSS pixels.' },
} as const

/** Schema of the two commands that act on one element of an observation. */
const ELEMENT_ACTION_PROPERTIES = {
  ref: { type: 'string', required: true, description: 'Element reference from your most recent observation.' },
  generation: { type: 'integer', required: true, description: 'Page generation that observation reported.' },
} as const

/** Shared card title so a pending call reads as the action it will perform. */
function pending(title: string, rawInput: unknown): ToolCallView {
  return { card: 'generic', title, kind: 'other', rawInput }
}

/**
 * Register tools and retain the browser-use reservation through quiescent teardown.
 * The Host service owns exclusive Session bindings independently of this registration.
 * @param ctx - context providing the browser-use slot, Agents, tools, and availability.
 * @param resources - live Agent admission and command serialization.
 */
function mountTools(
  ctx: Context,
  resources: SessionResources<AutomationConnection>,
): void {
  ctx.tools.register(defineTool({
    name: 'web_browser_observe',
    description: 'Read the test page this Session controls: its address, its title, and the elements you can act on, '
      + 'each with the reference a click or type command needs. Every observation starts a new page generation, so act '
      + 'only on references from the most recent one.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          generation: { type: 'integer', required: true },
          elements: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: false, properties: ELEMENT_PROPERTIES },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Test page "${value.title}" at ${value.url}, page generation ${value.generation}.`,
          ...value.elements.map(element => `- ${element.ref} ${element.role} "${element.name}"`),
        ].join('\n'),
      }],
    },
    async execute(_args, exec) {
      const observation = (await send(resources, exec, { kind: 'observe' })).observation
      if (observation === undefined) throw new Error('The browser channel accepted the observation and returned none')
      return {
        url: observation.url,
        title: observation.title,
        generation: observation.generation,
        elements: observation.elements.map(element => ({
          ref: element.ref,
          role: element.role,
          name: element.name,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        })),
      }
    },
    presentCall: () => pending('Observe the test page', {}),
  }))

  ctx.tools.register(defineTool({
    name: 'web_browser_screenshot',
    description: 'Capture the test page this Session controls as a PNG image, for reading a page whose elements the '
      + 'observation does not name.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', required: true },
          hostEpoch: { type: 'integer', required: true },
          image: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
              originalDimensions: {
                type: 'object', additionalProperties: false,
                properties: {
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Captured the test page at ${value.image.width}×${value.image.height} pixels, target ${value.target}, Host epoch ${value.hostEpoch}.` },
        { type: 'image', attachment: { ...value.image, attachmentId: AttachmentId(value.image.attachmentId) } },
      ],
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error(`${LABEL} tools require the Session that owns the test page`)
      const admitted = agent.ctx.get('desktopBrowserControl')?.binding(agent.session.id)
      if (admitted === undefined) throw new Error(REFUSALS['session-not-authorized'])
      return resources.run(agent, exec.signal, async (channel, signal) => {
        signal.throwIfAborted()
        const current = channel.binding(agent.session.id)
        if (current === undefined || current.target !== admitted.target || current.hostEpoch !== admitted.hostEpoch) {
          throw new Error(REFUSALS['session-not-authorized'])
        }
        const routed = agent.session.requestHeader()?.config
        const provider = routed?.provider ?? agent.options.provider
        const model = routed?.model ?? agent.options.model
        const llm = agent.ctx.get('llm')
        if (provider === undefined || model === undefined || llm === undefined) throw new Error('Screenshot requires a resolved image-capable model route')
        const info = await llm.resolveModelInfo(provider, model, signal)
        signal.throwIfAborted()
        if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
          throw new Error('Screenshot requires a model route that declares image input')
        }
        const routedBinding = channel.binding(agent.session.id)
        if (routedBinding === undefined || routedBinding.target !== admitted.target || routedBinding.hostEpoch !== admitted.hostEpoch) {
          throw new Error(REFUSALS['session-not-authorized'])
        }
        const policy = agent.ctx.get('webTestPolicy')
        if (policy === undefined) throw new Error('Screenshot requires the Web testing capture policy')
        const captured = await policy.captureBrowserScreenshot(agent.session.id, signal)
        signal.throwIfAborted()
        const finalBinding = channel.binding(agent.session.id)
        if (finalBinding === undefined || finalBinding.target !== admitted.target || finalBinding.hostEpoch !== admitted.hostEpoch
          || captured.target !== admitted.target || captured.hostEpoch !== admitted.hostEpoch) throw new Error(UNKNOWN_OUTCOME)
        return captured
      })
    },
    presentCall: () => pending('Capture the test page', {}),
  }))

  ctx.tools.register(defineTool({
    name: 'web_browser_click',
    description: 'Click one element of the test page this Session controls. Take the reference and the page generation '
      + 'from your most recent observation; a reference from an older generation is refused, because the page may have '
      + 'moved. Observe the page again afterwards to see what changed.',
    parameters: ELEMENT_ACTION_PROPERTIES,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          generation: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Clicked ${value.ref}, taken from page generation ${value.generation}. Observe the page again to see the result.`,
      }],
    },
    async execute(args, exec) {
      await send(resources, exec, { kind: 'click', ref: args.ref, generation: args.generation })
      return { ref: args.ref, generation: args.generation }
    },
    presentCall: args => pending('Click a test page element', args),
  }))

  ctx.tools.register(defineTool({
    name: 'web_browser_type',
    description: 'Type text into one element of the test page this Session controls. Take the reference and the page '
      + 'generation from your most recent observation; a reference from an older generation is refused, because the page '
      + 'may have moved. Observe the page again afterwards to see the result.',
    parameters: {
      ...ELEMENT_ACTION_PROPERTIES,
      text: { type: 'string', required: true, description: 'Text to type into the element.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          generation: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Typed into ${value.ref}, taken from page generation ${value.generation}. Observe the page again to see the result.`,
      }],
    },
    async execute(args, exec) {
      await send(resources, exec, { kind: 'type', ref: args.ref, generation: args.generation, text: args.text })
      return { ref: args.ref, generation: args.generation }
    },
    presentCall: args => pending('Type into a test page element', args),
  }))

  ctx.tools.register(defineTool({
    name: 'web_browser_double_click',
    description: 'Double-click an element from your most recent observation to enter its editing mode. Observe again afterwards.',
    parameters: ELEMENT_ACTION_PROPERTIES,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { generation: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Double-click a test page element from page generation ${value.generation}. Observe the page again to see the result.`,
      }],
    },
    async execute(args, exec) {
      await send(resources, exec, { kind: 'double-click', ref: args.ref, generation: args.generation })
      return { generation: args.generation }
    },
    presentCall: args => pending('Double-click a test page element', args),
  }))

  ctx.tools.register(defineTool({
    name: 'web_browser_press_key',
    description: 'Focus an element from your most recent observation and press one allowed key, such as Enter to submit. Observe again afterwards.',
    parameters: { ...ELEMENT_ACTION_PROPERTIES, key: { type: 'string', required: true, enum: ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const, description: 'Native key to press after focusing the element.' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { generation: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Press a key in a test page element from page generation ${value.generation}. Observe the page again to see the result.`,
      }],
    },
    async execute(args, exec) {
      await send(resources, exec, { kind: 'press-key', ref: args.ref, generation: args.generation, key: args.key })
      return { generation: args.generation }
    },
    presentCall: args => pending('Press a key in a test page element', args),
  }))

  ctx.tools.register(defineTool({
    name: 'web_browser_navigate',
    description: 'Change the query or fragment of the currently observed test page. The origin and pathname must remain the same. Observe again after navigation.',
    parameters: { generation: ELEMENT_ACTION_PROPERTIES.generation, url: { type: 'string', required: true, description: 'Absolute URL with the same origin and pathname as the current observation.' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { generation: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Navigate within the test page from page generation ${value.generation}. Observe the page again to see the result.`,
      }],
    },
    async execute(args, exec) {
      await send(resources, exec, { kind: 'navigate', generation: args.generation, url: args.url })
      return { generation: args.generation }
    },
    presentCall: args => pending('Navigate within the test page', args),
  }))

  ctx.tools.register(defineTool({
    name: 'web_browser_reload',
    description: 'Reload the currently observed test page. The old generation and references become invalid immediately. Observe again after the page finishes loading.',
    parameters: { generation: ELEMENT_ACTION_PROPERTIES.generation },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { generation: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Reload the test page from page generation ${value.generation}. Observe the page again to see the result.`,
      }],
    },
    async execute(args, exec) {
      await send(resources, exec, { kind: 'reload', generation: args.generation })
      return { generation: args.generation }
    },
    presentCall: args => pending('Reload the test page', args),
  }))
}

/**
 * Mount the Web testing browser automation provider, or leave the capability unmounted
 * when the deployment supplies no controlled channel. Unmounted is not a failing
 * control: nothing is registered, the entry point reads unavailable, and the exclusive
 * browser-use slot stays free for the provider this application did not take.
 * @param ctx - context providing the browser-use slot, Agents, tools, and availability.
 * @param input - profile-owned wiring for the controlled channel.
 */
export function apply(ctx: Context, input: WebTestBrowserAutomationConfig): void {
  const config = Config(input)
  if (!config.controlled) {
    ctx.logger.info(`[web-test] ${LABEL} is not mounted: controlled browser tools are disabled`)
    return
  }
  ctx.inject(['desktopBrowserControl'], (host) => {
    host.effect(function* () {
      yield host.browserUse.register(BrowserUseProviderName(PROVIDER_NAME))
      yield host.webTest.mount(ENTRY_POINT)
      const resources = new SessionResources<AutomationConnection>(host, {
        label: LABEL,
        exclusive: false,
        open(agent, signal) {
          signal.throwIfAborted()
          const binding = host.desktopBrowserControl.binding(agent.session.id)
          if (binding === undefined) throw new Error(REFUSALS['session-not-authorized'])
          return Promise.resolve({ value: host.desktopBrowserControl, close: () => Promise.resolve() })
        },
      })
      yield () => resources.dispose()
      const child = host.plugin({
        name: `${name}-tools`,
        inject: ['tools'],
        apply(inner) { mountTools(inner, resources) },
      })
      yield child.dispose
    }, `${LABEL}.provider`)
  })
}
