/** Formal profiles coordinate a stalled old executor and an independent recovery-only entry. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'win32')('revokes and stops the old profile before acquiring the same recovery lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-profiles-'))
  const driver = fileURLToPath(new URL('./fixtures/recovery-profile.mjs', import.meta.url))
  let businessCount = 0
  const business = createServer((request, response) => {
    request.resume()
    request.on('end', () => { businessCount++; response.destroy() })
  })
  await new Promise<void>((resolve) => { business.listen(0, '127.0.0.1', resolve) })
  const address = business.address()
  if (address === null || typeof address === 'string') throw new Error('missing fixture listener')
  const env = { ...process.env, DSH_HOME: join(root, 'home'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '',
    DEEPSEEK_BASE_URL: '', ELECTRON_RUN_AS_NODE: '1' }
  const old = spawn(process.execPath, [driver, 'old', root, `http://127.0.0.1:${address.port}/record`], { env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
  let oldErrors = ''
  old.stderr!.on('data', (chunk: Buffer) => { oldErrors += chunk.toString() })
  const oldExit = new Promise<void>((resolve) => { old.once('close', () => { resolve() }) })
  const waitMessage = (kind: string): Promise<void> => new Promise((resolve, reject) => {
    const onMessage = (message: unknown): void => {
      if (typeof message === 'object' && message !== null && 'type' in message && message.type === kind) {
        cleanup(); resolve()
      }
    }
    const onClose = (): void => { cleanup(); reject(new Error(`old profile exited before ${kind}: ${oldErrors}`)) }
    const cleanup = (): void => { clearTimeout(timer); old.off('message', onMessage); old.off('close', onClose) }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`old profile did not report ${kind}: ${oldErrors}`)) }, 20_000)
    old.on('message', onMessage); old.once('close', onClose)
  })
  const runRecovery = async (): Promise<{ code: number | null; stdout: string; stderr: string }> => {
    const child = spawn(process.execPath, [driver, 'recovery', root], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const timer = setTimeout(() => child.kill(), 20_000)
    try { return await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => { resolve({ code, stdout, stderr }) })
    }) } finally { clearTimeout(timer) }
  }
  try {
    await waitMessage('ready')
    expect(businessCount).toBe(1)
    const revoked = waitMessage('revoked')
    old.send({ type: 'revoke' })
    await revoked
    const contention = await runRecovery()
    expect(contention.code, contention.stderr).not.toBe(0)
    expect(contention.stderr).toContain('control lock: cannot claim')
    old.kill()
    await oldExit
    const recovered = await runRecovery()
    expect(recovered.code, recovered.stderr).toBe(0)
    expect(recovered.stdout).toContain('RECOVERY_PROFILE_RESULT:')
    expect(businessCount).toBe(1)
    const proofPath = process.env.DSH_RECOVERY_PROFILE_PROOF
    if (proofPath !== undefined) {
      const prefix = 'RECOVERY_PROFILE_RESULT:'
      const line = recovered.stdout.split(/\r?\n/u).find(value => value.startsWith(prefix))
      if (line === undefined) throw new Error('missing recovery profile proof')
      const result: unknown = JSON.parse(line.slice(prefix.length))
      await writeFile(proofPath, `${JSON.stringify({ observedAt: new Date().toISOString(),
        status: 'PASS', businessCount, contentionDenied: true, oldProcessExited: true, result }, null, 2)}\n`)
    }
  } finally {
    if (old.exitCode === null && old.signalCode === null) old.kill()
    await oldExit
    business.closeAllConnections()
    await new Promise<void>((resolve) => { business.close(() => { resolve() }) })
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  }
}, 65_000)
