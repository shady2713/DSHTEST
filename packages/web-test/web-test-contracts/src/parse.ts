/**
 * Parsers turning a Remote request's raw fields into the branded records in
 * `./records.ts`.
 *
 * A request crosses a process boundary, so its values are read field by field
 * here. Each parser rejects an absent, malformed, or unrecognized field by name
 * rather than failing generically, so the caller learns what to correct. The
 * parsers are pure and hold no state: they admit a value or raise, and they
 * never persist, route a model request, or read the filesystem — persistence
 * and policy enforcement belong to the Runtime and the policy service.
 *
 * @module @deepseek-ai/dsh-web-test-contracts/parse
 */

import { invalidField, missingField } from './errors.ts'
import {
  readArray,
  readArrayString,
  readId,
  readRecord,
  readRevision,
  readString,
  rejectUnknownFields,
} from './fields.ts'
import {
  COMMAND_ID_PATTERN,
  MAX_CODE_ROOTS,
  MAX_ENTRY_URLS,
  MAX_PATH_LENGTH,
  MAX_REQUIREMENT_LENGTH,
  MAX_SUPPLEMENTARY_REQUIREMENTS,
  MAX_URL_LENGTH,
  PROJECT_ID_PATTERN,
  RECORD_ID_PATTERN,
  type EnvironmentDeclaration,
  type LoginDeclaration,
  type ValidatedEnvironmentConfirmation,
  type ValidatedPolicyRequest,
  type ValidatedProjectRegistration,
  type ValidatedRecordSubmission,
} from './records.ts'

/** Fields `parseRegisterProjectRequest` reads. */
const REGISTER_PROJECT_FIELDS = ['commandId', 'codeRoots', 'entryUrls'] as const

/** Fields `parseSubmitRecordRequest` reads. */
const SUBMIT_RECORD_FIELDS = ['commandId', 'recordId', 'expectedRevision'] as const

/** Fields `parseEvaluatePolicyRequest` reads. */
const EVALUATE_POLICY_FIELDS = ['projectId', 'subject', 'targetPath'] as const

/** Fields `parseConfirmEnvironmentRequest` reads. */
const CONFIRM_ENVIRONMENT_FIELDS = ['projectId', 'commandId', 'declaration'] as const

/** Fields of one declared environment. */
const DECLARATION_FIELDS = ['codeRoots', 'entryUrl', 'isTestEnvironment', 'login', 'supplementaryRequirements'] as const

/** Fields of the login branch that names no account. */
const LOGIN_NOT_REQUIRED_FIELDS = ['state'] as const

/** Fields of the login branch that names the account holding it. */
const LOGIN_REQUIRED_FIELDS = ['state', 'accountLabel'] as const

/** Every field either login branch declares, so an unknown branch is refused. */
const LOGIN_FIELDS = [...LOGIN_NOT_REQUIRED_FIELDS, ...LOGIN_REQUIRED_FIELDS]

/**
 * Read an optional URL or path field, treating an absent value as `null`.
 * @param source - record holding the field.
 * @param field - field name read from `source`.
 * @param path - dotted parent path used in the rejection.
 * @param limit - longest value this field accepts.
 * @returns the trimmed value, or `null` when the field is absent.
 */
