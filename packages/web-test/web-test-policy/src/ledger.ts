/**
 * The decision ledger: what one entry path is allowed to do, and the record of
 * what authorized it.
 *
 * **Denial is the default and authorization is not durable.** A project with no
 * declaration, a declaration that is not a test environment, a grant that is
 * absent, expired, revision-stale, or out of actions, an entry path with no
 * adapter, and a target that is a link are all refusals, and a restart grants
 * nothing because nothing here is persisted. What IS durable is the project
 * scope, published by the single domain writer; a decision re-reads that scope
 * on every call, so a scope change is observed rather than trusted from a cache.
 *
 * **One decision, every entry path.** The same `evaluate` runs behind the tool
 * guard and behind the service backstop. It is a pure function of published
 * scope, the confirmed declaration, the live grants, and the clock, so the two
 * enforcement points cannot reach different answers about one call.
 *
 * **An environment change invalidates and forces re-verification.** Every grant
 * carries the declaration identity and the project revision it was made against.
 * A declaration whose content changed gets a new identity, and a scope change
 * gets a new revision, so both make every earlier grant inapplicable at once
 * rather than leaving a grant standing against a context that moved underneath
 * it. Declaring the same content again reproduces the same identity and the
 * grants stand, because nothing about the environment changed.
 *
 * **Third-party authorization is independent.** A grant that reaches a third
 * party is only ever matched against effects that reach a third party, and a
 * grant that does not is only ever matched against the declared entry's own
 * origin. Neither covers the other, and each carries its own record, action
 * count, and validity.
 *
 * @module @deepseek-ai/dsh-web-test-policy/ledger
 */

import { createHash } from 'node:crypto'
import type {
  PolicyDecision, PolicyDecisionReason, ProjectId, ProjectMetadata, Revision, ValidatedEnvironmentConfirmation,
} from '@deepseek-ai/dsh-web-test-contracts'
import { WebTestPolicyError } from './errors.ts'
import { effectSubject, type WebTestEffect } from './effects.ts'
import { comparablePath, isInside, originOf, resolvePath } from './scope.ts'
import type { WebTestScopeSource } from './scope-source.ts'
import type {
  ConfirmationAnswer, ConfirmationOutcome, ConfirmationRequest, ConfirmationState, ConfirmationTicket,
  DeclaredEnvironment, FlowGrantReceipt, FlowGrantRequest, PolicyQuery, ProtectedPath, WebTestEffectKind,
} from './types.ts'

/** The contract's declaration-scope evaluation this policy layers its own checks on. */
export interface DeclarationEvaluator {
  /**
   * Evaluate one request against one confirmed declaration.
   * @param request - project identity, subject, and optional target path.
   * @param declaration - the environment the user confirmed.
   * @returns the contract's evaluation and its closed reason.
   */
  evaluatePolicy(request: Record<string, unknown>, declaration: Record<string, unknown>): PolicyDecision
}

/** Everything the decision reads that the deployment chooses. */
export interface LedgerLimits {
  /** Effect kinds that require a business confirmation before they may act. */
  readonly confirmationRequiredFor: readonly WebTestEffectKind[]
  /** Milliseconds a business confirmation stays answerable. */
  readonly confirmationTtlMs: number
  /** Milliseconds one granted authorization stays valid. */
  readonly authorizationValidityMs: number
  /** Most actions one granted authorization may cover. */
  readonly maxActionsPerFlow: number
}

/** One granted authorization, as the ledger holds it. */
interface Grant {
  /** Stable identity for one flow at one revision. */
  readonly grantId: string
  /** Project the grant belongs to. */
  readonly projectId: ProjectId
  /** The concrete flow's record identity. */
  readonly flowId: string
  /** Revision of that flow's plan. */
  readonly flowRevision: number
  /** Project revision the grant was made against. */
  readonly projectRevision: Revision
  /** Environment declaration the grant was made against. */
  readonly declarationId: string
  /** Whether the grant reaches a third party. */
  readonly thirdParty: boolean
  /** Digest of the one action the grant covers, or `null` for a flow-scoped grant. */
  readonly actionFingerprint: string | null
  /** Epoch milliseconds after which the grant no longer applies. */
  readonly expiresAt: number
  /** Actions still available to the grant. */
  remaining: number
}

