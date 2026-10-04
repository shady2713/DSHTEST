/**
 * The contract's Remote surface reached the way a Client reaches it: over the
 * real Typert Registry, the real Host Gateway, and the real Connection RPC
 * handler, driven by the same `createWebConnectionRpc` caller the browser
 * client uses. Nothing here calls a service method directly, so a passing
 * result shows the generated descriptor, the wire framing, and the Host's own
 * validation all agree.
 */
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/browser-auth'
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/client/rpc'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebTestContracts } from '../src/index.ts'

const CONTRACT_NS = 'webTestContracts'
const CHANNEL = '/api'

/** A well-formed project registration, trimmed and branded by the Host. */
const REGISTRATION = {
  commandId: 'cmd-register-1',
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrls: ['http://localhost:3000/checkout'],
}

/** An environment the user confirmed, covering every registered code root. */
const DECLARATION = {
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrl: 'http://localhost:3000/checkout',
  isTestEnvironment: true,
  login: { state: 'not-required' },
  supplementaryRequirements: [],
}

let ctx: Context
let rpc: ReturnType<typeof createWebConnectionRpc>

/**
 * Call one contract method as the generated Client would, over the real carrier.
 * @param method - endpoint method name under the contract namespace.
 * @param args - named arguments keyed by the Service Definition's parameter names.
 * @returns the Remote result, which carries either the value or the failure.
 */
async function call(method: string, args: Record<string, unknown>): Promise<{ ok: boolean; value?: unknown; error?: unknown }> {
  return rpc.call(CHANNEL, `${CONTRACT_NS}/${method}`, { args })
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGateway)
  // Constructing the service registers it; the operator peer is the admitted
  // identity for this in-process call, and the process-token exchange belongs
  // to the browser transport rather than this carrier.
  new HostConnectionService(ctx, [], {} as BrowserAuth)
  await ctx.plugin(WebTestContracts)
  const handler = (ctx.get('connection') as HostConnectionService).createSharedFetchHandler(CHANNEL)
  rpc = createWebConnectionRpc(async (path, init) => handler.fetch(new Request(new URL(path, 'http://host'), init)))
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('contract Remote over the real Gateway and Connection carrier', () => {
  it('serves a valid project registration to a Client caller', async () => {
    expect(await call('registerProject', { request: REGISTRATION })).toEqual({
      ok: true,
      value: {
        commandId: 'cmd-register-1',
        codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
        entryUrls: ['http://localhost:3000/checkout'],
      },
    })
  })

  it('serves a domain record submission with its expected revision', async () => {
    expect(await call('submitRecord', { request: {
      commandId: 'cmd-submit-7',
      recordId: `record-${'0'.repeat(32)}`,
      expectedRevision: 3,
    } })).toEqual({
      ok: true,
      value: {
        commandId: 'cmd-submit-7',
        recordId: `record-${'0'.repeat(32)}`,
        expectedRevision: 3,
      },
    })
  })

  it('serves a confirmed environment declaration', async () => {
    expect(await call('confirmEnvironmentDeclaration', { declaration: DECLARATION })).toEqual({
      ok: true,
      value: DECLARATION,
    })
  })

  it('serves a policy evaluation that admits an in-scope request and refuses one outside it', async () => {
    const inScope = await call('evaluatePolicy', {
      request: {
        projectId: `project-${'a'.repeat(32)}`,
        subject: 'read-checkout-total',
        targetPath: 'C:\\projects\\shop\\src\\cart.ts',
      },
      declaration: DECLARATION,
    })
    expect(inScope).toEqual({
      ok: true,
      value: { allowed: true, reason: 'allowed-in-scope', subject: 'read-checkout-total' },
    })

    const outside = await call('evaluatePolicy', {
      request: {
        projectId: `project-${'a'.repeat(32)}`,
        subject: 'write-checkout-total',
        targetPath: 'C:\\other-project\\src\\cart.ts',
      },
      declaration: DECLARATION,
    })
    expect(outside).toEqual({
      ok: true,
      value: { allowed: false, reason: 'denied-outside-scope', subject: 'C:\\other-project\\src\\cart.ts' },
    })
  })

  it('refuses a production environment before any target path is considered', async () => {
    expect(await call('evaluatePolicy', {
      request: {
        projectId: `project-${'a'.repeat(32)}`,
        subject: 'read-checkout-total',
        targetPath: 'C:\\projects\\shop\\src\\cart.ts',
      },
      declaration: { ...DECLARATION, isTestEnvironment: false },
    })).toEqual({
      ok: true,
      value: { allowed: false, reason: 'denied-outside-scope', subject: 'read-checkout-total' },
    })
  })

  it('serves an environment confirmation carrying both branded identities', async () => {
    expect(await call('confirmEnvironment', {
      request: {
        projectId: `project-${'b'.repeat(32)}`,
        commandId: 'cmd-confirm-2',
        declaration: DECLARATION,
      },
    })).toEqual({
      ok: true,
      value: {
        projectId: `project-${'b'.repeat(32)}`,
        commandId: 'cmd-confirm-2',
        declaration: DECLARATION,
      },
    })
  })

  it('carries a field-naming rejection back to the Client unchanged', async () => {
    const result = await call('registerProject', { request: { ...REGISTRATION, codeRoots: [42] } })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'web-test/invalid-field',
        details: { field: 'codeRoots[0]', reason: 'must be a string' },
      },
    })
  })

  it('refuses an endpoint this Service Definition does not declare', async () => {
    await expect(call('deleteEverything', { request: REGISTRATION }))
      .rejects.toThrow('HTTP 404')
  })

  it('releases the service when its fiber is disposed', async () => {
    const own = new Context()
    const fiber = await own.plugin(WebTestContracts)
    expect(own.get(CONTRACT_NS)).toBeInstanceOf(WebTestContracts)
    await fiber.dispose()
    expect(own.get(CONTRACT_NS)).toBeUndefined()
  })
})

