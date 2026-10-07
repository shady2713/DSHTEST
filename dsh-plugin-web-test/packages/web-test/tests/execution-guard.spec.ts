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
import type { MountOwner } from '../src/role-browser.ts'

/** A store whose only held run is the one a test declares. */
function holding(runKey: string, status: string): GuardStore {
  return {
    holdForSession: (sessionId: string) => (sessionId === 'owner' ? { runKey, status } : undefined),
    hasRunningRun: () => false,
    mayPrepareIdentity: () => false,
  }
}

/** The store surface the guard reads. */
interface GuardStore {
  holdForSession: (sessionId: string) => { runKey: string, status: string } | undefined
  hasRunningRun: (sessionId: string) => boolean
  mayPrepareIdentity: (sessionId: string, role: string, runKey?: string) => boolean
  requireAuthority?: (token: string, agentId: string) => {
    runKey: string, role: string, generation: number, agentId: string
  }
}

/** The pool surface the guard reads: every mount carries its own owner. */
interface GuardPool {
  ownerOfServer: (serverName: string) => MountOwner | undefined
  claimOf: (serverName: string) => { runKey: string, generation: number } | undefined
}

/** A pool holding one mounted browser owned by one run. */
function mounting(owner: MountOwner, claimed = true): GuardPool {
  return {
    ownerOfServer: name => (name === owner.serverName ? owner : undefined),
    claimOf: name => (claimed && name === owner.serverName
      ? { runKey: owner.runKey, generation: owner.generation }
      : undefined),
  }
}

/** A pool holding the given role browsers, each owned by its own run. */
function mountingTwo(all: MountOwner[]): GuardPool {
  return {
    ownerOfServer: name => all.find(m => m.serverName === name),
    claimOf: name => {
      const found = all.find(m => m.serverName === name)
      return found === undefined
        ? undefined
        : { runKey: found.runKey, generation: found.generation }
    },
  }
}

/** The browser tool name a mounted server exposes. */
function toolOf(serverName: string, tool: string): string {
  return `mcp__${serverName}__${tool}`
}

/** The two runs the Windows acceptance found mis-matched. */
const BUYER: MountOwner = {
  sessionId: 'session-1', projectKey: 'shop', environmentKey: 'acc', runKey: 'run-buyer',
  role: 'buyer', generation: 1, serverName: 'playwright-role-buyer',
}
const APPROVER: MountOwner = {
  sessionId: 'session-1', projectKey: 'shop', environmentKey: 'acc', runKey: 'run-approver',
  role: 'approver', generation: 1, serverName: 'playwright-role-approver',
}

/** A store that honours exactly the tokens those two runs were issued. */
function twoRunStore(): GuardStore {
  return {
    holdForSession: () => undefined,
    hasRunningRun: () => true,
    mayPrepareIdentity: () => false,
    requireAuthority: (token, agentId) => {
      if (agentId !== 'agent-a') {
        throw new Error(`web-test: that authority belongs to another agent (${agentId})`)
      }
      if (token === 'tok-buyer') {
        return { runKey: BUYER.runKey, role: BUYER.role, generation: 1, agentId: 'agent-a' }
      }
      if (token === 'tok-approver') {
        return { runKey: APPROVER.runKey, role: APPROVER.role, generation: 1, agentId: 'agent-a' }
      }
      throw new Error('web-test: this call presented no valid authority')
    },
  }
}

/** A store whose run has a verified role and one live authority. */
function actingAs(role: string, accepted: string[]): GuardStore {
  return {
    holdForSession: () => undefined,
    hasRunningRun: () => true,
    mayPrepareIdentity: () => false,
    requireAuthority: (token, agentId) => {
      if (agentId !== 'agent-a') throw new Error(`web-test: that authority belongs to another agent (${agentId})`)
      if (!accepted.includes(token)) throw new Error('web-test: authority was minted in generation 1, not 2')
      return { runKey: ALICE.runKey, role, generation: ALICE.generation, agentId: 'agent-a' }
    },
  }
}

/** The mount those business-action tests drive. */
const ALICE: MountOwner = {
  sessionId: 'session-1', projectKey: 'shop', environmentKey: 'acc', runKey: 'run-1',
  role: 'alice', generation: 2, serverName: 'playwright-role-alice',
}

/** The pool that mounts ALICE's browser. */
const alicePool: GuardPool = mounting(ALICE)