/** One confirmation question and how it stands. */
interface Question {
  /** The context the question was asked against. */
  readonly ticket: ConfirmationTicket
  /** How the question stands now. */
  state: ConfirmationState
}

/** One decision, and the facts behind it that a later step needs. */
type Assessment =
  /** No project could be resolved, so nothing else was consulted. */
  | { readonly decision: PolicyDecision; readonly resolved: false }
  /** A project and its declaration were in force for this decision. */
  | {
    /** The decision the caller acts on or reports. */
    readonly decision: PolicyDecision
    /** Whether a project and its declaration were in force. */
    readonly resolved: true
    /** The project the decision was made against. */
    readonly projectId: ProjectId
    /** The environment declaration in force. */
    readonly declaration: DeclaredEnvironment
    /** The grant that allowed the effect, absent for every refusal. */
    readonly grant?: Grant
  }

/** Digest suffix length that keeps identities distinguishable in a log. */
const DIGEST_LENGTH = 32

/** The effect kinds a granted authorization can never cover. */
const NEVER_AUTHORIZED: ReadonlySet<WebTestEffectKind> = new Set<WebTestEffectKind>([
  'spawn-process',
  'use-terminal',
])

/** The effect kinds denied because they change or expose material. */
const EXPOSED_KINDS: ReadonlySet<WebTestEffectKind> = new Set<WebTestEffectKind>([
  'write-source',
  'edit-source',
  'write-upload',
  'read-upload',
])

/**
 * Digest a stable JSON projection into a short, collision-resistant identity.
 * @param prefix - identity prefix naming what the digest identifies.
 * @param parts - the values that define the identity, in a fixed order.
 * @returns the prefixed digest.
 */
function digest(prefix: string, parts: readonly (string | number | boolean)[]): string {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex').slice(0, DIGEST_LENGTH)}`
}

/**
 * Reduce resolved roots to the sorted, comparable identities a set comparison
 * and an identity digest both use, so two spellings or orderings of the same
 * trees are one environment rather than two.
 * @param canonicalRoots - the canonical roots to reduce.
 * @returns the comparable identities, sorted.
 */
function canonicalSet(canonicalRoots: readonly string[]): string[] {
  return canonicalRoots.map(comparablePath).sort()
}

/**
 * Build one decision record.
 * @param allowed - whether the request is permitted.
 * @param reason - the closed reason for the outcome.
 * @param subject - the field or path the decision was made against.
 * @returns the decision.
 */
function decide(allowed: boolean, reason: PolicyDecisionReason, subject: string): PolicyDecision {
  return { allowed, reason, subject }
}

/**
 * The absolute path one effect would touch, when it touches one.
 * @param effect - the effect being decided.
 * @returns the path, or `null` for an effect that touches no path.
 */
function pathOf(effect: WebTestEffect): string | null {
  switch (effect.kind) {
    case 'read-source':
    case 'list-source':
    case 'write-source':
    case 'edit-source':
      return effect.path
    case 'fetch-web':
    case 'search-web':
    case 'write-upload':
    case 'read-upload':
    case 'spawn-process':
    case 'use-terminal':
      return null
    /* v8 ignore start -- closed-union exhaustiveness guard */
    default:
      return null
    /* v8 ignore stop */
  }
}

/** The one ledger every enforcement point of one policy service reads. */
export class EnvironmentLedger {
  private readonly declarations = new Map<ProjectId, DeclaredEnvironment>()

  private readonly grants = new Map<ProjectId, Map<string, Grant>>()

  private readonly bindings = new Map<string, ProjectId>()

  private readonly questions = new Map<string, Question>()

  private questionSequence = 0

  /**
   * @param protectedPaths - the composition's protected directories, resolved and frozen here.
   * @param limits - the deployment's confirmation, validity, and action-count bounds.
   * @param scopeSource - the published project scope reader.
   * @param evaluator - the contract's declaration-scope evaluation.
   * @param now - the instant validity and expiry are read against.
   */
  constructor(
    readonly protectedPaths: readonly ProtectedPath[],
    private readonly limits: LedgerLimits,
    private readonly scopeSource: WebTestScopeSource,
    private readonly evaluator: DeclarationEvaluator,
    private readonly now: () => number,
  ) {}