/** Evaluation a Client receives when the confirmed declaration covers the request. */
const ADMITTED = {
  ok: true,
  value: { allowed: true, reason: 'allowed-in-scope', subject: 'read-checkout-total' },
}

/**
 * Evaluate one read action against a declaration over the real carrier.
 * @param targetPath - absolute path the action would touch, or `null` for an action that touches none.
 * @param codeRoots - absolute code roots the declaration covers.
 * @returns the Remote result, carrying either the evaluation or the failure.
 */
async function evaluate(
  targetPath: string | null,
  codeRoots: string[],
): Promise<{ ok: boolean; value?: unknown; error?: unknown }> {
  return call('evaluatePolicy', {
    request: {
      projectId: `project-${'a'.repeat(32)}`,
      subject: 'read-checkout-total',
      targetPath,
    },
    declaration: { ...DECLARATION, codeRoots },
  })
}

describe('code-root scope boundary over the real carrier', () => {
  it('admits a path beneath the confirmed code root', async () => {
    expect(await evaluate('C:\\projects\\shop\\src\\cart.ts', ['C:\\projects\\shop'])).toEqual(ADMITTED)
  })

  it('admits a path beneath a code root no other declared root covers', async () => {
    // The declaration covers both trees, so the second one is in scope on its
    // own account rather than by falling inside the first.
    expect(await evaluate('C:\\projects\\shop-api\\src\\cart.ts', ['C:\\projects\\shop', 'C:\\projects\\shop-api']))
      .toEqual(ADMITTED)
  })

  it('admits the confirmed code root itself', async () => {
    expect(await evaluate('C:\\projects\\shop', ['C:\\projects\\shop'])).toEqual(ADMITTED)
  })

  it('refuses a sibling directory whose name only starts with the code root', async () => {
    expect(await evaluate('C:\\projects\\shop-evil\\src\\cart.ts', ['C:\\projects\\shop', 'C:\\projects\\shop-api'])).toEqual({
      ok: true,
      value: {
        allowed: false,
        reason: 'denied-outside-scope',
        subject: 'C:\\projects\\shop-evil\\src\\cart.ts',
      },
    })
  })

  it('admits a path beneath a code root the user left a trailing separator on', async () => {
    expect(await evaluate('C:\\projects\\shop\\src\\cart.ts', ['C:\\projects\\shop\\'])).toEqual(ADMITTED)
  })

  it('admits a path spelled with the other separator, which Windows resolves the same', async () => {
    expect(await evaluate('C:/projects/shop/src/cart.ts', ['C:\\projects\\shop'])).toEqual(ADMITTED)
  })

  it('admits any absolute path beneath a bare POSIX mount-point root', async () => {
    expect(await evaluate('/srv/app/index.ts', ['/'])).toEqual(ADMITTED)
  })

  it('admits an action that touches no path', async () => {
    expect(await evaluate(null, ['C:\\projects\\shop'])).toEqual(ADMITTED)
  })
})
