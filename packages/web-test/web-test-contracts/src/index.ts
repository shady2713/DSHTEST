/**
 * The Web testing contract's Service Definition: the one place the Remote
 * surface is declared, from which the Typert generator derives the Client
 * types and the runtime invocation descriptors.
 *
 * Each method here validates its request field by field and returns the
 * branded, normalized record. The methods are the schema boundary and nothing
 * more: they do not persist, do not route a model request, do not execute a
 * browser action, and do not grant authorization — the Runtime and the policy
 * service own those and consume the records this returns. Keeping validation
 * here means a Client, the Runtime, and a future executor all reject the same
 * illegal field with the same `web-test/*` code and the same field name.
 *
 * @module @deepseek-ai/dsh-web-test-contracts
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  parseConfirmEnvironmentRequest,
  parseEnvironmentDeclaration,
  parseEvaluatePolicyRequest,
  parseRegisterProjectRequest,
  parseSubmitRecordRequest,
} from './parse.ts'
import type {
  ConfirmEnvironmentRequest,
  EnvironmentDeclaration,
  EvaluatePolicyRequest,
  PolicyDecision,
  RegisterProjectRequest,
  SubmitRecordRequest,
  ValidatedEnvironmentConfirmation,
  ValidatedPolicyRequest,
  ValidatedProjectRegistration,
  ValidatedRecordSubmission,
} from './records.ts'

export type * from './ids.ts'
export type * from './records.ts'
export {
  invalidField,
  missingField,
  unknownField,
  type WebTestErrorCode,
} from './errors.ts'
export {
  parseConfirmEnvironmentRequest,
  parseEnvironmentDeclaration,
  parseEvaluatePolicyRequest,
  parseRegisterProjectRequest,
  parseSubmitRecordRequest,
} from './parse.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestContracts: WebTestContracts
  }
}

/** Wire namespace and Cordis service key the generated Client addresses these methods under. */
export const WEB_TEST_CONTRACTS_NAMESPACE = 'webTestContracts'

/** Separators a path may end with; Windows accepts either spelling. */
const SEPARATORS: readonly string[] = ['/', '\\']

/**
 * Whether one absolute path lies inside any of the declared code roots.
 *
 * A root covers itself and the paths beneath it, never a sibling whose name
 * merely begins with the root's characters: `C:\projects\shop` does not cover
 * `C:\projects\shop-evil\src\cart.ts`. Covering a second root widens coverage
 * to that root and nothing else — a target no declared root covers is still
 * refused, which is what keeps declaring more roots from becoming a way to
 * authorize more of the filesystem.
 * @param codeRoots - absolute paths the confirmed declaration covers.
 * @param targetPath - absolute path the request would touch.
 * @returns whether the target is one of the roots or lies beneath one of them.
 */
function isInsideCodeRoot(codeRoots: readonly string[], targetPath: string): boolean {
  return codeRoots.some(codeRoot => isUnderRoot(codeRoot, targetPath))
}

/**
 * Whether one absolute path lies inside a single declared code root.
 * @param codeRoot - absolute path the confirmed declaration covers.
 * @param targetPath - absolute path the request would touch.
 * @returns whether the target is the root itself or lies beneath it.
 */
function isUnderRoot(codeRoot: string, targetPath: string): boolean {
  const root = toComparablePath(codeRoot)
  const target = toComparablePath(targetPath)
  if (target === root) {
    return true
  }
  // A bare POSIX mount point is the separator itself, which every absolute
  // path is beneath.
  if (root === '/') {
    return true
  }
  return target.startsWith(`${root}/`)
}

/**
 * Reduce a path to the form a scope comparison uses: forward slashes and no
 * trailing separator, so `C:/projects/shop` and `C:\projects\shop\` are one path
 * rather than two spellings of it. A one-character path keeps its own
 * separator, which is what keeps a mount point recognizable.
 * @param path - absolute path as declared or requested.
 * @returns the comparable form of `path`.
 */
function toComparablePath(path: string): string {
  let end = path.length
  while (end > 1 && SEPARATORS.some(separator => path[end - 1] === separator)) {
    end -= 1
  }
  return path.slice(0, end).replace(/\\/gu, '/')
}

