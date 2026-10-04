/**
 * The route policy: six task kinds, the fields each one constrains, the
 * fail-closed read, and the three immutability obligations.
 */
import { describe, expect, it } from 'vitest'
import {
  capabilityCheck, classifyDeadline, deadlineDecision, escalationFor, knownTaskKind, parseStoredPolicy,
  POLICIES, policyRecord, requireForKind, satisfiesPolicy, validateAgainst,
} from '../src/policy.ts'
import { ROUTE_POLICY_VERSION, ROUTE_SELECTION_VERSION } from '../src/identity.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  InputGenerationVersion, PolicyRevisionId, PolicyWorkId, RoutePolicyId, RoutePolicyVersion,
} from '../src/identity.ts'
import type { PolicyRecord, PolicyTaskKind, RoutePolicyRevision } from '../src/types.ts'

const version = ROUTE_POLICY_VERSION
const policyId = brandString<RoutePolicyId>('web-test-policy:checkout')
const revision = brandString<PolicyRevisionId>('rev-1')
const inputGeneration = brandString<InputGenerationVersion>('web-test-inputs/1')

const policy: RoutePolicyRevision = {
  version,
  policyId,
  revision,
  taskKind: 'requirements',
  requiredCapabilities: ['text-input'],
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-pro', credentialRef: null, modelVersion: 'deepseek-v4-pro-20260101' },
  fallback: { provider: 'deepseek-official', model: 'deepseek-chat', credentialRef: null, modelVersion: null },
  inputGenerationVersion: inputGeneration,
  timeouts: { requestMs: 30_000, taskMs: 120_000 },
  validators: ['response-schema'],
  escalation: ['user-confirmation'],
  effectiveFrom: 1_700_000_000_000,
}

describe('POLICIES', () => {
  it('covers the six task kinds the design table names, and no others', () => {
    expect(POLICIES.map(entry => entry.kind).sort()).toEqual([
      'candidate-selection',
      'defect-explanation',
      'exact-value',
      'requirements',
      'skill-draft',
      'visual-inspection',
    ])
  })

  it('maps every kind onto the three task types this package routes today', () => {
    // The six kinds are finer than the three modality-bearing task types, so
    // each kind names the type whose requirement it satisfies. A kind with no
    // such type is a work item that runs no model route at all. Declaration
    // order, which is the order a surface lists them.
    expect(POLICIES.map(entry => entry.taskType)).toEqual(['analysis', 'analysis', 'vision', null, 'analysis', 'analysis'])
  })

  it('reads a known kind and refuses an unknown one instead of guessing', () => {
    expect(requireForKind('requirements').taskType).toBe('analysis')
    expect(requireForKind('visual-inspection').taskType).toBe('vision')
    expect(() => requireForKind('summarise' as PolicyTaskKind)).toThrow(/declares no route policy/u)
  })

  it('reports a stored kind as known or absent, never as a near match', () => {
    expect(knownTaskKind('exact-value')).toBe(true)
    expect(knownTaskKind('exact-value-check')).toBe(false)
  })

  it('gives the deterministic kind no model route at all', () => {
    // "Do not introduce model judgment where unnecessary": this kind's default
    // is deterministic parsing, so it names no task type and requires no
    // capability, and dispatching it to a text route would be the guess.
    const exact = requireForKind('exact-value')
    expect(exact.taskType).toBeNull()
    expect(exact.requiredCapabilities).toEqual([])
  })

  it('requires an image-capable route for the visual kind and a text one otherwise', () => {
    expect(requireForKind('visual-inspection').requiredCapabilities).toEqual(['image-input'])
    expect(requireForKind('requirements').requiredCapabilities).toEqual(['text-input'])
    expect(requireForKind('candidate-selection').requiredCapabilities).toEqual(['text-input'])
  })
})

