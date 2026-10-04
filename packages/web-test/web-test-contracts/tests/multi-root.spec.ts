/**
 * A project may declare several code roots, and the declaration carries the
 * login fact and the requirements the user added on top of them.
 *
 * The cases here cover the widening itself — several roots admitted, one record
 * per root, a refusal naming the element that broke a bound — and the scope rule
 * that follows from it: a target is covered when any declared root covers it,
 * and covering a second root widens nothing beyond what the user declared.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import {
  parseConfirmEnvironmentRequest,
  parseEnvironmentDeclaration,
  parseRegisterProjectRequest,
} from '../src/parse.ts'
import type { WebTestErrorCode } from '../src/errors.ts'
import {
  MAX_CODE_ROOTS,
  MAX_PATH_LENGTH,
  MAX_REQUIREMENT_LENGTH,
  MAX_SUPPLEMENTARY_REQUIREMENTS,
  type EnvironmentDeclaration,
  type RegisterProjectRequest,
} from '../src/records.ts'
import { WebTestContracts } from '../src/index.ts'

/** A multi-root registration the parsers accept, mutated per case. */
const REGISTRATION = {
  commandId: 'cmd-1',
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrls: ['http://localhost:3000/checkout', 'http://localhost:4000/cart'],
} satisfies RegisterProjectRequest

/** A multi-root declaration the parsers accept, mutated per case. */
const DECLARATION = {
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrl: 'http://localhost:3000/checkout',
  isTestEnvironment: true,
  login: { state: 'not-required' } as const,
  supplementaryRequirements: ['never touch the payment provider sandbox'],
} satisfies EnvironmentDeclaration

/**
 * The Remote failures this contract raises, taken out of the whole union.
 *
 * `Extract` selects the existing members rather than restating them: the
 * protocol models `RemoteFailure` as one branch per code, so a predicate type
 * built by merging the web-test codes into a single `RemoteError` is not a
 * member of it and the predicate is rejected.
 */
type WebTestFailure = Extract<RemoteFailure, { readonly code: WebTestErrorCode }>

/**
 * Whether one Remote failure is one this contract raises.
 *
 * The contract extends the protocol's merge-extensible details map, so a
 * consumer discriminates on `code` and reads `details.field` with no cast. The
 * predicate narrows the failure itself rather than its `code` field: narrowing
 * a discriminant property does not carry to the object holding it, which is
 * why a `startsWith` test left `details` as the whole union.
 * @param failure - failure read from the thrown Remote error.
 * @returns true when this contract raised the failure.
 */
function isWebTestFailure(failure: RemoteFailure): failure is WebTestFailure {
  return failure.code === 'web-test/invalid-field'
    || failure.code === 'web-test/missing-field'
    || failure.code === 'web-test/unknown-field'
}

/**
 * Read the code and field a rejected request produced.
 * @param operation - the parse under test.
 * @returns the failure code and the field it named.
 */
function rejection(operation: () => unknown): { code: string; field: string } {
  try {
    operation()
  } catch (error: unknown) {
    const failure = remoteErrorOf(error)
    if (failure === undefined) throw error
    if (!isWebTestFailure(failure)) throw error
    return { code: failure.code, field: failure.details.field }
  }
  throw new Error('expected the request to be rejected')
}

describe('multiple code roots on a registration', () => {
  it('admits every declared root and keeps their order', () => {
    expect(parseRegisterProjectRequest(REGISTRATION).codeRoots)
      .toEqual(['C:\\projects\\shop', 'C:\\projects\\shop-api'])
  })

  it('trims each declared root', () => {
    expect(parseRegisterProjectRequest({ ...REGISTRATION, codeRoots: ['  C:\\projects\\shop  '] }).codeRoots)
      .toEqual(['C:\\projects\\shop'])
  })

  it('names a project that declares no code root at all', () => {
    // A project with no tree is not a project, so an empty list is refused
    // rather than registered as a project that can touch nothing.
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, codeRoots: [] })))
      .toEqual({ code: 'web-test/invalid-field', field: 'codeRoots' })
  })

  it('names the first root that has no slot when the list is over-full', () => {
    // The bound is reported against the element past the limit, not the field
    // alone, so a caller adding roots one at a time learns which one to drop.
    const codeRoots = Array.from({ length: MAX_CODE_ROOTS + 1 }, (_, index) => `C:\\projects\\root-${String(index)}`)
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, codeRoots })))
      .toEqual({ code: 'web-test/invalid-field', field: `codeRoots[${String(MAX_CODE_ROOTS)}]` })
  })

  it('accepts exactly the number of roots the bound allows', () => {
    const codeRoots = Array.from({ length: MAX_CODE_ROOTS }, (_, index) => `C:\\projects\\root-${String(index)}`)
    expect(parseRegisterProjectRequest({ ...REGISTRATION, codeRoots }).codeRoots).toHaveLength(MAX_CODE_ROOTS)
  })

  it('names the element index of a non-string root', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, codeRoots: ['C:\\a', 7] })))
      .toEqual({ code: 'web-test/invalid-field', field: 'codeRoots[1]' })
  })

  it('names the element index of a blank root', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, codeRoots: ['C:\\a', '   '] })))
      .toEqual({ code: 'web-test/invalid-field', field: 'codeRoots[1]' })
  })

  it('names the element index of an over-long root, checking each element', () => {
    expect(rejection(() => parseRegisterProjectRequest({
      ...REGISTRATION,
      codeRoots: ['C:\\'.padEnd(MAX_PATH_LENGTH + 2, 'x')],
    }))).toEqual({ code: 'web-test/invalid-field', field: 'codeRoots[0]' })
  })

  it('names a hole in the root list by its element index', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, codeRoots: [undefined] })))
      .toEqual({ code: 'web-test/missing-field', field: 'codeRoots[0]' })
  })

  it('names a root list that is not an array', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, codeRoots: 'C:\\projects\\shop' })))
      .toEqual({ code: 'web-test/invalid-field', field: 'codeRoots' })
  })

  it('names the singular field the schema no longer defines', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, codeRoot: 'C:\\projects\\shop' })))
      .toEqual({ code: 'web-test/unknown-field', field: 'codeRoot' })
  })
})

