/**
 * Field-level readers shared by this contract's request schemas.
 *
 * A Remote request arrives from another process, so its values are validated
 * field by field here rather than trusted from the static type. Each reader
 * either returns the value branded for its identity or raises the
 * `web-test/invalid-field`, `-missing-field`, or `-unknown-field` failure naming
 * the exact field, which is what a caller needs to correct its request. These
 * readers are the only place an unbranded value becomes branded, so no other
 * module can mint an identity that skipped validation.
 *
 * @module @deepseek-ai/dsh-web-test-contracts/fields
 */

import { brandNumber, brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { invalidField, missingField, unknownField } from './errors.ts'
import type { Revision } from './ids.ts'

/**
 * Join a parent path and a child field into the dotted path a rejection names.
 * @param path - parent path, empty at the request root.
 * @param key - child field name or array index.
 * @returns the dotted path.
 */
function child(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${String(key)}]`
  return path === '' ? key : `${path}.${key}`
}

/**
 * Read one record field, rejecting an absent field and a value that is not a
 * plain record.
 * @param source - request object being read.
 * @param field - field name read from `source`.
 * @param path - dotted parent path used in the rejection.
 * @returns the field's own record.
 */
export function readRecord(
  source: Record<string, unknown>,
  field: string,
  path = '',
): Record<string, unknown> {
  const value = source[field]
  if (value === undefined) missingField(child(path, field))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidField(child(path, field), 'must be an object')
  }
  return value as Record<string, unknown>
}

/**
 * Read one array field, rejecting an absent field and a non-array value.
 * @param source - request object being read.
 * @param field - field name read from `source`.
 * @param path - dotted parent path used in the rejection.
 * @returns the field's array.
 */
export function readArray(source: Record<string, unknown>, field: string, path = ''): unknown[] {
  const value = source[field]
  if (value === undefined) missingField(child(path, field))
  if (!Array.isArray(value)) invalidField(child(path, field), 'must be an array')
  return value
}

/**
 * Read one string field, rejecting an absent field, a non-string value, and an
 * empty or blank string.
 * @param source - request object being read.
 * @param field - field name read from `source`.
 * @param path - dotted parent path used in the rejection.
 * @returns the trimmed string value.
 */
export function readString(source: Record<string, unknown>, field: string, path = ''): string {
  const value = source[field]
  if (value === undefined) missingField(child(path, field))
  if (typeof value !== 'string') invalidField(child(path, field), 'must be a string')
  const trimmed = value.trim()
  if (trimmed === '') invalidField(child(path, field), 'must not be empty')
  return trimmed
}

/**
 * Read one branded identity field, applying the identity's own format rule.
 * @param source - request object being read.
 * @param field - field name read from `source`.
 * @param rule - format every value of this identity must match.
 * @param path - dotted parent path used in the rejection.
 * @returns the branded identity.
 */
export function readId<Brand extends string>(
  source: Record<string, unknown>,
  field: string,
  rule: RegExp,
  path = '',
): Branded<Brand> {
  const value = readString(source, field, path)
  if (!rule.test(value)) invalidField(child(path, field), `must match ${String(rule)}`)
  return brandString<Branded<Brand>>(value)
}

/**
 * Read one revision field, rejecting an absent field and a value that is not a
 * positive safe integer.
 * @param source - request object being read.
 * @param field - field name read from `source`.
 * @param path - dotted parent path used in the rejection.
 * @returns the branded revision number.
 */
export function readRevision(
  source: Record<string, unknown>,
  field: string,
  path = '',
): Revision {
  const value = source[field]
  if (value === undefined) missingField(child(path, field))
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalidField(child(path, field), 'must be a positive integer')
  }
  return brandNumber<Revision>(value)
}

/**
 * Reject every field of `source` the schema does not read, so an unsupported
 * branch is refused instead of silently ignored.
 * @param source - request object whose keys are checked.
 * @param known - the field names this schema reads.
 * @param path - dotted parent path used in the rejection.
 * @returns void; an unrecognized field throws.
 */
export function rejectUnknownFields(
  source: Record<string, unknown>,
  known: readonly string[],
  path = '',
): void {
  for (const field of Object.keys(source)) {
    if (!known.includes(field)) unknownField(child(path, field))
  }
}

/**
 * Read one entry of a string array field, naming the index of a bad element so
 * the caller learns which element to correct.
 * @param items - array read from the request.
 * @param index - position of the element being read.
 * @param path - dotted path of the array field.
 * @returns the trimmed element.
 */
export function readArrayString(items: readonly unknown[], index: number, path: string): string {
  const value = items[index]
  const at = child(path, index)
  if (value === undefined) missingField(at)
  if (typeof value !== 'string') invalidField(at, 'must be a string')
  const trimmed = value.trim()
  if (trimmed === '') invalidField(at, 'must not be empty')
  return trimmed
}