  /**
   * Bind one session to the project its entry opened, so a decision can tell
   * which declaration and which grants apply.
   * @param sessionId - the session whose entry is running.
   * @param projectId - the project that entry is testing.
   * @returns the disposer that withdraws the binding.
   */
  bindEntry(sessionId: string, projectId: ProjectId): () => void {
    this.bindings.set(sessionId, projectId)
    return () => {
      if (this.bindings.get(sessionId) === projectId) this.bindings.delete(sessionId)
    }
  }

  /**
   * The project one session's decisions apply to.
   *
   * A call that names a session is decided against that session's binding and
   * against nothing else. A call with no session — a plugin or skill calling
   * `ctx.fs` directly, or a tool executed without an agent — is decided against
   * the only project that has been declared, and against nothing when there is
   * not exactly one, because a call that cannot name its project has no
   * declaration to be covered by.
   * @param sessionId - the session the call belongs to, or `null`.
   * @returns the project, or `undefined` when no binding establishes one.
   */
  projectFor(sessionId: string | null): ProjectId | undefined {
    if (sessionId !== null) return this.bindings.get(sessionId)
    return this.declarations.size === 1 ? [...this.declarations.keys()][0] : undefined
  }

  /** The published scope of one project, or `undefined` when the head publishes no entry. */
  private published(projectId: ProjectId): ProjectMetadata | undefined {
    return this.scopeSource.readProject(projectId)
  }

  /**
   * Resolve one published path, refusing a value this policy cannot vouch for.
   * @param what - what the path is, named in the failure.
   * @param path - the path to resolve.
   * @returns the canonical identity.
   * @throws {WebTestPolicyError} `unresolved-path` when the path does not exist,
   * `link-path` when it is a link.
   */
  private requireReal(what: string, path: string): string {
    const resolved = resolvePath(path)
    if (resolved.ok) return resolved.real
    throw new WebTestPolicyError(
      resolved.rejection === 'link' ? 'web-test-policy/link-path' : 'web-test-policy/unresolved-path',
      `${what} '${path}' is ${resolved.rejection === 'link'
        ? 'a link; a protected path or code root the policy cannot follow is not a boundary it will enforce'
        : 'not an existing path the policy can canonically resolve'}`,
    )
  }

  /**
   * Record one confirmed environment declaration for a project.
   *
   * The declared code roots must be the trees the project published, as a set:
   * one declaration covers every root, so a declaration naming a proper subset
   * would leave the remaining trees declared but unconfirmed, and one naming a
   * tree the project never published would confirm material outside it. The
   * comparison is over canonical identities rather than as declared, because
   * the same trees named in a different order are the same environment. No
   * protected directory may lie inside any root: a protected directory a root
   * also covers has two contradictory roles, and resolving it either way would
   * let a caller learn which answer the policy happened to check first. The
   * declaration's identity is derived from its content — the roots, the entry
   * URL, the test-environment flag, the login, and the requirements the user
   * added — so re-declaring the same environment is idempotent and any change
   * to it is a new identity, which is what makes every grant made against the
   * old one inapplicable.
   * @param confirmation - the contract's validated confirmation, with branded identities.
   * @returns the declared environment as the policy resolved it.
   * @throws {WebTestPolicyError} `project-unpublished` when the head publishes no
   * entry for the project, `code-root-mismatch` when the declaration names a
   * different set of trees, or `protected-path-inside-code-root` when a
   * protected directory lies under one of them.
   */
  declare(confirmation: ValidatedEnvironmentConfirmation): DeclaredEnvironment {
    const { projectId, declaration } = confirmation
    const published = this.published(projectId)
    if (published === undefined) {
      throw new WebTestPolicyError(
        'web-test-policy/project-unpublished',
        `project '${projectId}' has no published scope to declare an environment against`,
      )
    }
    const declaredRoots = declaration.codeRoots.map(root => this.requireReal('declared code root', root))
    const publishedRoots = published.codeRoots.map(root => this.requireReal('published code root', root))
    const declaredSet = canonicalSet(declaredRoots)
    if (declaredSet.join('\n') !== canonicalSet(publishedRoots).join('\n')) {
      throw new WebTestPolicyError(
        'web-test-policy/code-root-mismatch',
        `declaration names code roots '${declaredRoots.join(', ')}', but project '${projectId}' published '${publishedRoots.join(', ')}'`,
      )
    }
    for (const protectedPath of this.protectedPaths) {
      for (const publishedRoot of publishedRoots) {
        if (!isInside(publishedRoot, protectedPath.real)) continue
        throw new WebTestPolicyError(
          'web-test-policy/protected-path-inside-code-root',
          `protected ${protectedPath.role} path '${protectedPath.real}' lies inside the tested code root '${publishedRoot}'`,
        )
      }
    }
    const entryOrigins: string[] = []
    if (declaration.entryUrl !== null) {
      const origin = originOf(declaration.entryUrl)
      if (origin !== null) entryOrigins.push(origin)
    }
    const loginParts = declaration.login.state === 'required'
      ? [declaration.login.state, declaration.login.accountLabel]
      : [declaration.login.state]
    const declared: DeclaredEnvironment = {
      confirmation,
      declarationId: digest('decl', [
        projectId, ...declaredSet, declaration.entryUrl ?? '', declaration.isTestEnvironment,
        ...loginParts, ...declaration.supplementaryRequirements,
      ]),
      codeRoots: publishedRoots,
      entryOrigins,
      projectRevision: published.revision,
      login: declaration.login,
      supplementaryRequirements: declaration.supplementaryRequirements,
    }
    this.declarations.set(projectId, declared)
    return declared
  }