describe('two runs declaring one role', () => {
  const first: MountOwner = {
    sessionId: 'session-1', projectKey: 'shop', environmentKey: 'acc',
    runKey: 'run-a', role: 'buyer', generation: 1, serverName: 'playwright-role-buyer',
  }
  const second: MountOwner = {
    sessionId: 'session-1', projectKey: 'shop', environmentKey: 'acc',
    runKey: 'run-c', role: 'buyer', generation: 1, serverName: 'playwright-role-buyer-g2',
  }

  const store: GuardStore = {
    holdForSession: () => undefined,
    hasRunningRun: () => true,
    mayPrepareIdentity: (_sessionId, role, runKey) => runKey === 'run-c',
    requireAuthority: (token, agentId) => {
      if (agentId !== 'agent-a') throw new Error('web-test: that authority belongs to another agent')
      if (token !== 'tok-c') throw new Error('web-test: this call presented no valid authority')
      return { runKey: 'run-c', role: 'buyer', generation: 1, agentId: 'agent-a' }
    },
  }

  it('lets the run adopt a browser the environment mounted before it existed', () => {
    // `putEnvironment` mounts with no run and no session, so a role browser can be
    // on the agent by the time a run asks for it. That owner names no session, and
    // a session check that read it literally would refuse every call through it.
    const preStarted: MountOwner = {
      sessionId: '', projectKey: 'shop', environmentKey: 'acc',
      runKey: '', role: 'buyer', generation: 0, serverName: 'playwright-role-buyer',
    }
    const adopted: MountOwner = { ...preStarted, runKey: 'run-a', generation: 1 }
    const claimOf = (serverName: string) =>
      serverName === adopted.serverName ? { runKey: 'run-a', generation: 1 } : undefined
    const store: GuardStore = {
      holdForSession: () => undefined,
      hasRunningRun: () => true,
      mayPrepareIdentity: () => false,
      requireAuthority: () => ({ runKey: 'run-a', role: 'buyer', generation: 1, agentId: 'agent-a' }),
    }
    expect(guardReason(
      {
        name: toolOf(adopted.serverName, 'browser_click'),
        arguments: { authority: 'tok-a' }, agent: { id: 'agent-a' },
      },
      store, 'session-1', { ownerOfServer: () => adopted, claimOf },
    )).toBeUndefined()
  })

  it('refuses a token that belongs to another run of the same role', () => {
    // The gap a test found: preparation used to answer a login tool on a claimed
    // mount whatever the call presented, so run-a's authority drove run-c's
    // browser. A presented token must be judged, not laundered into a sign-in.
    const crossed: GuardStore = {
      holdForSession: () => undefined,
      hasRunningRun: () => true,
      mayPrepareIdentity: () => true,
      requireAuthority: () => ({ runKey: 'run-a', role: 'buyer', generation: 1, agentId: 'agent-a' }),
    }
    const refusal = guardReason(
      {
        name: toolOf(second.serverName, 'browser_click'),
        arguments: { authority: 'tok-a' }, agent: { id: 'agent-a' },
      },
      crossed, 'session-1', mountingTwo([first, second]),
    )
    expect(refusal).toContain('not to run')
  })

  it('still admits preparation when the call offers no credential at all', () => {
    expect(guardReason(
      { name: toolOf(second.serverName, 'browser_navigate'), agent: { id: 'agent-a' } },
      store, 'session-1', mountingTwo([first, second]),
    )).toBeUndefined()
  })

  it('admits run C through its own mount while run A holds the same role', () => {
    expect(guardReason(
      {
        name: toolOf(second.serverName, 'browser_click'),
        arguments: { authority: 'tok-c' }, agent: { id: 'agent-a' },
      },
      store, 'session-1', mountingTwo([first, second]),
    )).toBeUndefined()
  })

})

describe('business action authority', () => {
  it('admits an action that presents the authority it was issued', () => {
    const store = actingAs('alice', ['tok-live'])
    expect(guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: { authority: 'tok-live' }, agent: { id: 'agent-a' } },
      store, 'session-1', alicePool,
    )).toBeUndefined()
  })

  it('refuses an action that presents no authority', () => {
    const refusal = guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: {}, agent: { id: 'agent-a' } },
      actingAs('alice', ['tok-live']), 'session-1', alicePool,
    )
    expect(refusal).toContain('needs the authority')
  })

  it('refuses an action carrying an authority from an earlier generation', () => {
    const refusal = guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: { authority: 'tok-old' }, agent: { id: 'agent-a' } },
      actingAs('alice', ['tok-live']), 'session-1', alicePool,
    )
    expect(refusal).toContain('generation 1, not 2')
  })

  it('refuses an action presenting another agent\'s authority', () => {
    const refusal = guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: { authority: 'tok-live' }, agent: { id: 'agent-b' } },
      actingAs('alice', ['tok-live']), 'session-1', alicePool,
    )
    expect(refusal).toContain('another agent')
  })

  it('leaves a login step free of authority', () => {
    expect(guardReason(
      { name: 'mcp__playwright-role-alice__browser_click', arguments: {}, agent: { id: 'agent-a' } },
      { ...actingAs('alice', []), mayPrepareIdentity: () => true }, 'session-1', alicePool, 'session-1', alicePool,
    )).toBeUndefined()
  })
})

