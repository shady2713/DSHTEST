/**
 * The declaration and authorization rules, and the scope the decision reads
 * through the single domain writer.
 *
 * The `runtime-scope` case boots the real `ctx.webTestRuntime` over a temporary
 * control root, so the revision the policy reads is one the writer published.
 * It is the only case here that needs a Windows kernel lock, and it self-skips
 * elsewhere; everything else in this file is platform-neutral.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandReceipt, ProjectId, ProjectMetadata } from '@deepseek-ai/dsh-web-test-contracts'
import { PROJECT_ID_PATTERN } from '@deepseek-ai/dsh-web-test-contracts/types'
import { WebTestPolicyError } from '../src/index.ts'
import { declarationRequest, flowId, flowRevision, projectId, publishedScope, sessionId, startPolicy, type PolicyHarness } from './harness.ts'

let harness: PolicyHarness | undefined

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

/** Whether Windows is the host, which is where the single domain writer runs. */
const onWindows = process.platform === 'win32'

describe('environment declaration', () => {
  it('refuses to declare an environment for a project the head does not publish', async () => {
    harness = await startPolicy()
    const unpublished = brandString<ProjectId>(`project-${'d'.repeat(32)}`)
    harness.policy.bindEntry(sessionId, unpublished)
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.declareEnvironment({
        projectId: unpublished,
        commandId: 'cmd-declare-unpublished',
        declaration: {
          codeRoots: [harness.codeRoot],
          entryUrl: 'http://localhost:3000/checkout',
          isTestEnvironment: true,
          login: { state: 'not-required' },
          supplementaryRequirements: [],
        },
      })
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/project-unpublished')
  })

  it('refuses a declaration naming a tree other than the one the project published', async () => {
    harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot])
    harness.policy.bindEntry(sessionId, projectId)
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.declareEnvironment(declarationRequest([harness.outsideFile]))
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/code-root-mismatch')
  })

  it('refuses a protected directory that lies inside the tested code root', async () => {
    harness = await startPolicy({ protectedInsideCodeRoot: true })
    harness.policy.bindEntry(sessionId, projectId)
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/protected-path-inside-code-root')
  })

  it('invalidates every grant and forces re-verification when the environment changes', async () => {
    harness = await startPolicy()
    harness.admit()
    const read = {
      sessionId,
      effect: { kind: 'read-source' as const, path: harness.sourceFile },
      entry: 'read',
    }
    expect(harness.policy.evaluate(read).allowed).toBe(true)
    const firstDeclaration = harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))
    expect(harness.policy.evaluate(read).allowed).toBe(true)

    const changed = harness.policy.declareEnvironment(
      declarationRequest([harness.codeRoot], { entryUrl: 'http://localhost:3000/cart' }),
    )
    expect(changed.declarationId).not.toBe(firstDeclaration.declarationId)
    expect(harness.policy.evaluate(read)).toEqual({
      allowed: false, reason: 'denied-expired-authorization', subject: harness.sourceFile,
    })

    const repeated = harness.policy.declareEnvironment(
      declarationRequest([harness.codeRoot], { entryUrl: 'http://localhost:3000/cart' }),
    )
    expect(repeated.declarationId).toBe(changed.declarationId)
    expect(harness.policy.evaluate(read).allowed).toBe(false)
    harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 5 })
    expect(harness.policy.evaluate(read).allowed).toBe(true)
  })

  it('invalidates every grant when the published project revision moves', async () => {
    harness = await startPolicy()
    harness.admit()
    const read = {
      sessionId,
      effect: { kind: 'read-source' as const, path: harness.sourceFile },
      entry: 'read',
    }
    expect(harness.policy.evaluate(read).allowed).toBe(true)
    harness.publishRevision(2)
    expect(harness.policy.evaluate(read).reason).toBe('denied-expired-authorization')
    harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 5 })
    expect(harness.policy.evaluate(read).allowed).toBe(true)
  })

  it('refuses a grant whose project has no confirmed environment', async () => {
    harness = await startPolicy()
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 5 })
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/no-declaration')
  })

  it('refuses a grant above the configured action ceiling rather than reducing it', async () => {
    harness = await startPolicy()
    harness.admit()
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 5_000 })
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/grant-exceeds-limit')
  })

  it('stops applying a grant once its validity has passed', async () => {
    harness = await startPolicy()
    harness.admit()
    const read = {
      sessionId,
      effect: { kind: 'read-source' as const, path: harness.sourceFile },
      entry: 'read',
    }
    expect(harness.policy.evaluate(read).allowed).toBe(true)
    harness.clock.now += 300_001
    expect(harness.policy.evaluate(read).reason).toBe('denied-expired-authorization')
  })

  it('treats a re-issued grant as the same authorization, not a fresh budget', async () => {
    harness = await startPolicy()
    harness.admit({ actions: 2 })
    const first = harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 2 })
    expect(first.actions).toBe(2)
    harness.clock.now += 1_000
    // A re-issue of the same flow reports the record that stands: its identity,
    // the actions it still has, and the instant it still expires at. It is not
    // a second authorization and it does not extend the first one's validity.
    const second = harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 2 })
    expect(second).toEqual(first)
    expect(await harness.callTool('read', { file_path: harness.sourceFile })).toBe('ran:read')
    // A third re-issue, asking for more than the ceiling allows the flow to
    // begin with, reports the one action the flow has left rather than handing
    // out a new budget.
    const third = harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 40 })
    expect(third.actions).toBe(1)
    expect(third.expiresAt).toBe(first.expiresAt)
    expect(await harness.callTool('read', { file_path: harness.sourceFile })).toBe('ran:read')
    expect(await harness.callTool('read', { file_path: harness.sourceFile })).toContain('denied-expired-authorization')
  })

  it('refuses a session that is not bound, and a sessionless call when two projects apply', async () => {
    harness = await startPolicy()
    harness.admit()
    const other = brandString<ProjectId>(`project-${'b'.repeat(32)}`)
    const read = {
      sessionId: 'session-unbound',
      effect: { kind: 'read-source' as const, path: harness.sourceFile },
      entry: 'read',
    }
    expect(harness.policy.evaluate(read)).toEqual({
      allowed: false, reason: 'denied-outside-scope', subject: 'session-unbound',
    })
    harness.publishSecond({ ...harness.published.current, projectId: other })
    harness.policy.bindEntry(sessionId, other)
    harness.policy.declareEnvironment({
      ...declarationRequest([harness.codeRoot]),
      projectId: other,
    })
    const sessionless = {
      sessionId: null,
      effect: { kind: 'read-source' as const, path: harness.sourceFile },
      entry: 'read',
    }
    expect(harness.policy.evaluate(sessionless).reason).toBe('denied-outside-scope')
    expect(harness.policy.evaluate(sessionless).subject).toBe('read')
  })

  it('withdraws a binding when its disposer runs', async () => {
    harness = await startPolicy()
    const release = harness.policy.bindEntry(sessionId, projectId)
    harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))
    harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 5 })
    const read = {
      sessionId,
      effect: { kind: 'read-source' as const, path: harness.sourceFile },
      entry: 'read',
    }
    expect(harness.policy.evaluate(read).allowed).toBe(true)
    release()
    expect(harness.policy.evaluate(read).subject).toBe(sessionId)
  })

  it('leaves a later binding standing when an earlier disposer runs', async () => {
    harness = await startPolicy()
    const first = brandString<ProjectId>(`project-${'e'.repeat(32)}`)
    harness.publishSecond({ ...harness.published.current, projectId: first })
    const release = harness.policy.bindEntry(sessionId, first)
    harness.policy.declareEnvironment({
      projectId: first,
      commandId: 'cmd-declare-first',
      declaration: { codeRoots: [harness.codeRoot], entryUrl: null, isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: [] },
    })
    harness.policy.bindEntry(sessionId, projectId)
    release()
    harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))
    harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 5 })
    expect(harness.policy.evaluate({
      sessionId,
      effect: { kind: 'read-source', path: harness.sourceFile },
      entry: 'read',
    }).allowed).toBe(true)
  })

  it('refuses a declared code root that is a link or is absent', async () => {
    const linked = await startPolicy()
    try {
      const { symlinkSync, renameSync } = await import('node:fs')
      linked.policy.bindEntry(sessionId, projectId)
      linked.policy.declareEnvironment(declarationRequest([linked.codeRoot]))
      const moved = `${linked.codeRoot}-moved`
      renameSync(linked.codeRoot, moved)
      symlinkSync(moved, linked.codeRoot, 'junction')
      // The target still resolves, so only re-resolving the declared root catches
      // that the root itself was replaced.
      expect(linked.policy.evaluate({
        sessionId,
        effect: { kind: 'read-source', path: join(linked.codeRoot, 'src', 'app.ts') },
        entry: 'read',
      })).toEqual({
        allowed: false, reason: 'denied-unknown-target', subject: resolve(linked.codeRoot),
      })
    } finally {
      await linked.stop()
    }
    const absent = await startPolicy()
    try {
      absent.policy.bindEntry(sessionId, projectId)
      const { rmSync } = await import('node:fs')
      rmSync(absent.codeRoot, { recursive: true, force: true })
      let raised: WebTestPolicyError | undefined
      try {
        absent.policy.declareEnvironment(declarationRequest([absent.codeRoot]))
      } catch (error: unknown) {
        raised = error instanceof WebTestPolicyError ? error : undefined
      }
      expect(raised?.code).toBe('web-test-policy/unresolved-path')
    } finally {
      await absent.stop()
    }
  })

  it('declares an environment with no entry URL, and with one it cannot compare', async () => {
    harness = await startPolicy()
    const noEntry = harness.policy.declareEnvironment(
      declarationRequest([harness.codeRoot], { entryUrl: null }),
    )
    expect(noEntry.entryOrigins).toEqual([])
    const unparseable = harness.policy.declareEnvironment(
      declarationRequest([harness.codeRoot], { entryUrl: 'checkout' }),
    )
    expect(unparseable.entryOrigins).toEqual([])
    expect(unparseable.declarationId).not.toBe(noEntry.declarationId)
  })

  it('refuses to grant against a project whose published scope has gone', async () => {
    harness = await startPolicy({ withdrawPublishedScope: true })
    harness.policy.bindEntry(sessionId, projectId)
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/project-unpublished')
  })

  it('refuses a read before any grant exists, and names the session when none is bound', async () => {
    harness = await startPolicy()
    harness.policy.bindEntry(sessionId, projectId)
    harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))
    const read = {
      sessionId,
      effect: { kind: 'read-source' as const, path: harness.sourceFile },
      entry: 'read',
    }
    expect(harness.policy.evaluate(read).reason).toBe('denied-expired-authorization')
    expect(harness.policy.evaluate({ ...read, sessionId: 'session-absent' })).toEqual({
      allowed: false, reason: 'denied-outside-scope', subject: 'session-absent',
    })
  })

  it('refuses a read for a bound project that has declared no environment', async () => {
    harness = await startPolicy()
    harness.policy.bindEntry(sessionId, projectId)
    expect(harness.policy.evaluate({
      sessionId,
      effect: { kind: 'read-source', path: harness.sourceFile },
      entry: 'read',
    })).toEqual({ allowed: false, reason: 'denied-outside-scope', subject: 'read' })
  })

  it('refuses to grant against a project whose published scope has gone since the declaration', async () => {
    harness = await startPolicy()
    harness.policy.bindEntry(sessionId, projectId)
    harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))
    harness.withdrawPublishedScope()
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 5 })
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/project-unpublished')
  })

  it('refuses a code root the declaration names as a link', async () => {
    harness = await startPolicy()
    const { symlinkSync } = await import('node:fs')
    const link = join(harness.root, 'code-link')
    symlinkSync(harness.codeRoot, link, 'junction')
    harness.published.current = { ...harness.published.current, codeRoots: [link] }
    harness.policy.bindEntry(sessionId, projectId)
    let raised: WebTestPolicyError | undefined
    try {
      harness.policy.declareEnvironment(declarationRequest([link]))
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/link-path')
  })
})