  /** The declared environment of one project, when it has one. */
  private declarationOf(projectId: ProjectId): DeclaredEnvironment | undefined {
    return this.declarations.get(projectId)
  }

  /**
   * Grant one concrete flow the right to act, bounded by record, count, and
   * validity. The grant is expressed against the published project revision and
   * the declaration in force, so it stops applying the moment either moves.
   *
   * The budget belongs to the flow, not to the request. A re-issue of the same
   * flow at the same revisions is the same authorization, so it returns the
   * record that stands — the actions it still has and the instant it still
   * expires at — rather than a fresh ceiling and a fresh validity window; a
   * caller that re-issues to top a budget up is told what is left instead of
   * being handed a new one. A flow's identity moves with its plan revision, the
   * project revision, the declaration, and the third-party flag, so a re-issue
   * under any of those is a different authorization and does get its own budget.
   * @param request - the flow, its plan revision, the third-party flag, and the action count.
   * @returns the granted authorization as the caller is told.
   * @throws {WebTestPolicyError} `no-declaration` when the project has no
   * environment to grant against.
   */
  grant(request: FlowGrantRequest): FlowGrantReceipt {
    const projectId = this.projectFor(request.sessionId)
    const declaration = projectId === undefined ? undefined : this.declarationOf(projectId)
    if (projectId === undefined || declaration === undefined) {
      throw new WebTestPolicyError(
        'web-test-policy/no-declaration',
        'a grant requires a session bound to a project with a confirmed environment declaration',
      )
    }
    const projectRevision = this.published(projectId)?.revision
    if (projectRevision === undefined) {
      throw new WebTestPolicyError(
        'web-test-policy/project-unpublished',
        `project '${projectId}' has no published scope to grant against`,
      )
    }
    const grantId = digest('grant', [
      projectId, request.flowId, request.flowRevision, projectRevision, declaration.declarationId, request.thirdParty,
    ])
    const forProject = this.grants.get(projectId) ?? new Map<string, Grant>()
    const standing = forProject.get(grantId)
    if (standing !== undefined) return this.receiptOf(standing)
    const grant: Grant = {
      grantId,
      projectId,
      flowId: request.flowId,
      flowRevision: request.flowRevision,
      projectRevision,
      declarationId: declaration.declarationId,
      thirdParty: request.thirdParty,
      actionFingerprint: null,
      expiresAt: this.now() + this.limits.authorizationValidityMs,
      remaining: Math.min(request.actions, this.limits.maxActionsPerFlow),
    }
    forProject.set(grantId, grant)
    this.grants.set(projectId, forProject)
    return this.receiptOf(grant)
  }

  /** The receipt one grant is reported as. */
  private receiptOf(grant: Grant): FlowGrantReceipt {
    return {
      grantId: grant.grantId,
      projectId: grant.projectId,
      flowId: grant.flowId,
      flowRevision: grant.flowRevision,
      projectRevision: grant.projectRevision,
      declarationId: grant.declarationId,
      thirdParty: grant.thirdParty,
      actions: grant.remaining,
      expiresAt: grant.expiresAt,
    }
  }

