/** Current built Client cancellation through a real Electron renderer and formal profile boot. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

const scenarios = [
  { scenario: 'rate-limit', behavior: 'cancels a parked 429 retry and retains pending inbox work' },
  { scenario: 'timeout', behavior: 'cancels an adapter timeout retry and retains pending inbox work' },
  { scenario: 'reopen', behavior: 'reopens the stopped session without replay and completes an explicit fresh prompt' },
  { scenario: 'late', behavior: 'rejects a late Messages completion after cancelling an active stream' },
] as const

it.skipIf(process.platform !== 'win32' && process.platform !== 'darwin').each(scenarios)('Desktop Stop $behavior', { retry: 0, timeout: 95_000 }, ({ scenario }) => {
  const evidence = resolve(process.env.DSH_CANCEL_REMOTE_EVIDENCE_DIRECTORY ?? '.artifacts/web-testing/codex-m0-m1/t07-current')
  mkdirSync(evidence, { recursive: true })
  const output = mkdtempSync(join(evidence, `desktop-cancel-${scenario}-`))
  const owned = mkdtempSync(join(tmpdir(), 'dsh-desktop-cancel-'))
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  Object.assign(env, { HOME: owned, USERPROFILE: owned, APPDATA: owned, LOCALAPPDATA: owned,
    TEMP: owned, TMP: owned, DSH_HOME: join(owned, 'home'), DSH_AGENTS_HOME: join(owned, 'agents'),
    DSH_BUNDLED_SKILL_DIR: join(owned, 'skills'), DSH_TELEMETRY_DISABLED: '1' })
  try {
    const result = spawnSync(require('electron') as string, [fileURLToPath(new URL('./fixtures/cancel-remote.mjs', import.meta.url)), owned, output, `--scenario=${scenario}`], {
      env, encoding: 'utf8', timeout: 85_000, windowsHide: true,
    })
    writeFileSync(join(output, 'process.json'), JSON.stringify({ status: result.status, signal: result.signal,
      error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n')
    expect(result.error, result.stderr + result.stdout).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    const facts: unknown = JSON.parse(readFileSync(join(output, 'facts.json'), 'utf8'))
    expect(facts).toMatchObject({
      scenario,
      remote: { reply: { result: { ok: true, value: { accepted: true } } } },
      turnEnd: { data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } },
      samples: [{ requests: 1, pending: 1 }, { requests: 1, pending: 1 }, { requests: 1, pending: 1 }],
      inbox: { nextTurn: scenario === 'reopen' ? 0 : 1 },
      cleanup: { windowDestroyed: true, profileDisposed: true, serverClosed: true },
    })
    if (scenario === 'timeout') expect(facts).toMatchObject({ retry: { data: { failure: { code: 'TIMEOUT' }, delayMs: 8000 } } })
    if (scenario === 'reopen') expect(facts).toMatchObject({ reopening: {
      beforePrompt: { requests: 1, pending: 1, status: 'idle' },
      afterPrompt: { requests: 3, pending: 0, status: 'idle', turnEnd: { data: { turn: 3, reason: { kind: 'completed' } } } },
    } })
    if (scenario === 'late') expect(facts).toMatchObject({ transport: { responseDestroyedAtAttempt: true, lateWriteRejected: true } })
  } finally { rmSync(owned, { recursive: true, force: true }) }
})
