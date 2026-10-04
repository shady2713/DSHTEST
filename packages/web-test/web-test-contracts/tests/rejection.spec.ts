/**
 * Illegal input to each schema this package defines, asserting that the
 * rejection names the field it refused rather than failing generically.
 *
 * These cases exercise the parsers directly because that is where a wire value
 * is admitted; the [Remote round trip](remote.spec.ts) proves the same
 * rejections survive the carrier unchanged.
 */
import { describe, expect, it } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import {
  parseConfirmEnvironmentRequest,
  parseEnvironmentDeclaration,
  parseEvaluatePolicyRequest,
  parseRegisterProjectRequest,
  parseSubmitRecordRequest,
} from '../src/parse.ts'
import { MAX_ENTRY_URLS, MAX_PATH_LENGTH } from '../src/records.ts'

/** A registration the parsers accept, mutated per case. */
const REGISTRATION = {
  commandId: 'cmd-1',
  codeRoots: ['C:\\projects\\shop'],
  entryUrls: ['http://localhost:3000'],
}

/** A declaration the parsers accept, mutated per case. */
const DECLARATION = {
  codeRoots: ['C:\\projects\\shop'],
  entryUrl: 'http://localhost:3000',
  isTestEnvironment: true,
  login: { state: 'not-required' },
  supplementaryRequirements: [],
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
    // Every code this package raises carries a field, so a code outside the
    // package's own family is a defect in the test rather than an outcome.
    if (failure.code !== 'web-test/invalid-field'
      && failure.code !== 'web-test/missing-field'
      && failure.code !== 'web-test/unknown-field') {
      throw error
    }
    return { code: failure.code, field: failure.details.field }
  }
  throw new Error('expected the request to be rejected')
}

describe('project registration schema', () => {
  it('names a command token that does not match the command format', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, commandId: 'nope' })))
      .toEqual({ code: 'web-test/invalid-field', field: 'commandId' })
  })

  it('names a missing required field', () => {
    const { codeRoots: _codeRoots, ...withoutRoots } = REGISTRATION
    expect(rejection(() => parseRegisterProjectRequest(withoutRoots)))
      .toEqual({ code: 'web-test/missing-field', field: 'codeRoots' })
  })

  it('names a field the schema does not define', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, retries: 3 })))
      .toEqual({ code: 'web-test/unknown-field', field: 'retries' })
  })

  it('names an over-long code root by its element index', () => {
    expect(rejection(() => parseRegisterProjectRequest({
      ...REGISTRATION, codeRoots: ['C:\\'.padEnd(MAX_PATH_LENGTH + 2, 'x')],
    }))).toEqual({ code: 'web-test/invalid-field', field: 'codeRoots[0]' })
  })

  it('names the element index of a non-string entry URL', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, entryUrls: ['http://a', 7] })))
      .toEqual({ code: 'web-test/invalid-field', field: 'entryUrls[1]' })
  })

  it('names the element index of an over-long entry URL', () => {
    expect(rejection(() => parseRegisterProjectRequest({
      ...REGISTRATION,
      entryUrls: ['http://a', `http://${'x'.repeat(2100)}`],
    }))).toEqual({ code: 'web-test/invalid-field', field: 'entryUrls[1]' })
  })

  it('names a list holding more entry URLs than the schema allows', () => {
    const entryUrls = Array.from({ length: MAX_ENTRY_URLS + 1 }, (_, index) => `http://host/${String(index)}`)
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, entryUrls })))
      .toEqual({ code: 'web-test/invalid-field', field: 'entryUrls' })
  })

  it('names a non-array entry URL list', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, entryUrls: 'http://a' })))
      .toEqual({ code: 'web-test/invalid-field', field: 'entryUrls' })
  })

  it('names a blank entry URL', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, entryUrls: ['   '] })))
      .toEqual({ code: 'web-test/invalid-field', field: 'entryUrls[0]' })
  })

  it('accepts a project with no entry URL, which a project without a started URL has', () => {
    expect(parseRegisterProjectRequest({ ...REGISTRATION, entryUrls: [] }))
      .toMatchObject({ entryUrls: [] })
  })

  it('names an absent entry URL list', () => {
    const { entryUrls: _entryUrls, ...withoutUrls } = REGISTRATION
    expect(rejection(() => parseRegisterProjectRequest(withoutUrls)))
      .toEqual({ code: 'web-test/missing-field', field: 'entryUrls' })
  })

  it('names a hole in the entry URL list by its element index', () => {
    expect(rejection(() => parseRegisterProjectRequest({ ...REGISTRATION, entryUrls: [undefined] })))
      .toEqual({ code: 'web-test/missing-field', field: 'entryUrls[0]' })
  })
})