describe('satisfiesPolicy', () => {
  it('accepts a route whose declared modalities cover every required capability', () => {
    const check = satisfiesPolicy(policy, { inputModalities: ['text', 'image'], toolUpdate: undefined, reportedCacheTokens: false })
    expect(check).toEqual({ ok: true, missing: [] })
  })

  it('names the capability a route lacks instead of accepting the route', () => {
    // The acceptance path: a primary route that cannot read an image is not
    // quietly downgraded onto a weaker route; the missing capability is named.
    const vision = { ...policy, taskKind: 'visual-inspection' as PolicyTaskKind, requiredCapabilities: ['image-input'] as const }
    const check = satisfiesPolicy(vision, { inputModalities: ['text'], toolUpdate: undefined, reportedCacheTokens: false })
    expect(check).toEqual({ ok: false, missing: ['image-input'] })
  })

  it('never reads a route that declared nothing as a capable one', () => {
    const check = satisfiesPolicy(policy, { inputModalities: null, toolUpdate: undefined, reportedCacheTokens: false })
    expect(check).toEqual({ ok: false, missing: ['text-input'] })
  })
})

describe('capabilityCheck', () => {
  it('reads each capability off the declaration a real request earned', () => {
    expect(capabilityCheck('image-input', { inputModalities: ['image'], toolUpdate: undefined, reportedCacheTokens: false })).toBe(true)
    expect(capabilityCheck('image-input', { inputModalities: ['text'], toolUpdate: undefined, reportedCacheTokens: false })).toBe(false)
    expect(capabilityCheck('tool-update', { inputModalities: ['text'], toolUpdate: 'in-history', reportedCacheTokens: false })).toBe(true)
    expect(capabilityCheck('tool-update', { inputModalities: ['text'], toolUpdate: undefined, reportedCacheTokens: false })).toBe(false)
    expect(capabilityCheck('cache-tokens', { inputModalities: ['text'], toolUpdate: undefined, reportedCacheTokens: true })).toBe(true)
    expect(capabilityCheck('cache-tokens', { inputModalities: ['text'], toolUpdate: undefined, reportedCacheTokens: false })).toBe(false)
  })
})

describe('classifyDeadline', () => {
  it('reads a timeout as a recoverable failure, never as a user cancellation', () => {
    // DD10: both fire the same AbortSignal, and reading them as one fact is how
    // a recoverable retry gets recorded as a user decision.
    const timedOut = classifyDeadline(policy, { elapsedRequestMs: 30_001, elapsedTaskMs: 5_000, cancelled: false })
    expect(timedOut.kind).toBe('timeout')
    expect(timedOut.kind === 'timeout' && timedOut.recoverable).toBe(true)
  })

  it('reads a caller cancellation as a control result, not a timeout', () => {
    const cancelled = classifyDeadline(policy, { elapsedRequestMs: 10, elapsedTaskMs: 20, cancelled: true })
    expect(cancelled.kind).toBe('cancelled')
  })

  it('reports a request inside both deadlines as still running', () => {
    const running = classifyDeadline(policy, { elapsedRequestMs: 29_999, elapsedTaskMs: 119_999, cancelled: false })
    expect(running.kind).toBe('running')
  })

  it('names the whole-task deadline as the one that expired', () => {
    const expired = classifyDeadline(policy, { elapsedRequestMs: 1, elapsedTaskMs: 120_001, cancelled: false })
    expect(expired.kind === 'timeout' && expired.deadline).toBe('task')
  })

  it('prefers the request deadline when both have expired', () => {
    const expired = classifyDeadline(policy, { elapsedRequestMs: 40_000, elapsedTaskMs: 130_000, cancelled: false })
    expect(expired.kind === 'timeout' && expired.deadline).toBe('request')
  })
})