/**
 * Read-only evaluation of a project declaration: this contract decides only
 * whether a request falls inside a declaration the user already confirmed. It
 * grants no authorization, so a `true` here never substitutes for the policy
 * service's own decision. A target is covered when any declared code root
 * covers it, and a target no root covers is refused.
 * @param declaration - environment the user confirmed.
 * @param request - validated policy request being evaluated.
 * @returns the evaluation, whose reason names why the request was admitted or refused.
 */
function evaluateDeclaration(
  declaration: EnvironmentDeclaration,
  request: ValidatedPolicyRequest,
): PolicyDecision {
  if (!declaration.isTestEnvironment) {
    return { allowed: false, reason: 'denied-outside-scope', subject: request.subject }
  }
  if (request.targetPath !== null && !isInsideCodeRoot(declaration.codeRoots, request.targetPath)) {
    return { allowed: false, reason: 'denied-outside-scope', subject: request.targetPath }
  }
  return { allowed: true, reason: 'allowed-in-scope', subject: request.subject }
}

/**
 * The Web testing contract boundary (`ctx.webTestContracts`): one Service
 * Definition whose Remote methods validate a caller request and hand back the
 * branded record, plus the declaration-scope evaluation that needs no stored
 * state.
 */
export class WebTestContracts extends TypertRemoteService {
  constructor(ctx: Context) {
    // The literal, not {@link WEB_TEST_CONTRACTS_NAMESPACE}: the Typert analyzer
    // reads the gateway service key from the syntax tree and rejects anything
    // but a string literal there. The two must name the same service.
    super(ctx, 'webTestContracts')
  }

  /**
   * Validate a project registration request before any project is created.
   * @param request - command token, code roots, and already-started entry URLs.
   * @returns the validated registration with a branded command token.
   * @throws a `web-test/*` failure naming the offending field.
   */
  @Remote
  registerProject(request: RegisterProjectRequest): ValidatedProjectRegistration {
    return parseRegisterProjectRequest(request)
  }

  /**
   * Validate a domain record submission before the authoritative committer
   * writes it.
   * @param request - command token, record identity, and the caller's last read revision.
   * @returns the validated submission with branded identities and revision.
   * @throws a `web-test/*` failure naming the offending field.
   */
  @Remote
  submitRecord(request: SubmitRecordRequest): ValidatedRecordSubmission {
    return parseSubmitRecordRequest(request)
  }

  /**
   * Validate one environment declaration the user confirmed; an ordinary URL,
   * domain, or model inference does not stand in for this call. The declaration
   * covers every code root the project registered, and carries the login and the
   * requirements the user added on top of them.
   * @param declaration - code roots, entry URL, test-environment flag, login, and added requirements.
   * @returns the normalized declaration.
   * @throws a `web-test/*` failure naming the offending field.
   */
  @Remote
  confirmEnvironmentDeclaration(declaration: EnvironmentDeclaration): EnvironmentDeclaration {
    return parseEnvironmentDeclaration(declaration, 'declaration')
  }

  /**
   * Validate an environment confirmation request and its nested declaration.
   * @param request - project identity, command token, and the declaration.
   * @returns the validated confirmation with branded identities.
   * @throws a `web-test/*` failure naming the offending field.
   */
  @Remote
  confirmEnvironment(request: ConfirmEnvironmentRequest): ValidatedEnvironmentConfirmation {
    return parseConfirmEnvironmentRequest(request)
  }

  /**
   * Validate a policy request and report whether a confirmed declaration covers
   * it. A refusal names the field or path it was made against; the result is an
   * input to the policy service, not an authorization it grants.
   * @param request - project identity, subject, and optional target path.
   * @param declaration - environment the user confirmed for that project.
   * @returns the evaluation and its closed reason.
   * @throws a `web-test/*` failure naming the offending field.
   */
  @Remote
  evaluatePolicy(
    request: EvaluatePolicyRequest,
    declaration: EnvironmentDeclaration,
  ): PolicyDecision {
    const validated = parseEvaluatePolicyRequest(request)
    return evaluateDeclaration(parseEnvironmentDeclaration(declaration, 'declaration'), validated)
  }
}

export default WebTestContracts
