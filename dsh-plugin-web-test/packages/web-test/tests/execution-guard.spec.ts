/**
 * The execution policy the test preset enforces before any tool body runs.
 *
 * These tests cover the pure decision, so they state what a call may and may not
 * do rather than how the guard is registered.
 *
 * @module dsh-plugin-web-test/tests/execution-guard
 */

import { describe, expect, it } from 'vitest'
import { BROWSER_TOOL_PREFIX, HELD_RUN_ALLOWED_TOOLS, TOOL_PREFIX, guardReason } from '../src/agent.ts'

/** A store whose only held run is the one a test declares. */
function holding(runKey: string, status: string): { holdForSession: (sessionId: string) => { runKey: string, status: string } | undefined } {
  return {
    holdForSession: (sessionId: string) => (sessionId === 'owner' ? { runKey, status } : undefined),
  }
}

describe('tool allowlist', () => {
  it('admits this plugin\'s own tools', () => {
    for (const name of [`${TOOL_PREFIX}status`, `${TOOL_PREFIX}start_run`, `${TOOL_PREFIX}begin_operation`]) {
      expect(guardReason({ name })).toBeUndefined()
    }
  })

  it('admits the official browser provider\'s tools', () => {
    expect(guardReason({ name: `${BROWSER_TOOL_PREFIX}browser_navigate` })).toBeUndefined()
  })

  it('refuses a shell tool even when the composition offers it, and names it', () => {
    const reason = guardReason({ name: 'bash' })
    expect(reason).toContain('may only call web_test_* and mcp__playwright-mcp__*')
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
  it('refuses every action for the session that owns a held run', () => {
    const store = holding('run-1', 'paused')
    for (const name of [`${BROWSER_TOOL_PREFIX}browser_navigate`, `${TOOL_PREFIX}start_run`, `${TOOL_PREFIX}report_case`]) {
      expect(guardReason({ name }, store, 'owner')).toMatch(/run run-1 is paused/)
    }
  })

  it('keeps the reporting and bookkeeping tools reachable, so a held run stays recordable', () => {
    const store = holding('run-1', 'paused')
    for (const name of HELD_RUN_ALLOWED_TOOLS) {
      expect(guardReason({ name }, store, 'owner')).toBeUndefined()
    }
  })

  it('leaves a session that owns no held run working', () => {
    const store = holding('run-1', 'paused')
    expect(guardReason({ name: `${BROWSER_TOOL_PREFIX}browser_navigate` }, store, 'other')).toBeUndefined()
  })

  it('asks for the operator, not for a tool that does not exist', () => {
    const reason = guardReason({ name: `${BROWSER_TOOL_PREFIX}browser_navigate` }, holding('run-1', 'paused'), 'owner')
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
})
