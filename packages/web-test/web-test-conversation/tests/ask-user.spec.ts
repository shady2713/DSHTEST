/**
 * The ask-user row this entry registers, proven against the definition the
 * official `tool-ask-user` plugin actually puts in the registry.
 *
 * The discriminator between the two definitions is the timed tool's own
 * `timeout` parameter: the blocking tool declares no wait at all, so a schema
 * that carries the parameter is the timed one and a schema that does not is the
 * blocking one. Every case below reads that real registered schema rather than
 * the mode this package resolved, so a row that resolved correctly but
 * registered the other definition would fail here.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { resolveAskUserMode } from '../src/index.ts'
import type { ConversationHarness } from './harness.ts'
import { startConversation } from './harness.ts'

let harness: ConversationHarness | undefined

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

/** The parameter names the question tool declares in the live registry. */
async function registeredParameters(config: Parameters<typeof startConversation>[0] = {}): Promise<string[]> {
  harness = await startConversation(config)
  const schema = harness.ctx.tools.get('ask_user_question')
  /* v8 ignore next -- the plugin registers the row during its own construction */
  if (schema === undefined) throw new Error('no ask_user_question definition is registered')
  return Object.keys(schema.parameters.properties ?? {})
}

describe('tool-ask-user mode registration', () => {
  it('registers the blocking tool when the row states no mode at all', async () => {
    expect(resolveAskUserMode({})).toEqual({ mode: 'legacy' })
    const parameters = await registeredParameters()
    expect(parameters).not.toContain('timeout')
  })

  it('registers the blocking tool for an explicit legacy mode', async () => {
    expect(resolveAskUserMode({ mode: 'legacy' })).toEqual({ mode: 'legacy' })
    const parameters = await registeredParameters({ config: { askUserMode: 'legacy' } })
    expect(parameters).not.toContain('timeout')
  })

  it('registers the timed tool, and its wait, only when the mode and the wait are both stated', async () => {
    expect(resolveAskUserMode({ mode: 'timed', timeout: 45 })).toEqual({ mode: 'timed', timeout: 45 })
    const parameters = await registeredParameters({ config: { askUserMode: 'timed', askUserTimeoutSeconds: 45 } })
    expect(parameters).toContain('timeout')
  })

  it('refuses a timed row with no wait, so no other package’s default is inherited silently', () => {
    expect(() => resolveAskUserMode({ mode: 'timed' })).toThrow('needs an explicit "timeout" in whole seconds')
  })

  it('refuses the indefinite timed row, which would still hold the foreground', () => {
    expect(() => resolveAskUserMode({ mode: 'timed', timeout: -1 }))
      .toThrow('keeps a blocking question and only keys the card by call id')
    expect(resolveAskUserMode({ mode: 'legacy' })).toEqual({ mode: 'legacy' })
  })

  it('refuses a wait the blocking tool would ignore', () => {
    expect(() => resolveAskUserMode({ mode: 'legacy', timeout: 30 }))
      .toThrow('the blocking ask_user_question tool reads no wait')
  })

  it('refuses a wait that is not a whole number of seconds in range', () => {
    expect(() => resolveAskUserMode({ mode: 'timed', timeout: 0 })).toThrow('whole number of seconds from 1')
    expect(() => resolveAskUserMode({ mode: 'timed', timeout: 2_147_484 })).toThrow('whole number of seconds from 1')
    expect(() => resolveAskUserMode({ mode: 'timed', timeout: 1.5 })).toThrow('whole number of seconds from 1')
  })

  it('fails a misconfigured row at load rather than registering the other definition', async () => {
    await expect(startConversation({ config: { askUserMode: 'timed' } }))
      .rejects.toThrow('needs an explicit "timeout" in whole seconds')
  })

  it('reports the mode it registered', async () => {
    harness = await startConversation({ config: { askUserMode: 'timed', askUserTimeoutSeconds: 90 } })
    expect(harness.conversation.askUserRegistration).toEqual({ mode: 'timed', timeout: 90 })
  })
})
