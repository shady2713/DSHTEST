/** Native Electron inputs and admission through the built controlled browser channel. */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe.skipIf(process.platform !== 'win32' && process.platform !== 'darwin')('built native browser controls', () => {
  let result: SpawnSyncReturns<string>
  beforeAll(() => {
    const electron = require('electron') as string
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const directory = env.DSH_BROWSER_CONTROLS_EVIDENCE_DIRECTORY
    if (directory !== undefined) mkdirSync(directory, { recursive: true })
    const userData = mkdtempSync(join(directory === undefined ? tmpdir() : resolve(directory), 'native-browser-controls-'))
    result = spawnSync(electron, [fileURLToPath(new URL('./fixtures/browser-controls.mjs', import.meta.url)), userData], {
      env, encoding: 'utf8', timeout: 45_000, windowsHide: true,
    })
    if (directory !== undefined) writeFileSync(join(directory, 'native-electron-result.json'), JSON.stringify({
      status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr,
    }, null, 2) + '\n')
  }, 50_000)
  it('binds an actual Session and preserves native input while refusing second-origin navigation', { retry: 0 }, () => {
    expect(result.error, result.stderr + result.stdout).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    expect(result.stdout).toContain('NATIVE_BROWSER_CONTROLS_OK')
    expect(result.stdout).toContain('NATIVE_MULTILINE_INPUT_OK')
    expect(result.stdout).toMatch(/NATIVE_BACKGROUND_INPUT_(?:OK|NOT_STARTED)/u)
    expect(result.stdout).toContain('NATIVE_UNFOCUSABLE_INPUT_NOT_STARTED')
    expect(result.stdout).toContain('NATIVE_FOCUS_LAYOUT_REVALIDATED')
    expect(result.stdout).toContain('NATIVE_POST_REVALIDATION_FOCUS_LOSS_NOT_STARTED')
    expect(result.stdout).toContain('NATIVE_SAME_PAGE_LINK_OK')
    expect(result.stdout).toContain('NATIVE_ISOLATED_TARGET_DISPOSED:unfocusable')
    expect(result.stdout).toContain('NATIVE_ISOLATED_TARGET_DISPOSED:hidden-document')
    expect(result.stdout).toContain('FROZEN_ORIGIN_REQUEST_COUNTS:{"foreignRequests":0,"escapedRequests":0}')
  })
  it('refuses an actually hidden document when the native lifecycle produces that fault', { retry: 0 }, (context) => {
    expect(result.error, result.stderr + result.stdout).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    if (result.stdout.includes('NATIVE_CURRENT_HIDDEN_DOCUMENT_UNAVAILABLE')) {
      context.skip('the owned native lifecycle did not produce document.hidden; primary navigation assertions remain required')
    }
    expect(result.stdout).toContain('NATIVE_CURRENT_HIDDEN_DOCUMENT_NOT_STARTED')
  })
})
