/**
 * The Web testing contract's Remote failure codes and the field-naming
 * rejections every schema raises.
 *
 * A caller that sends an illegal value learns which field was refused and why,
 * so a `RemoteError` from this package always carries `field` alongside its
 * message. The codes extend the protocol's merge-extensible
 * `RemoteErrorDetailsMap`, which keeps one failure carrier across the whole
 * workspace: a consumer discriminates on `code` and reads `details.field`
 * without a cast.
 *
 * @module @deepseek-ai/dsh-web-test-contracts/errors
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A request field failed this package's schema; `field` names it. */
    'web-test/invalid-field': { readonly field: string; readonly reason: string }
    /** A request field is absent where the schema requires it. */
    'web-test/missing-field': { readonly field: string }
    /** A request carries a field this contract does not define. */
    'web-test/unknown-field': { readonly field: string }
  }
}

/** Every failure code this contract raises. */
export type WebTestErrorCode =
  | 'web-test/invalid-field'
  | 'web-test/missing-field'
  | 'web-test/unknown-field'

/**
 * Reject one field whose value does not satisfy the schema, naming the field
 * and the rule it broke.
 * @param field - dotted path of the offending field, for example `codeRoots[0]`.
 * @param reason - the rule the value broke, in product terms.
 * @returns never; it throws the `web-test/invalid-field` failure.
 */
export function invalidField(field: string, reason: string): never {
  throw new RemoteError('web-test/invalid-field', `${field} ${reason}`, { field, reason })
}

/**
 * Reject a request that omits a field the schema requires.
 * @param field - dotted path of the missing field.
 * @returns never; it throws the `web-test/missing-field` failure.
 */
export function missingField(field: string): never {
  throw new RemoteError('web-test/missing-field', `${field} is required`, { field })
}

/**
 * Reject a request carrying a field this contract does not define, so a caller
 * cannot smuggle an unsupported branch past a schema that only validates the
 * fields it knows.
 * @param field - the unrecognized field name.
 * @returns never; it throws the `web-test/unknown-field` failure.
 */
export function unknownField(field: string): never {
  throw new RemoteError('web-test/unknown-field', `${field} is not part of this request`, { field })
}
