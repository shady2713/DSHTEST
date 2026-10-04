/** Built Electron execution group with role-isolated stores and overlapping business processing. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'win32' && process.platform !== 'darwin')('coordinates two isolated role guests through one non-nested resource callback', { retry: 0, timeout: 65_000 }, () => {
  const electron = require('electron') as string
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const directory = env.DSH_BROWSER_GROUP_EVIDENCE_DIRECTORY
  if (directory !== undefined) mkdirSync(directory, { recursive: true })
  const userData = mkdtempSync(join(directory === undefined ? tmpdir() : resolve(directory), 'native-browser-group-'))
  const result = spawnSync(electron, [fileURLToPath(new URL('./fixtures/group-controls.mjs', import.meta.url)), userData], {
    env, encoding: 'utf8', timeout: 60_000, windowsHide: true,
  })
  if (directory !== undefined) writeFileSync(join(directory, 'native-electron-result.json'), JSON.stringify({
    status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr,
  }, null, 2) + '\n')
  expect(result.error, result.stderr + result.stdout).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr + result.stdout).toBe(0)
  expect(result.stdout).toContain('NATIVE_EXECUTION_GROUP_OK')
  expect(result.stdout).toContain('ROLE_STORAGE_ISOLATION_OK')
  expect(result.stdout).toContain('EXECUTION_GROUP_FACTS:')
})