describe('deadlineDecision', () => {
  it('sends an expired request to the fallback route rather than to a retry of itself', () => {
    const decision = deadlineDecision(policy, { elapsedRequestMs: 30_001, elapsedTaskMs: 5_000, cancelled: false })
    expect(decision).toEqual({ kind: 'fallback-route', route: policy.fallback })
  })

  it('escalates rather than looping when no fallback route exists', () => {
    const noFallback = { ...policy, fallback: null }
    const decision = deadlineDecision(noFallback, { elapsedRequestMs: 30_001, elapsedTaskMs: 5_000, cancelled: false })
    expect(decision).toEqual({ kind: 'escalate', condition: 'route-timeout' })
  })

  it('never turns a timeout into a cancellation decision', () => {
    // The failure contrast: a timeout that is read as a user cancellation stops
    // the task instead of recovering it, so the two decisions never collide.
    const timedOut = deadlineDecision(policy, { elapsedRequestMs: 30_001, elapsedTaskMs: 5_000, cancelled: false })
    const cancelled = deadlineDecision(policy, { elapsedRequestMs: 30_001, elapsedTaskMs: 5_000, cancelled: true })
    expect(timedOut.kind).toBe('fallback-route')
    expect(cancelled).toEqual({ kind: 'cancelled' })
  })

  it('keeps a request inside both deadlines running rather than moving it', () => {
    const running = deadlineDecision(policy, { elapsedRequestMs: 1, elapsedTaskMs: 2, cancelled: false })
    expect(running).toEqual({ kind: 'running' })
  })
})

describe('validateAgainst', () => {
  it('accepts a result the policy\'s validators accept', () => {
    expect(validateAgainst(policy, { failedValidators: [] })).toEqual({ kind: 'accepted' })
  })

  it('routes a validator rejection to the fallback, never to a model refusal', () => {
    // The failure contrast: a validator rejecting a result is not the model
    // refusing to answer, so it never reports a connection verdict.
    const rejected = validateAgainst(policy, { failedValidators: ['response-schema'] })
    expect(rejected).toEqual({ kind: 'retry-on-fallback', route: policy.fallback, validators: ['response-schema'] })
    expect(rejected).not.toHaveProperty('verdict')
  })

  it('escalates a rejection when the policy has no fallback route', () => {
    const noFallback = { ...policy, fallback: null }
    expect(validateAgainst(noFallback, { failedValidators: ['response-schema'] })).toEqual({
      kind: 'escalate',
      condition: 'validator-rejected',
      validators: ['response-schema'],
    })
  })

  it('rejects a result that violates a validator the policy never declared', () => {
    const undeclared = validateAgainst(policy, { failedValidators: ['uniqueness' as never] })
    expect(undeclared).toEqual({ kind: 'escalate', condition: 'validator-rejected', validators: ['uniqueness'] })
  })
})

describe('escalationFor', () => {
  const declared = { ...policy, escalation: ['user-confirmation', 'route-timeout', 'validator-rejected'] as const }

  it('names the owner who takes over each escalation condition', () => {
    expect(escalationFor(declared, 'user-confirmation')).toEqual({ kind: 'user-confirmation', owner: 'user' })
    expect(escalationFor(declared, 'route-timeout')).toEqual({ kind: 'route-timeout', owner: 'strong-model' })
    expect(escalationFor(declared, 'validator-rejected')).toEqual({ kind: 'validator-rejected', owner: 'session' })
  })

  it('reports a condition the policy does not declare rather than inventing an owner', () => {
    expect(escalationFor({ ...policy, escalation: [] }, 'user-confirmation')).toBeUndefined()
  })
})

