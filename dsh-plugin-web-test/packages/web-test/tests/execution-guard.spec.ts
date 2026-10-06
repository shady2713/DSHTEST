/**
 * The execution policy the test preset enforces before any tool body runs.
 *
 * These tests cover the pure decision, so they state what a call may and may not
 * do rather than how the guard is registered.
 *
 * @module dsh-plugin-web-test/tests/execution-guard
 */

import { describe, expect, it } from 'vitest'
import { ROLE_BROWSER_PREFIX, HELD_RUN_ALLOWED_TOOLS, TOOL_PREFIX, guardReason } from '../src/agent.ts'

/** A store whose only held run is the one a test declares. */
function holding(runKey: string, status: string): GuardStore {
  return {
    holdForSession: (sessionId: string) => (sessionId === 'owner' ? { runKey, status } : undefined),
    browserGrantForSession: () => undefined,
    mayPrepareIdentity: () => false,
  }
}

/** The store surface the guard reads. */
interface GuardStore {
  holdForSession: (sessionId: string) => { runKey: string, status: string } | undefined
  browserGrantForSession: (sessionId: string) => { runKey: string, status: string, role: string } | undefined
  mayPrepareIdentity: (sessionId: string, role: string) => boolean
  requireAuthority?: (token: string, agentId: string) => { runKey: string, role: string }
}

/** A store whose run has a verified role and one live authority. */
function actingAs(role: string, accepted: string[]): GuardStore {
  return {
    holdForSession: () => undefined,
    browserGrantForSession: () => ({ runKey: 'run-1', status: 'running', role }),
    mayPrepareIdentity: () => false,
    requireAuthority: (token, agentId) => {
      if (agentId !== 'agent-a') throw new Error(`web-test: that authority belongs to another agent (${agentId})`)
      if (!accepted.includes(token)) throw new Error('web-test: authority was minted in generation 0 of run "run-1", which is now generation 1')
      return { runKey: 'run-1', role }
    },
  }
}

describe('business action authority', () => {
  it('admits an action that presents the authority it was issued', () => {
    const store = actingAs('alice', ['tok-live'])
    expect(guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: { authority: 'tok-live' }, agent: { id: 'agent-a' } },
      store,
    )).toBeUndefined()
  })

  it('refuses an action that presents no authority', () => {
    const refusal = guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: {}, agent: { id: 'agent-a' } },
      actingAs('alice', ['tok-live']),
    )
    expect(refusal).toContain('needs the authority')
  })

  it('refuses an action carrying an authority from an earlier generation', () => {
    const refusal = guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: { authority: 'tok-old' }, agent: { id: 'agent-a' } },
      actingAs('alice', ['tok-live']),
    )
    expect(refusal).toContain('generation 0')
  })

  it('refuses an action presenting another agent\'s authority', () => {
    const refusal = guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: { authority: 'tok-live' }, agent: { id: 'agent-b' } },
      actingAs('alice', ['tok-live']),
    )
    expect(refusal).toContain('another agent')
  })

  it('leaves a login step free of authority', () => {
    expect(guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: {}, agent: { id: 'agent-a' } },
      { ...actingAs('alice', []), mayPrepareIdentity: () => true },
    )).toBeUndefined()
  })
})

describe('tool allowlist', () => {
  it('admits this plugin\'s own tools', () => {
    for (const name of [`${TOOL_PREFIX}status`, `${TOOL_PREFIX}start_run`, `${TOOL_PREFIX}begin_operation`]) {
      expect(guardReason({ name })).toBeUndefined()
    }
  })

  it('admits the active role\'s browser under its authority and refuses another role\'s', () => {
    const asAlice: GuardStore = {
      holdForSession: () => undefined,
      browserGrantForSession: () => ({ runKey: 'run-1', status: 'running', role: 'alice' }),
      mayPrepareIdentity: () => false,
      requireAuthority: () => ({ runKey: 'run-1', role: 'alice' }),
    }
    expect(guardReason(
      { name: 'mcp__playwright-role-alice__browser_navigate', arguments: { authority: 'tok' }, agent: { id: 'agent-a' } },
      asAlice,
    )).toBeUndefined()
    // A second role's browser is a different account, so naming it must not be
    // a way to act as that account.
    const crossed = guardReason({ name: 'mcp__playwright-role-bob__browser_navigate' }, asAlice)
    expect(crossed).toContain('belongs to another role')
    expect(crossed).toContain('web_test_assume_role')
  })

  it('refuses every browser when the session has no verified role', () => {
    const reason = guardReason(
      { name: 'mcp__playwright-role-alice__browser_navigate' },
      { holdForSession: () => undefined, browserGrantForSession: () => undefined, mayPrepareIdentity: () => false },
    )
    expect(reason).toContain('no run that may drive a browser')
  })

  it('refuses a role whose identity the site never confirmed', () => {
    // The store answers with an empty role when the run's role has no recorded
    // account, so an unverified role cannot become reachable.
    const unverified = guardReason(
      { name: 'mcp__playwright-role-alice__browser_navigate' },
      { holdForSession: () => undefined, browserGrantForSession: () => undefined, mayPrepareIdentity: () => false },
    )
    expect(unverified).toContain('no run that may drive a browser')
  })

  it('refuses a shell tool even when the composition offers it, and names it', () => {
    const reason = guardReason({ name: 'bash' })
    expect(reason).toContain('may only call web_test_* and the active role')
    expect(reason).toContain('"bash"')
  })

  it('refuses another MCP server\'s tools, so a global browser provider stays outside', () => {
    expect(guardReason({ name: 'mcp__other-browser__navigate' })).toMatch(/outside the test execution policy/)
  })

  it('refuses a file-writing tool', () => {
    expect(guardReason({ name: 'fs_write' })).toMatch(/outside the test execution policy/)
  })
})

