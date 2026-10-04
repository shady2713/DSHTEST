/** Keyless kernel lock test; build the attachment-local Host program before running it. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { FileStoreLease } from '../lib/types/file-lease.js'

it('excludes another process and acquires after its crash without cleanup or a waiting period', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-lease-process-'))
  const fixture = fileURLToPath(new URL('./fixtures/file-lease-holder.mjs', import.meta.url))
  const child = spawn(process.execPath, [fixture, root], { stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
  let lease: FileStoreLease | undefined
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => { reject(new Error(`holder exited before readiness: ${stderr}`)) })
      child.stdout.once('data', () => { resolve() })
    })
    await expect(FileStoreLease.acquire(root)).rejects.toMatchObject({ code: 'ATTACHMENT_STORE_OWNED' })
    child.kill('SIGKILL')
    await exited
    lease = await FileStoreLease.acquire(root)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    await lease?.release()
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  }
})