  /**
   * Decide one effect. Every check is synchronous, and every refusal names the
   * field or path it was made against.
   *
   * The order is what keeps the reasons honest. An unrecognised call is refused
   * before anything else, because a decision about it would be a decision about
   * nothing. The contract's own declaration evaluation runs next, so the
   * production-environment and outside-the-root rules have exactly one home.
   * Only then do this policy's own layers apply: canonical target identity,
   * protected directories, the capabilities no grant may ever cover, the
   * third-party boundary, the grant, and the business confirmation.
   * @param query - the entry, its session, and the effect it would have.
   * @returns the decision, which is the only policy result this package reports.
   */
  evaluate(query: PolicyQuery): PolicyDecision {
    return this.assess(query).decision
  }

  /**
   * Decide one effect and report the grant that reached it.
   *
   * Every check is synchronous, and every refusal names the field or path it was
   * made against. One function decides and one function spends, so the two
   * enforcement points cannot reach the grant by two different routes.
   *
   * The order is what keeps the reasons honest. An unrecognised call is refused
   * before anything else, because a decision about it would be a decision about
   * nothing. A target the policy will not canonically name, and a target inside a
   * protected directory, are refused next: a refusal that names the protected
   * directory's role is the more useful one, and the contract's declaration
   * evaluation would otherwise answer "outside the root" for every protected
   * path, because a protected directory is by construction outside the tested
   * tree. The contract's own evaluation then runs, so the production-environment
   * and outside-the-root rules have exactly one home, and this policy's own
   * layers follow: canonical containment, the capabilities no grant may ever
   * cover, the third-party boundary, and the grant.
   * @param query - the entry, its session, and the effect it would have.
   * @returns the decision, and the grant behind it when the effect was granted.
   */
  private assess(query: PolicyQuery): Assessment {
    if (query.effect === null) {
      return { decision: decide(false, 'denied-unknown-target', query.entry), resolved: false }
    }
    const projectId = this.projectFor(query.sessionId)
    if (projectId === undefined) {
      return { decision: decide(false, 'denied-outside-scope', query.sessionId ?? query.entry), resolved: false }
    }
    const declaration = this.declarationOf(projectId)
    if (declaration === undefined) {
      return { decision: decide(false, 'denied-outside-scope', query.entry), resolved: false }
    }
    const subject = effectSubject(query.effect)
    const targetPath = pathOf(query.effect)
    if (targetPath !== null) {
      const identity = this.targetIdentity(targetPath)
      if (identity !== undefined) return { decision: identity, resolved: true, projectId, declaration }
      const exposure = this.exposure(targetPath)
      if (exposure !== undefined) return { decision: exposure, resolved: true, projectId, declaration }
    }
    const declared = this.evaluator.evaluatePolicy(
      { projectId, subject, targetPath },
      { ...declaration.confirmation.declaration },
    )
    if (!declared.allowed) return { decision: declared, resolved: true, projectId, declaration }
    if (targetPath !== null) {
      const containment = this.containment(declaration, targetPath)
      if (containment !== undefined) return { decision: containment, resolved: true, projectId, declaration }
    }
    if (NEVER_AUTHORIZED.has(query.effect.kind)) {
      // These two capabilities are refused for every declaration and every
      // grant, so the fact to report is a scope statement: the effect lies
      // outside anything a confirmed declaration can authorize.
      // `denied-unknown-target` is reserved for a target the policy cannot
      // canonically name, and a command that was never named is not that.
      return { decision: decide(false, 'denied-outside-scope', subject), resolved: true, projectId, declaration }
    }
    if (EXPOSED_KINDS.has(query.effect.kind)) {
      return { decision: decide(false, 'denied-protected-path', subject), resolved: true, projectId, declaration }
    }
    const thirdParty = this.reachesThirdParty(declaration, query.effect)
    const grant = this.liveGrant(
      projectId,
      declaration,
      query.effect,
      thirdParty,
      this.fingerprint(query.entry, query.effect),
    )
    if (thirdParty && grant === undefined) {
      return { decision: decide(false, 'denied-outside-scope', subject), resolved: true, projectId, declaration }
    }
    if (grant === undefined) {
      // An effect whose kind requires a business confirmation has no grant to
      // lapse: the grant that would cover it is one the human has not given, so
      // the fact to report is the missing confirmation and not an expired
      // authorization.
      return {
        decision: decide(
          false,
          this.limits.confirmationRequiredFor.includes(query.effect.kind)
            ? 'denied-missing-confirmation'
            : 'denied-expired-authorization',
          subject,
        ),
        resolved: true,
        projectId,
        declaration,
      }
    }
    return { decision: decide(true, 'allowed-in-scope', subject), resolved: true, projectId, declaration, grant }
  }