describe('operator holds', () => {
  it("refuses the held run's own actions, and still lets a new run start", () => {
    const store = holding('run-1', 'paused')
    expect(guardReason({ name: `${ROLE_BROWSER_PREFIX}browser_navigate` }, store, 'owner'))
      .toMatch(/run run-1 is paused/)
    // A paused or restarting run must not be able to block the session forever:
    // starting a different run is how the operator gets moving again, and the
    // new run gets authority of its own rather than the held run's.
    expect(guardReason({ name: `${TOOL_PREFIX}start_run` }, store, 'owner')).toBeUndefined()
  })

  it('keeps the reporting and bookkeeping tools reachable, so a held run stays recordable', () => {
    const store = holding('run-1', 'paused')
    for (const name of HELD_RUN_ALLOWED_TOOLS) {
      expect(guardReason({ name }, store, 'owner')).toBeUndefined()
    }
  })

  it('leaves a session that owns no held run working', () => {
    // Another session's pause must not stop this one's test work, including its
    // browser, as long as that browser belongs to a role this session verified.
    const store: GuardStore = {
      holdForSession: (sessionId: string) => (sessionId === 'owner' ? { runKey: 'run-1', status: 'paused' } : undefined),
      browserGrantForSession: () => ({ runKey: 'run-1', status: 'running', role: 'alice' }),
      mayPrepareIdentity: () => false,
      requireAuthority: () => ({ runKey: 'run-1', role: 'alice' }),
    }
    expect(guardReason(
      { name: 'mcp__playwright-role-alice__browser_navigate', arguments: { authority: 'tok' }, agent: { id: 'other' } },
      store, 'other')).toBeUndefined()
    // A tool of no role at all is still outside the policy, rather than
    // something the guard waves through.
    expect(guardReason({ name: 'mcp__other-browser__navigate' }, store, 'other')).toMatch(/outside the test execution policy/)
    // The stub holds a valid grant, so its own role's browser is reachable even
    // though another session's run is paused; a foreign namespace is not.
    expect(guardReason({ name: 'mcp__playwright-role-bob__browser_navigate' }, store, 'other'))
      .toContain('belongs to another role')
  })

  it('admits a sign-in before the role is verified, including pressing its button', () => {
    const preparing: GuardStore = {
      holdForSession: () => undefined,
      browserGrantForSession: () => undefined,
      mayPrepareIdentity: (_sessionId, role) => role === 'alice',
    }
    // Reading, filling, and pressing the form's button is how a person gets
    // signed in before the first verified switch.
    expect(guardReason({ name: 'mcp__playwright-role-alice__browser_navigate' }, preparing)).toBeUndefined()
    expect(guardReason({ name: 'mcp__playwright-role-alice__browser_fill_form' }, preparing)).toBeUndefined()
    expect(guardReason({ name: 'mcp__playwright-role-alice__browser_click' }, preparing)).toBeUndefined()
    // And a role the run does not declare is never prepared.
    expect(guardReason({ name: 'mcp__playwright-role-bob__browser_navigate' }, preparing))
      .toContain('no run that may drive a browser')
  })

  it('asks for the operator, not for a tool that does not exist', () => {
    const reason = guardReason(
      { name: 'mcp__playwright-role-alice__browser_navigate' },
      holding('run-1', 'paused'),
      'owner',
    )
    expect(reason).toContain('Ask the operator to continue it')
    // The earlier wording pointed at `web_test_resume_run`, which the policy
    // refuses to admit, so the message could not be followed.
    expect(reason).not.toContain('web_test_resume_run')
  })

  it('explains a restart interruption differently from an operator decision', () => {
    const reason = guardReason({ name: `${TOOL_PREFIX}begin_operation` }, holding('run-1', 'resuming'), 'owner')
    expect(reason).toContain('The DSH host restarted during that run')
    expect(reason).toContain('web_test_status')
  })

  it('still enforces the allowlist for a session with no hold at all', () => {
    expect(guardReason({ name: 'bash' }, undefined, 'owner')).toMatch(/outside the test execution policy/)
  })

  it('keeps run control reachable while a run is held, so an interrupted run can be continued', () => {
    // A run a host restart left `resuming` refuses every test action, and
    // `web_test_status` tells the operator it needs continuing. Without a
    // control tool the session can read that forever and never act on it.
    expect(HELD_RUN_ALLOWED_TOOLS).toContain('web_test_control_run')
  })

})