/**
 * The project identity a registration receipt carries. A receipt names either
 * kind of resource, so the value is checked against the contract's own project
 * identity format before it is used as one: a registration that named something
 * other than a project fails here rather than reading an unrelated resource.
 * @param receipt - the receipt a project registration committed.
 * @returns the registered project's identity.
 */
function registeredProjectId(receipt: CommandReceipt): ProjectId {
  const { resourceId } = receipt
  if (!PROJECT_ID_PATTERN.test(resourceId)) {
    throw new Error(`registerProject returned '${resourceId}', which is not a project identity`)
  }
  return brandString<ProjectId>(resourceId)
}

describe('scope read through the single domain writer', () => {
  it.skipIf(!onWindows)('follows the published revision the writer commits, and nothing before it', async () => {
    const { startRuntime } = await import('../../web-test-runtime/tests/harness.ts')
    const { WebTestRuntimeScope } = await import('../src/index.ts')
    const runtime = await startRuntime()
    try {
      const root = mkdtempSync(join(tmpdir(), 'dsh-webtest-runtime-scope-'))
      const codeRoot = resolve(join(root, 'code'))
      mkdirSync(codeRoot, { recursive: true })
      const source = join(codeRoot, 'app.ts')
      writeFileSync(source, 'export const answer = 42\n', 'utf8')

      const scope = new WebTestRuntimeScope(runtime.ctx, runtime.runtime)
      // A project the head publishes no entry for reads as absent rather than as
      // empty scope, so a decision refuses it instead of treating it as a project
      // with nothing to protect.
      expect(scope.readProject(projectId)).toBeUndefined()

      const receipt = await runtime.runtime.registerProject({
        commandId: 'cmd-runtime-scope',
        codeRoots: [codeRoot],
        entryUrls: ['http://localhost:3000/checkout'],
      })
      const registered = registeredProjectId(receipt)
      const published = runtime.runtime.readProject(registered)
      expect(published?.codeRoots).toEqual([codeRoot])
      expect(scope.readProject(registered)?.revision).toBe(published?.revision)

      const atRevisionOne: ProjectMetadata | undefined = scope.readProject(registered)
      const prepared = runtime.runtime.prepareProjectUpdate(registered)
      const commit = await runtime.runtime.commitProjectUpdate(
        { commandId: 'cmd-runtime-scope-2', recordId: prepared.recordId, expectedRevision: prepared.expectedRevision },
        prepared,
        { codeRoots: [codeRoot], entryUrls: ['http://localhost:3000/checkout', 'http://localhost:3000/cart'] },
      )
      expect(commit.acceptedRevision).toBeGreaterThan(atRevisionOne?.revision ?? 0)
      expect(scope.readProject(registered)?.revision).toBe(commit.acceptedRevision)
      expect(scope.readProject(registered)?.entryUrls).toEqual([
        'http://localhost:3000/checkout', 'http://localhost:3000/cart',
      ])
    } finally {
      await runtime.stop()
    }
  })
})