  /**
   * The refusal a path earns because the policy will not reason about where it
   * points.
   *
   * `lstat` runs on the final component, so a link is refused as a link rather
   * than resolved to its target. A link in an *intermediate* component is
   * different: `realpath` follows it, and the canonical containment check then
   * refuses whatever it points at, which names the tree the link escaped to
   * instead of the link.
   * @param targetPath - the absolute path the effect would touch.
   * @returns the refusal, or `undefined` when the target has a canonical identity.
   */
  private targetIdentity(targetPath: string): PolicyDecision | undefined {
    const resolved = resolvePath(targetPath)
    if (resolved.ok) return undefined
    return decide(false, 'denied-unknown-target', targetPath)
  }

  /**
   * The refusal a path earns by being, or being under, a protected directory.
   * @param targetPath - the absolute path the effect would touch.
   * @returns the refusal, or `undefined` when the target is not protected.
   */
  private exposure(targetPath: string): PolicyDecision | undefined {
    const resolved = resolvePath(targetPath)
    /* v8 ignore next -- evaluate calls this only after targetIdentity accepted the path */
    if (!resolved.ok) return undefined
    for (const protectedPath of this.protectedPaths) {
      if (!isInside(protectedPath.real, resolved.real)) continue
      return decide(false, 'denied-protected-path', `${protectedPath.role}:${resolved.real}`)
    }
    return undefined
  }

  /**
   * Decide one effect and, when it is allowed, take one action from the grant
   * that allowed it. Evaluation stays pure so a caller may ask twice; the count
   * is spent only where an effect actually proceeds, and a call that is later
   * cancelled has spent an action it did not need, which is the safe direction.
   * @param query - the entry, its session, and the effect it would have.
   * @returns the decision the caller acts on.
   */
  authorize(query: PolicyQuery): PolicyDecision {
    const assessment = this.assess(query)
    if (assessment.resolved && assessment.grant !== undefined) assessment.grant.remaining -= 1
    return assessment.decision
  }

  /**
   * The refusal a path effect earns for lying outside every tested tree, judged
   * over canonical paths.
   *
   * The contract's own evaluation already refuses a target outside the code roots
   * as the caller spelled it, so this check exists for the spellings that raw
   * comparison admits and a canonical one does not: a `..` segment, a redundant
   * separator, or a link in an intermediate component. The declared roots are
   * re-resolved here rather than trusted from load, so a root that has since
   * been replaced by a link, or removed, stops covering anything instead of
   * continuing to vouch for a tree it no longer names — and one root still
   * resolving does not let a removed sibling vouch for anything either.
   * @param declaration - the declared environment.
   * @param targetPath - the absolute path the effect would touch.
   * @returns the refusal, or `undefined` when the target is inside a declared root.
   */
  private containment(declaration: DeclaredEnvironment, targetPath: string): PolicyDecision | undefined {
    const resolved = resolvePath(targetPath)
    /* v8 ignore next -- targetIdentity accepted this path earlier in the same decision */
    if (!resolved.ok) return decide(false, 'denied-unknown-target', targetPath)
    const roots: string[] = []
    for (const declaredRoot of declaration.codeRoots) {
      const root = resolvePath(declaredRoot)
      if (root.ok) roots.push(root.real)
    }
    if (roots.length === 0) {
      return decide(false, 'denied-unknown-target', declaration.codeRoots.join(', '))
    }
    if (roots.some(root => isInside(root, resolved.real))) return undefined
    return decide(false, 'denied-outside-scope', resolved.real)
  }