describe('parseStoredPolicy', () => {
  it('accepts a record this release wrote', () => {
    expect(parseStoredPolicy(policy)).toEqual(policy)
  })

  it('rejects a record another release wrote, so the policy is re-issued', () => {
    expect(parseStoredPolicy({ ...policy, version: 'web-test-route-policy/0' })).toBeUndefined()
  })

  it('rejects a value that is not a record at all', () => {
    expect(parseStoredPolicy(null)).toBeUndefined()
    expect(parseStoredPolicy('web-test-route-policy/1')).toBeUndefined()
    expect(parseStoredPolicy(undefined)).toBeUndefined()
  })

  it('rejects a record whose task kind this release does not route', () => {
    expect(parseStoredPolicy({ ...policy, taskKind: 'requirements-and-planning' })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, taskKind: 3 })).toBeUndefined()
  })

  it('rejects a record whose routes name nothing to address', () => {
    expect(parseStoredPolicy({ ...policy, primary: undefined })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, primary: 'deepseek-v4-pro' })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, primary: { model: 'deepseek-v4-pro', credentialRef: null } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, fallback: { provider: 'p', credentialRef: null } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, fallback: 7 })).toBeUndefined()
  })

  it('rejects a credential reference outside the grammar', () => {
    expect(parseStoredPolicy({ ...policy, primary: { ...policy.primary, credentialRef: 7 } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, primary: { ...policy.primary, credentialRef: 'not a reference' } })).toBeUndefined()
  })

  it('rejects a record whose capabilities, validators, escalations, or versions are not what this release writes', () => {
    expect(parseStoredPolicy({ ...policy, requiredCapabilities: ['telepathy' as never] })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, requiredCapabilities: 'text-input' })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, validators: ['vibes' as never] })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, escalation: ['when-it-feels-wrong' as never] })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, primary: { ...policy.primary, modelVersion: 1 } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, primary: { ...policy.primary, model: '' } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, primary: { ...policy.primary, provider: '' } })).toBeUndefined()
  })

  it('rejects a record whose deadlines, identities, or instant are not usable', () => {
    expect(parseStoredPolicy({ ...policy, timeouts: { requestMs: 0, taskMs: 1 } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, timeouts: { requestMs: 1_000 } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, timeouts: { requestMs: 1_000, taskMs: 500 } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, timeouts: { requestMs: Number.NaN, taskMs: 1_000 } })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, timeouts: undefined })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, policyId: '' })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, revision: 4 })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, inputGenerationVersion: '' })).toBeUndefined()
    expect(parseStoredPolicy({ ...policy, effectiveFrom: '1700000000000' })).toBeUndefined()
  })

  it('re-brands a stored credential reference instead of carrying the raw string', () => {
    // Deliberately unannotated. A value read out of a file carries plain
    // strings, and `parseStoredPolicy` re-brands them on the way in, so
    // declaring this a `RoutePolicyRevision` would assert as already true the
    // exact fact this case exists to establish.
    const referenced = {
      ...policy,
      primary: { ...policy.primary, credentialRef: 'DEEPSEEK_API_KEY' },
      fallback: { ...policy.fallback!, credentialRef: 'DEEPSEEK_API_KEY' },
    }
    expect(parseStoredPolicy(referenced)).toEqual(referenced)
  })

  it('accepts a record that pins no model version and no fallback', () => {
    const sparse: RoutePolicyRevision = {
      ...policy,
      primary: { ...policy.primary, modelVersion: null },
      fallback: null,
      validators: [],
      escalation: [],
    }
    expect(parseStoredPolicy(sparse)).toEqual(sparse)
  })
})

