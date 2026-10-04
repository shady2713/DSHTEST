/** P07 installed-profile regression: real Loader, Agent, PTC and file consumers. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./fixtures/file-retention-profile.mjs', import.meta.url))

it.skipIf(process.platform !== 'win32')('retains public files through actual installed PTC and ordinary Session consumers', { timeout: 65_000, retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-p07-profile-'))
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
      const child = spawn(process.execPath, [driver], { cwd: root, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, DEEPSEEK_API_KEY: '', DSH_DISABLE_TELEMETRY: '1' } })
      let stdout = ''
      let stderr = ''
      const deadline = setTimeout(() => { child.send({ type: 'p07-shutdown' }) }, 55_000)
      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
      child.once('error', (error) => { clearTimeout(deadline); reject(error) })
      child.once('close', (code) => { clearTimeout(deadline); accept({ code, stdout, stderr }) })
    })
    const safeOutput = `${result.stdout}\n${result.stderr}`.replace(/([?&]token=)[^\s&"']+/giu, '$1[redacted]')
    expect(result.code, safeOutput).toBe(0)
    expect(result.stdout).toContain('P07_PROFILE_RESULT:')
    expect(result.stdout).toContain('"actualPtcRuns":1')
    expect(result.stdout).toContain('"deniedFileActions":6')
    expect(result.stdout).toContain('"historicUnknownRetained":true')
    expect(result.stdout).toContain('"uploadStageRetained":true')
    const proof = result.stdout.split('\n').find(line => line.startsWith('P07_PROFILE_RESULT:'))
    expect(proof).toBeDefined()
    console.log(proof)
  } finally {
    const target = resolve(root)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('dsh-p07-profile-')) throw new Error('unexpected P07 fixture root')
    await rm(target, { recursive: true, force: true })
  }
})