  /**
   * Whether one effect reaches a party other than the declared entry's origin.
   * @param declaration - the declared environment.
   * @param effect - the effect being decided.
   * @returns whether a third-party grant is the only kind that could cover it.
   */
  private reachesThirdParty(declaration: DeclaredEnvironment, effect: WebTestEffect): boolean {
    if (effect.kind === 'search-web') return true
    if (effect.kind !== 'fetch-web') return false
    const origin = originOf(effect.url)
    return origin === null || !declaration.entryOrigins.includes(origin)
  }

  /**
   * The digest of the one action a grant has to name to cover it. An entry path
   * is part of the digest, so the same target reached through a different tool
   * or service is a different action and needs its own answer.
   * @param entry - the tool or service the call came through.
   * @param effect - the effect the call would have.
   * @returns the action digest.
   */
  private fingerprint(entry: string, effect: WebTestEffect): string {
    return digest('act', [entry, effect.kind, effectSubject(effect)])
  }

  /**
   * The live grant that covers one effect, if any.
   *
   * A grant is live only when it still has an action left, is still valid, and
   * was made against the project revision the head publishes now and the
   * declaration in force now. A grant that has lapsed is not revived by a later
   * one issued for a different flow, and a grant for one action does not cover
   * another. An effect whose kind requires a business confirmation is covered
   * only by a grant that names that exact action, so a flow-scoped grant cannot
   * stand in for a confirmation the human has not given.
   * @param projectId - the project the call belongs to.
   * @param declaration - the declaration in force.
   * @param effect - the effect being decided.
   * @param thirdParty - whether a third-party grant is required.
   * @param fingerprint - digest of the action, for a confirmation-scoped grant.
   * @returns the grant, or `undefined` when none covers the effect.
   */
  private liveGrant(
    projectId: ProjectId,
    declaration: DeclaredEnvironment,
    effect: WebTestEffect,
    thirdParty: boolean,
    fingerprint: string,
  ): Grant | undefined {
    const forProject = this.grants.get(projectId)
    const revision = this.published(projectId)?.revision
    if (forProject === undefined || revision === undefined) return undefined
    const needsIntent = this.limits.confirmationRequiredFor.includes(effect.kind)
    const now = this.now()
    for (const grant of forProject.values()) {
      if (grant.thirdParty !== thirdParty) continue
      if (grant.remaining < 1) continue
      if (now >= grant.expiresAt) continue
      if (grant.projectRevision !== revision) continue
      if (grant.declarationId !== declaration.declarationId) continue
      if (needsIntent && grant.actionFingerprint !== fingerprint) continue
      if (!needsIntent && grant.actionFingerprint !== null && grant.actionFingerprint !== fingerprint) continue
      return grant
    }
    return undefined
  }

  /**
   * Open or re-check the business confirmation one dependent action needs.
   *
   * A confirmation is asked only for an action the product would otherwise
   * already permit: an action refused on its own merits is never turned into a
   * question, because an answer could only have made it worse. The one refusal
   * that does open a question is the missing confirmation itself, which is the
   * whole subject of the question. Waiting grants nothing — the returned state
   * is `pending` and the decision still denies — and a question that timed out,
   * was mismatched, was skipped, or was cancelled is replaced by a new one
   * rather than reopened, which is what makes a dependent action re-ask instead
   * of acting on a stale question.
   * @param request - the dependent action, its session, and the flow it belongs to.
   * @returns whether a confirmation was required, and how the question stands.
   */
  requireConfirmation(request: ConfirmationRequest): ConfirmationOutcome {
    if (request.effect === null || !this.limits.confirmationRequiredFor.includes(request.effect.kind)) {
      return { required: false, decision: this.evaluate(request) }
    }
    const projectId = this.projectFor(request.sessionId)
    const declaration = projectId === undefined ? undefined : this.declarationOf(projectId)
    if (projectId === undefined || declaration === undefined) {
      // A call that cannot name a declared environment has nothing to confirm;
      // the plain refusal is the whole answer.
      return { required: false, decision: this.evaluate(request) }
    }
    const { decision } = this.assess(request)
    if (!decision.allowed && decision.reason !== 'denied-missing-confirmation') {
      return { required: false, decision }
    }
    const fingerprint = this.fingerprint(request.entry, request.effect)
    const now = this.now()
    const open = [...this.questions.values()].find(question =>
      question.ticket.projectId === projectId
      && question.ticket.flowId === request.flowId
      && question.ticket.flowRevision === request.flowRevision
      && question.ticket.actionFingerprint === fingerprint)
    if (open !== undefined && open.state === 'pending' && now < open.ticket.expiresAt) {
      return { required: true, decision, ticket: open.ticket, state: 'pending', reclarify: false }
    }
    if (open !== undefined && open.state === 'answered') {
      return { required: true, decision, ticket: open.ticket, state: 'answered', reclarify: false }
    }
    this.questionSequence += 1
    const ticket: ConfirmationTicket = {
      questionId: `confirm-${String(this.questionSequence)}`,
      projectId,
      flowId: request.flowId,
      flowRevision: request.flowRevision,
      projectRevision: declaration.projectRevision,
      declarationId: declaration.declarationId,
      actionFingerprint: fingerprint,
      expiresAt: now + this.limits.confirmationTtlMs,
    }
    this.questions.set(ticket.questionId, { ticket, state: 'pending' })
    return { required: true, decision, ticket, state: 'pending', reclarify: true }
  }