describe('tool allowlist', () => {
  it('admits this plugin\'s own tools', () => {
    for (const name of [`${TOOL_PREFIX}status`, `${TOOL_PREFIX}start_run`, `${TOOL_PREFIX}begin_operation`]) {
      expect(guardReason({ name })).toBeUndefined()
    }
  })

  it('admits each mounted browser under its own run authority', () => {
    const store = twoRunStore()
    expect(guardReason(
      { name: toolOf(BUYER.serverName, 'browser_navigate'), arguments: { authority: 'tok-buyer' }, agent: { id: 'agent-a' } },
      store, 'session-1', mountingTwo([BUYER, APPROVER]),
    )).toBeUndefined()
    expect(guardReason(
      { name: toolOf(APPROVER.serverName, 'browser_navigate'), arguments: { authority: 'tok-approver' }, agent: { id: 'agent-a' } },
      store, 'session-1', mountingTwo([BUYER, APPROVER]),
    )).toBeUndefined()

    // Swapping them is refused, and the answer does not depend on run ordering.
    for (const [serverName, token] of [
      [APPROVER.serverName, 'tok-buyer'],
      [BUYER.serverName, 'tok-approver'],
    ]) {
      const refusal = guardReason(
        { name: toolOf(serverName, 'browser_navigate'), arguments: { authority: token }, agent: { id: 'agent-a' } },
        store, 'session-1', mountingTwo([APPROVER, BUYER]),
      )
      expect(refusal).toContain('not to run')
      expect(refusal).toContain('acting as')
    }
  })

  it('refuses a browser whose owner it cannot resolve', () => {
    const reason = guardReason(
      { name: toolOf('playwright-role-alice', 'browser_navigate'), agent: { id: 'agent-a' } },
      { holdForSession: () => undefined, hasRunningRun: () => true, mayPrepareIdentity: () => true },
      'session-1',
      mountingTwo([{ ...APPROVER, serverName: 'playwright-role-other' }]),
    )
    expect(reason).toContain('not a browser this plugin has mounted')
  })

  it('refuses a wrong token instead of falling back to preparation', () => {
    const store: GuardStore = {
      holdForSession: () => undefined, hasRunningRun: () => true, mayPrepareIdentity: () => false,
      requireAuthority: () => { throw new Error('web-test: authority was minted in generation 1, not 2') },
    }
    const refusal = guardReason(
      {
        name: toolOf(BUYER.serverName, 'browser_navigate'),
        arguments: { authority: 'tok-old' }, agent: { id: 'agent-a' },
      },
      store, 'session-1', mounting({ ...BUYER, generation: 2 }),
    )
    // Preparation is closed here, so the wrong token is reported as wrong. It is
    // not admitted as a preparation, which is the fallback this rules out.
    expect(refusal).toContain('generation 1, not 2')
  })

  it('refuses preparation on a mount no run has claimed', () => {
    const refusal = guardReason(
      { name: toolOf(BUYER.serverName, 'browser_navigate'), agent: { id: 'agent-a' } },
      { holdForSession: () => undefined, hasRunningRun: () => true, mayPrepareIdentity: () => true },
      'session-1', mounting({ ...BUYER, runKey: '' }, false),
    )
    // Preparation is not waved through on a mount no run has claimed: the call
    // falls through to the authority check and is refused there instead.
    expect(refusal).toBeDefined()
    expect(refusal).toContain('needs the authority')
  })

  it('refuses an authority from another generation of the same run', () => {
    const store: GuardStore = {
      holdForSession: () => undefined, hasRunningRun: () => true, mayPrepareIdentity: () => false,
      requireAuthority: () => ({ runKey: BUYER.runKey, role: BUYER.role, generation: 0, agentId: 'agent-a' }),
    }
    const refusal = guardReason(
      { name: toolOf(BUYER.serverName, 'browser_click'), arguments: { authority: 'tok-old' }, agent: { id: 'agent-a' } },
      store, 'session-1', mounting(BUYER),
    )
    expect(refusal).toContain('not to run')
  })

  it('leaves a shell tool to the host', () => {
    expect(guardReason({ name: 'bash' })).toBeUndefined()
  })

  it('leaves another MCP server\'s tools to their own provider', () => {
    // This plugin owns the `playwright-role-` browsers only. A different MCP
    // server in the same process belongs to another contribution, and refusing it
    // here would break a composition that mounts both.
    expect(guardReason({ name: 'mcp__other-browser__navigate' })).toBeUndefined()
  })

  it('leaves a file-writing tool to the host', () => {
    // The plugin never granted a file tool to anyone; refusing it was the host's
    // business being taken over by a guard that runs on every execution.
    expect(guardReason({ name: 'fs_write' })).toBeUndefined()
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

  it('leaves a session that owns no held run working, including its own tools', () => {
    // Unchanged in substance: with no held run the plugin has nothing to stop.
    // It now also stops refusing the host's tools, which is what a session with
    // no run would reach first.
    expect(guardReason({ name: 'read_file' }, undefined, 'plain-session')).toBeUndefined()
    expect(guardReason({ name: 'web_test_status' }, undefined, 'plain-session')).toBeUndefined()
  })

  it('admits a sign-in before the role is verified, including pressing its button', () => {
    const preparing: GuardStore = {
      holdForSession: () => undefined,
      hasRunningRun: () => true,
      mayPrepareIdentity: (_sessionId, role) => role === 'alice',
    }
    // Reading, filling, and pressing the form's button is how a person gets
    // signed in before the first verified switch.
    expect(guardReason({ name: 'mcp__playwright-role-alice__browser_navigate' }, preparing, 'session-1', alicePool)).toBeUndefined()
    expect(guardReason({ name: 'mcp__playwright-role-alice__browser_fill_form' }, preparing, 'session-1', alicePool)).toBeUndefined()
    expect(guardReason({ name: 'mcp__playwright-role-alice__browser_click' }, preparing, 'session-1', alicePool)).toBeUndefined()
    // And a role the run does not declare is never prepared.
    // A role this plugin never mounted is refused on the mount, not on the role.
    expect(guardReason({ name: 'mcp__playwright-role-bob__browser_navigate' }, preparing, 'session-1', alicePool))
      .toContain('not a browser this plugin has mounted')
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

  it('leaves the host\'s own tools alone for a session that never asked for a test run', () => {
    // The guard is registered on the host's shared tool runtime, so every
    // execution in the process passes through it. Refusing anything that is not a
    // `web_test_` or role-browser tool denied `read_file`, `bash` and the rest of
    // the host's tools to ordinary DSH conversations that never opened a test
    // session. Checking that the role tools were absent from a plain session's
    // list never exercised this path, because the fault is in execution.
    expect(guardReason({ name: 'read_file' })).toBeUndefined()
    expect(guardReason({ name: 'fs_write' })).toBeUndefined()
    expect(guardReason({ name: 'bash' })).toBeUndefined()
    expect(guardReason({ name: 'mcp__other-browser__navigate' })).toBeUndefined()
  })

  it('keeps run control reachable while a run is held, so an interrupted run can be continued', () => {
    // A run a host restart left `resuming` refuses every test action, and
    // `web_test_status` tells the operator it needs continuing. Without a
    // control tool the session can read that forever and never act on it.
    expect(HELD_RUN_ALLOWED_TOOLS).toContain('web_test_control_run')
  })


  it('leaves a held run from stopping the host tools of its own session', () => {
    // The hold exists so a paused or interrupted run cannot keep driving the
    // browser. It does not own the conversation around that run: a session that
    // started one can still read a file, and losing that would be a worse
    // breakage than the one the hold prevents.
    const store = {
      holdForSession: () => ({ runKey: 'run-a', status: 'paused' }),
      hasRunningRun: () => false,
      requireAuthority: () => ({ runKey: 'run-a', role: 'buyer', generation: 1, agentId: 'agent-a' }),
      mayPrepareIdentity: () => false,
    }
    expect(guardReason({ name: 'read_file' }, store, 'session-a')).toBeUndefined()
    expect(guardReason({ name: 'mcp__playwright-role-buyer__browser_navigate' }, store, 'session-a'))
      .toContain('is paused and refuses new test actions')
  })

})