describe('immutability', () => {
  const workId = brandString<PolicyWorkId>('work-1')

  it('obligation 1: a run references the policy revision it was admitted under', () => {
    const first = policyRecord(policy, workId, 1_700_000_000_000)
    const second = policyRecord({ ...policy, revision: brandString<PolicyRevisionId>('rev-2') }, workId, 1_700_000_100_000)
    // A later revision is issued and adopted for new work; the run that was
    // already admitted keeps the revision and routes it was pinned to.
    expect(first.revision).toBe(policy.revision)
    expect(first.primary).toEqual(policy.primary)
    expect(first.fallback).toEqual(policy.fallback)
    expect(second.revision).not.toBe(first.revision)
  })

  it('copies a run\'s routes and deadlines so a later revision cannot reach back into it', () => {
    const workId = brandString<PolicyWorkId>('work-1')
    const record = policyRecord(policy, workId, 1_700_000_000_000)
    // The record is frozen and holds copies, so a caller mutating the policy it
    // was admitted under cannot change what this run is held to.
    expect(Object.isFrozen(record)).toBe(true)
    expect(record.primary).not.toBe(policy.primary)
    expect(record.fallback).not.toBe(policy.fallback)
    expect(record.timeouts).not.toBe(policy.timeouts)
    const noFallback = policyRecord({ ...policy, fallback: null }, workId, 1_700_000_000_000)
    expect(noFallback.fallback).toBeNull()
  })

  it('obligation 2: repairing a credential leaves every recorded choice byte-identical', () => {
    const before = policyRecord(policy, workId, 1_700_000_000_000)
    const repaired = {
      ...before,
      // The credential reference is a name. A new value written under it moves
      // neither the name nor the routes that resolve keys through it.
      primary: { ...before.primary, credentialRef: 'DEEPSEEK_API_KEY' as never },
    }
    expect(repaired.revision).toBe(before.revision)
    expect(repaired.taskKind).toBe(before.taskKind)
    expect(repaired.timeouts).toEqual(before.timeouts)
    expect(repaired.validators).toEqual(before.validators)
  })

  it('obligation 3: a request already sent keeps its routeRevision and result ownership', () => {
    const pinned = policyRecord(policy, workId, 1_700_000_000_000)
    const next = policyRecord({ ...policy, revision: brandString<PolicyRevisionId>('rev-2') }, workId, 1_700_000_100_000)
    // The request is read against the policy its own record names, so issuing a
    // new revision does not re-own a result that was already sent.
    const owning = readOwnership(pinned, 'request-1')
    expect(owning.routeRevision).toBe(policy.revision)
    expect(owning.resultOwner).toBe(workId)
    expect(owning.routeRevision).not.toBe(next.revision)
  })
})

/** One already-sent request's ownership, read from the record that pinned it. */
interface RequestOwnership {
  /** The revision the request was issued under. */
  readonly routeRevision: PolicyRevisionId
  /** The run the request's result belongs to. */
  readonly resultOwner: PolicyWorkId
  /** The request's own id. */
  readonly requestId: string
}

/** Read one already-sent request's ownership out of the record that pinned it. */
function readOwnership(record: PolicyRecord, requestId: string): RequestOwnership {
  return { routeRevision: record.revision, resultOwner: record.workId, requestId }
}

describe('version independence', () => {
  it('stamps a policy version beside the selection version, replacing nothing', () => {
    expect(ROUTE_POLICY_VERSION).toBe('web-test-route-policy/1')
    expect(ROUTE_SELECTION_VERSION).toBe('web-test-routes/1')
    expect(ROUTE_POLICY_VERSION).not.toBe(ROUTE_SELECTION_VERSION)
  })

  it('keeps the two version brands non-interchangeable at the type level', () => {
    const policyVersion: RoutePolicyVersion = ROUTE_POLICY_VERSION
    expect(policyVersion).toBe(ROUTE_POLICY_VERSION)
  })
})

it('refuses persisted capability minima removal and mismatched task type; owns every parsed array', () => {
  const raw = { ...policy, taskKind:'visual-inspection', taskType:'vision',requiredCapabilities:['image-input'], validators:['response-schema'], escalation:['route-timeout'] }
  expect(parseStoredPolicy({ ...raw,requiredCapabilities:[] })).toBeUndefined()
  expect(parseStoredPolicy({ ...raw,taskType:'analysis' })).toBeUndefined()
  const parsed = parseStoredPolicy(raw)
  if(!parsed) throw new Error('fixture refused')
  raw.requiredCapabilities.splice(0);raw.validators.splice(0);raw.escalation.splice(0)
  expect(parsed.requiredCapabilities).toEqual(['image-input']);expect(parsed.validators).toEqual(['response-schema']);expect(parsed.escalation).toEqual(['route-timeout'])
})