describe('login and supplementary requirements in a declaration', () => {
  it('carries every declared root with the login and the added requirements', () => {
    expect(parseEnvironmentDeclaration(DECLARATION, 'declaration')).toEqual({
      codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
      entryUrl: 'http://localhost:3000/checkout',
      isTestEnvironment: true,
      login: { state: 'not-required' },
      supplementaryRequirements: ['never touch the payment provider sandbox'],
    })
  })

  it('records a login the user stated the environment requires', () => {
    expect(parseEnvironmentDeclaration({
      ...DECLARATION, login: { state: 'required', accountLabel: 'qa@example.test' },
    }, 'declaration').login).toEqual({ state: 'required', accountLabel: 'qa@example.test' })
  })

  it('names a login state the declaration does not define', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, login: { state: 'maybe' } }, 'declaration')))
      .toEqual({ code: 'web-test/invalid-field', field: 'declaration.login.state' })
  })

  it('names a login that is not a record', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, login: 'required' }, 'declaration')))
      .toEqual({ code: 'web-test/invalid-field', field: 'declaration.login' })
  })

  it('names a branch inside the login the declaration does not define', () => {
    expect(rejection(() => parseEnvironmentDeclaration({
      ...DECLARATION, login: { state: 'not-required', password: 'x' },
    }, 'declaration'))).toEqual({ code: 'web-test/unknown-field', field: 'declaration.login.password' })
  })

  it('names a required login whose account the user did not name', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, login: { state: 'required' } }, 'declaration')))
      .toEqual({ code: 'web-test/missing-field', field: 'declaration.login.accountLabel' })
  })

  it('names the account label that is not a string', () => {
    expect(rejection(() => parseEnvironmentDeclaration({
      ...DECLARATION, login: { state: 'required', accountLabel: 7 },
    }, 'declaration'))).toEqual({ code: 'web-test/invalid-field', field: 'declaration.login.accountLabel' })
  })

  it('accepts a declaration the user added no requirements to', () => {
    expect(parseEnvironmentDeclaration({ ...DECLARATION, supplementaryRequirements: [] }, 'declaration')
      .supplementaryRequirements).toEqual([])
  })

  it('names an over-long supplementary requirement by its element index', () => {
    expect(rejection(() => parseEnvironmentDeclaration({
      ...DECLARATION, supplementaryRequirements: ['x'.repeat(MAX_REQUIREMENT_LENGTH + 1)],
    }, 'declaration'))).toEqual({ code: 'web-test/invalid-field', field: 'declaration.supplementaryRequirements[0]' })
  })

  it('names the first requirement that has no slot when the list is over-full', () => {
    const supplementaryRequirements = Array.from(
      { length: MAX_SUPPLEMENTARY_REQUIREMENTS + 1 },
      (_, index) => `requirement ${String(index)}`,
    )
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, supplementaryRequirements }, 'declaration')))
      .toEqual({
        code: 'web-test/invalid-field',
        field: `declaration.supplementaryRequirements[${String(MAX_SUPPLEMENTARY_REQUIREMENTS)}]`,
      })
  })

  it('names a supplementary requirement list that is not an array', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, supplementaryRequirements: 'only cart' }, 'declaration')))
      .toEqual({ code: 'web-test/invalid-field', field: 'declaration.supplementaryRequirements' })
  })

  it('reads the widened declaration through a confirmation request', () => {
    const confirmation = parseConfirmEnvironmentRequest({
      projectId: `project-${'a'.repeat(32)}`,
      commandId: 'cmd-1',
      declaration: DECLARATION,
    })
    expect(confirmation.declaration.codeRoots).toHaveLength(2)
  })
})

describe('coverage across several declared roots', () => {
  /** The contract's own evaluation, reached without the Gateway carrier. */
  async function evaluate(targetPath: string, declaration: EnvironmentDeclaration = DECLARATION) {
    const ctx = new Context()
    const fiber = await ctx.plugin(WebTestContracts)
    const decision = ctx.webTestContracts.evaluatePolicy({
      projectId: `project-${'a'.repeat(32)}`,
      subject: 'read-cart',
      targetPath,
    }, declaration)
    await fiber.dispose()
    return decision
  }

  it('admits a path beneath the first declared root', async () => {
    expect(await evaluate('C:\\projects\\shop\\src\\cart.ts')).toMatchObject({ allowed: true })
  })

  it('admits a path beneath the second declared root', async () => {
    expect(await evaluate('C:\\projects\\shop-api\\src\\cart.ts')).toMatchObject({ allowed: true })
  })

  it('admits a declared root itself', async () => {
    expect(await evaluate('C:\\projects\\shop-api')).toMatchObject({ allowed: true })
  })

  it('refuses a path no declared root covers', async () => {
    // Declaring a second root widens coverage to that root and nothing else.
    expect(await evaluate('C:\\projects\\shop-evil\\src\\cart.ts'))
      .toMatchObject({ allowed: false, reason: 'denied-outside-scope' })
  })

  it('refuses a path outside every root the declaration names', async () => {
    const declaration = { ...DECLARATION, codeRoots: ['C:\\projects\\shop'] }
    expect(await evaluate('C:\\projects\\shop-api\\src\\cart.ts', declaration))
      .toMatchObject({ allowed: false, reason: 'denied-outside-scope' })
  })
})