describe('domain record submission schema', () => {
  it('names a record identity that does not match the record format', () => {
    expect(rejection(() => parseSubmitRecordRequest({
      commandId: 'cmd-1', recordId: 'record-1', expectedRevision: 1,
    }))).toEqual({ code: 'web-test/invalid-field', field: 'recordId' })
  })

  it.each([0, -1, 1.5])('names an expected revision %j that is not a positive integer', (expectedRevision) => {
    expect(rejection(() => parseSubmitRecordRequest({
      commandId: 'cmd-1', recordId: `record-${'0'.repeat(32)}`, expectedRevision,
    }))).toEqual({ code: 'web-test/invalid-field', field: 'expectedRevision' })
  })

  it('names a non-numeric expected revision', () => {
    expect(rejection(() => parseSubmitRecordRequest({
      commandId: 'cmd-1', recordId: `record-${'0'.repeat(32)}`, expectedRevision: 'one',
    }))).toEqual({ code: 'web-test/invalid-field', field: 'expectedRevision' })
  })

  it('names an absent expected revision', () => {
    expect(rejection(() => parseSubmitRecordRequest({
      commandId: 'cmd-1', recordId: `record-${'0'.repeat(32)}`,
    }))).toEqual({ code: 'web-test/missing-field', field: 'expectedRevision' })
  })
})

describe('environment declaration schema', () => {
  it('names a non-boolean test-environment flag', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, isTestEnvironment: 'yes' }, 'declaration')))
      .toEqual({ code: 'web-test/invalid-field', field: 'declaration.isTestEnvironment' })
  })

  it('names a missing test-environment flag', () => {
    const { isTestEnvironment: _isTestEnvironment, ...withoutFlag } = DECLARATION
    expect(rejection(() => parseEnvironmentDeclaration(withoutFlag, 'declaration')))
      .toEqual({ code: 'web-test/missing-field', field: 'declaration.isTestEnvironment' })
  })

  it('names a branch inside the declaration the schema does not define', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, production: true }, 'declaration')))
      .toEqual({ code: 'web-test/unknown-field', field: 'declaration.production' })
  })

  it('names a non-string entry URL inside the declaration', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, entryUrl: 80 }, 'declaration')))
      .toEqual({ code: 'web-test/invalid-field', field: 'declaration.entryUrl' })
  })

  it('names a blank entry URL inside the declaration', () => {
    expect(rejection(() => parseEnvironmentDeclaration({ ...DECLARATION, entryUrl: '  ' }, 'declaration')))
      .toEqual({ code: 'web-test/invalid-field', field: 'declaration.entryUrl' })
  })

  it('names an over-long code root inside the declaration by its element index', () => {
    expect(rejection(() => parseEnvironmentDeclaration({
      ...DECLARATION, codeRoots: ['C:\\'.padEnd(MAX_PATH_LENGTH + 2, 'x')],
    }, 'declaration'))).toEqual({ code: 'web-test/invalid-field', field: 'declaration.codeRoots[0]' })
  })
})

describe('environment confirmation schema', () => {
  it('names a project identity that does not match the project format', () => {
    expect(rejection(() => parseConfirmEnvironmentRequest({
      projectId: 'project-1', commandId: 'cmd-1', declaration: DECLARATION,
    }))).toEqual({ code: 'web-test/invalid-field', field: 'projectId' })
  })

  it('names a declaration that is not a record', () => {
    expect(rejection(() => parseConfirmEnvironmentRequest({
      projectId: `project-${'a'.repeat(32)}`, commandId: 'cmd-1', declaration: 'shop',
    }))).toEqual({ code: 'web-test/invalid-field', field: 'declaration' })
  })

  it('names an array passed where the declaration record belongs', () => {
    expect(rejection(() => parseConfirmEnvironmentRequest({
      projectId: `project-${'a'.repeat(32)}`, commandId: 'cmd-1', declaration: [DECLARATION],
    }))).toEqual({ code: 'web-test/invalid-field', field: 'declaration' })
  })

  it('names an absent declaration record', () => {
    expect(rejection(() => parseConfirmEnvironmentRequest({
      projectId: `project-${'a'.repeat(32)}`, commandId: 'cmd-1',
    }))).toEqual({ code: 'web-test/missing-field', field: 'declaration' })
  })
})

describe('policy evaluation schema', () => {
  const REQUEST = {
    projectId: `project-${'a'.repeat(32)}`,
    subject: 'read-cart',
    targetPath: 'C:\\projects\\shop\\src\\cart.ts',
  }

  it('names a missing subject', () => {
    const { subject: _subject, ...withoutSubject } = REQUEST
    expect(rejection(() => parseEvaluatePolicyRequest(withoutSubject)))
      .toEqual({ code: 'web-test/missing-field', field: 'subject' })
  })

  it('names a blank subject', () => {
    expect(rejection(() => parseEvaluatePolicyRequest({ ...REQUEST, subject: '   ' })))
      .toEqual({ code: 'web-test/invalid-field', field: 'subject' })
  })

  it('names an over-long target path', () => {
    expect(rejection(() => parseEvaluatePolicyRequest({
      ...REQUEST, targetPath: 'C:\\'.padEnd(MAX_PATH_LENGTH + 2, 'x'),
    }))).toEqual({ code: 'web-test/invalid-field', field: 'targetPath' })
  })

  it('accepts a request with no target path, which a non-path action sends', () => {
    expect(parseEvaluatePolicyRequest({ ...REQUEST, targetPath: null }))
      .toMatchObject({ targetPath: null })
  })
})