function readOptionalBounded(
  source: Record<string, unknown>,
  field: string,
  path: string,
  limit: number,
): string | null {
  const value = source[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') invalidField(`${path}${field}`, 'must be a string')
  const trimmed = value.trim()
  if (trimmed === '') invalidField(`${path}${field}`, 'must not be empty')
  if (trimmed.length > limit) invalidField(`${path}${field}`, `must be at most ${String(limit)} characters`)
  return trimmed
}

/**
 * Read a boolean field, rejecting an absent or non-boolean value.
 * @param source - record holding the field.
 * @param field - field name read from `source`.
 * @param path - dotted parent path prefix used in the rejection.
 * @returns the boolean value.
 */
function readBoolean(source: Record<string, unknown>, field: string, path: string): boolean {
  const value = source[field]
  if (value === undefined) missingField(`${path}${field}`)
  if (typeof value !== 'boolean') invalidField(`${path}${field}`, 'must be a boolean')
  return value
}

/**
 * Read a bounded string array, rejecting a non-array, an over-long entry, and
 * an over-full list.
 * @param source - record holding the field.
 * @param field - field name read from `source`.
 * @param maxEntries - most entries this field accepts.
 * @param limit - longest single entry this field accepts.
 * @returns the trimmed entries.
 */
function readBoundedStringArray(
  source: Record<string, unknown>,
  field: string,
  maxEntries: number,
  limit: number,
): string[] {
  const items = readArray(source, field)
  if (items.length > maxEntries) invalidField(field, `must hold at most ${String(maxEntries)} entries`)
  return items.map((_, index) => {
    const value = readArrayString(items, index, field)
    if (value.length > limit) {
      invalidField(`${field}[${String(index)}]`, `must be at most ${String(limit)} characters`)
    }
    return value
  })
}

/**
 * Join a parent path and a child field into the dotted path a rejection names,
 * for the readers in `./fields.ts` that take a parent path without a trailing
 * separator.
 * @param path - parent path, empty at the request root.
 * @param field - child field name.
 * @returns the dotted path.
 */
function fieldPath(path: string, field: string): string {
  return path === '' ? field : `${path}.${field}`
}

/**
 * Read a bounded string list whose over-full case is reported against the first
 * element that has no slot.
 *
 * Naming that element rather than the field alone is what makes the bound
 * actionable: a caller adding entries one at a time learns which one broke it.
 * {@link readBoundedStringArray} reports the field instead, because an
 * over-full entry-URL list is a list the caller means to trim as a whole, while
 * a root list and a requirement list are assembled one entry at a time and the
 * entry past the limit is the one to drop.
 * @param source - record holding the field.
 * @param field - field name read from `source`.
 * @param path - dotted parent path used in the rejection.
 * @param maxEntries - most entries this field accepts.
 * @param limit - longest single entry this field accepts.
 * @param noun - what one entry is, named in the over-full message.
 * @returns the trimmed entries.
 */
function readIndexedStringList(
  source: Record<string, unknown>,
  field: string,
  path: string,
  maxEntries: number,
  limit: number,
  noun: string,
): string[] {
  const base = fieldPath(path, field)
  const items = readArray(source, field, path)
  if (items.length > maxEntries) {
    invalidField(`${base}[${String(maxEntries)}]`, `must hold at most ${String(maxEntries)} ${noun}`)
  }
  return items.map((_, index) => {
    const value = readArrayString(items, index, base)
    if (value.length > limit) {
      invalidField(`${base}[${String(index)}]`, `must be at most ${String(limit)} characters`)
    }
    return value
  })
}

/**
 * Read the code roots a project declares, refusing a project that declares
 * none: a project with no tree is not a project, and registering it would
 * produce a record that can touch nothing while looking like a real one.
 * @param source - record holding the field.
 * @param path - dotted parent path used in the rejection.
 * @returns the trimmed roots, at least one of them.
 */
function readCodeRoots(source: Record<string, unknown>, path: string): string[] {
  const roots = readIndexedStringList(source, 'codeRoots', path, MAX_CODE_ROOTS, MAX_PATH_LENGTH, 'code roots')
  if (roots.length === 0) invalidField(fieldPath(path, 'codeRoots'), 'must hold at least one code root')
  return roots
}

/**
 * Read the login a declaration carries, refusing a state the record does not
 * declare and a required login whose account the user did not name.
 * @param source - record holding the login fields.
 * @param path - dotted path of the login field.
 * @returns the declared login.
 * @throws a `web-test/*` failure naming the offending field.
 */
function parseLoginDeclaration(source: Record<string, unknown>, path: string): LoginDeclaration {
  rejectUnknownFields(source, LOGIN_FIELDS, path)
  const state = readString(source, 'state', path)
  if (state === 'not-required') {
    return { state }
  }
  if (state !== 'required') {
    invalidField(`${path}.state`, 'must be "not-required" or "required"')
  }
  return { state, accountLabel: readString(source, 'accountLabel', path) }
}

/**
 * Parse a project registration request, branding its command token and
 * bounding its code roots and entry URLs.
 * @param request - raw request record received from a caller.
 * @returns the validated request with branded identities and trimmed fields.
 * @throws a `web-test/*` failure naming the offending field.
 */
export function parseRegisterProjectRequest(
  request: Record<string, unknown>,
): ValidatedProjectRegistration {
  rejectUnknownFields(request, REGISTER_PROJECT_FIELDS)
  return {
    commandId: readId<'WebTestCommandId'>(request, 'commandId', COMMAND_ID_PATTERN),
    codeRoots: readCodeRoots(request, ''),
    entryUrls: readBoundedStringArray(request, 'entryUrls', MAX_ENTRY_URLS, MAX_URL_LENGTH),
  }
}

/**
 * Parse one environment declaration, rejecting an unknown branch inside it.
 *
 * The declaration covers every code root the project registered, so `codeRoots`
 * repeats the project's own list rather than naming one tree: a confirmation
 * that quietly covered a single root would leave the rest of the project
 * declared but unconfirmed, which is the state the user cannot act from.
 * @param source - record holding the declaration fields.
 * @param path - dotted path prefix of the declaration.
 * @returns the validated declaration.
 * @throws a `web-test/*` failure naming the offending field.
 */
export function parseEnvironmentDeclaration(
  source: Record<string, unknown>,
  path: string,
): EnvironmentDeclaration {
  rejectUnknownFields(source, DECLARATION_FIELDS, path)
  return {
    codeRoots: readCodeRoots(source, path),
    entryUrl: readOptionalBounded(source, 'entryUrl', `${path}.`, MAX_URL_LENGTH),
    isTestEnvironment: readBoolean(source, 'isTestEnvironment', `${path}.`),
    login: parseLoginDeclaration(readRecord(source, 'login', path), `${path}.login`),
    supplementaryRequirements: readIndexedStringList(
      source,
      'supplementaryRequirements',
      path,
      MAX_SUPPLEMENTARY_REQUIREMENTS,
      MAX_REQUIREMENT_LENGTH,
      'requirements',
    ),
  }
}

/**
 * Parse an environment confirmation request, reading its nested declaration.
 * @param request - raw request record received from a caller.
 * @returns the validated request with branded project and command identities.
 * @throws a `web-test/*` failure naming the offending field.
 */
export function parseConfirmEnvironmentRequest(
  request: Record<string, unknown>,
): ValidatedEnvironmentConfirmation {
  rejectUnknownFields(request, CONFIRM_ENVIRONMENT_FIELDS)
  return {
    projectId: readId<'WebTestProjectId'>(request, 'projectId', PROJECT_ID_PATTERN),
    commandId: readId<'WebTestCommandId'>(request, 'commandId', COMMAND_ID_PATTERN),
    declaration: parseEnvironmentDeclaration(readRecord(request, 'declaration'), 'declaration'),
  }
}

/**
 * Parse a record submission request, rejecting a non-positive expected revision.
 * @param request - raw request record received from a caller.
 * @returns the validated request with branded identities and revision.
 * @throws a `web-test/*` failure naming the offending field.
 */
export function parseSubmitRecordRequest(request: Record<string, unknown>): ValidatedRecordSubmission {
  rejectUnknownFields(request, SUBMIT_RECORD_FIELDS)
  return {
    commandId: readId<'WebTestCommandId'>(request, 'commandId', COMMAND_ID_PATTERN),
    recordId: readId<'WebTestRecordId'>(request, 'recordId', RECORD_ID_PATTERN),
    expectedRevision: readRevision(request, 'expectedRevision'),
  }
}

/**
 * Parse a policy evaluation request, bounding its optional target path.
 * @param request - raw request record received from a caller.
 * @returns the validated request with a branded project identity.
 * @throws a `web-test/*` failure naming the offending field.
 */
export function parseEvaluatePolicyRequest(request: Record<string, unknown>): ValidatedPolicyRequest {
  rejectUnknownFields(request, EVALUATE_POLICY_FIELDS)
  return {
    projectId: readId<'WebTestProjectId'>(request, 'projectId', PROJECT_ID_PATTERN),
    subject: readString(request, 'subject'),
    targetPath: readOptionalBounded(request, 'targetPath', '', MAX_PATH_LENGTH),
  }
}