  /**
   * Apply one human answer to the question it names.
   *
   * The answer carries the context the question was shown with, and all of it is
   * re-checked: the question must still be open and unexpired, the action it was
   * asked about must be the one being answered, and the project revision, flow
   * plan revision, and environment declaration it was asked against must still
   * be the ones in force. Anything else is refused, the question is closed, and
   * the caller is told to ask again — a late answer never reuses an old
   * question's grant.
   * @param answer - the question identity and the context the human was shown.
   * @returns the state the question reached, and whether it must be asked again.
   * @throws {WebTestPolicyError} `unknown-question` when the identity names no question.
   */
  answerConfirmation(answer: ConfirmationAnswer): { readonly state: ConfirmationState; readonly reclarify: boolean } {
    const question = this.requireQuestion(answer.questionId)
    if (question.state !== 'pending') return { state: question.state, reclarify: true }
    if (this.now() >= question.ticket.expiresAt) {
      question.state = 'expired'
      return { state: question.state, reclarify: true }
    }
    if (answer.actionFingerprint !== question.ticket.actionFingerprint
      || answer.flowRevision !== question.ticket.flowRevision
      || answer.declarationId !== question.ticket.declarationId
      || answer.projectRevision !== this.published(question.ticket.projectId)?.revision) {
      question.state = 'mismatched'
      return { state: question.state, reclarify: true }
    }
    if (!answer.confirmed) {
      question.state = 'skipped'
      return { state: question.state, reclarify: true }
    }
    const { ticket } = question
    const grantId = digest('grant', [
      ticket.projectId, ticket.flowId, ticket.flowRevision, answer.projectRevision,
      ticket.declarationId, ticket.actionFingerprint,
    ])
    const forProject = this.grants.get(ticket.projectId) ?? new Map<string, Grant>()
    forProject.set(grantId, {
      grantId,
      projectId: ticket.projectId,
      flowId: ticket.flowId,
      flowRevision: ticket.flowRevision,
      projectRevision: answer.projectRevision,
      declarationId: ticket.declarationId,
      thirdParty: false,
      actionFingerprint: ticket.actionFingerprint,
      expiresAt: this.now() + this.limits.authorizationValidityMs,
      remaining: 1,
    })
    this.grants.set(ticket.projectId, forProject)
    question.state = 'answered'
    return { state: question.state, reclarify: false }
  }

  /**
   * Record that the caller chose not to confirm, or that the dependent work was
   * cancelled. Neither grants anything; both close the question so the next
   * attempt asks a new one.
   * @param questionId - the question to close.
   * @param state - `skipped` for a declined confirmation, `cancelled` for abandoned work.
   * @returns the state the question reached.
   * @throws {WebTestPolicyError} `unknown-question` when the identity names no question.
   */
  closeConfirmation(questionId: string, state: 'skipped' | 'cancelled'): ConfirmationState {
    const question = this.requireQuestion(questionId)
    question.state = state
    return question.state
  }

  /** The open or closed question one identity names. */
  private requireQuestion(questionId: string): Question {
    const question = this.questions.get(questionId)
    if (question === undefined) {
      throw new WebTestPolicyError(
        'web-test-policy/unknown-question',
        `confirmation question '${questionId}' was never asked by this policy service`,
      )
    }
    return question
  }
}
