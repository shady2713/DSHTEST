/** The shipped standard preset must create through the actual Session Controller and execute its search tools. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each([true, false])('creates the shipped standard preset only when search has its own realm (%s)', async (isolated) => {
  const owned = await mkdtemp(join(tmpdir(), 'dsh-preset-search-'))
  const root = join(owned, 'workspace')
  const moduleRoot = await mkdtemp(fileURLToPath(new URL('../../../bundle/web-app/tests/.preset-search-', import.meta.url)))
  const overlay = join(moduleRoot, 'search.patch.yml')
  await writeFile(overlay, `- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: session-title-llm
  disabled: true
- id: agent-instructions
  disabled: true
- id: tool-fs-search
  disabled: true
- insert:
    - id: search-web-dependency-anchor
      name: '@deepseek-ai/dsh-web-app'
      disabled: true
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: standard
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
    - id: connection
      name: '@deepseek-ai/dsh-client-connection'
    - id: file-upload
      name: '@deepseek-ai/dsh-client-file-upload'
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: session-controller
      name: '@deepseek-ai/dsh-api-session-controller'
`)
  const driver = fileURLToPath(new URL('./fixtures/preset-search-driver.ts', import.meta.url))
  const shipped = fileURLToPath(new URL('../../../bundle/web-app/presets/standard.patch.yml', import.meta.url))
  const standard = join(moduleRoot, 'standard.patch.yml')
  const declaration = await readFile(shipped, 'utf8')
  const realm = '            isolate:\n              fsSearch: true\n'
  expect(declaration).toContain(realm)
  await writeFile(standard, isolated ? declaration : declaration.replace(realm, ''))
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), driver, root, standard, overlay], {
    env: { ...process.env, DSH_HOME: join(owned, 'home'), DEEPSEEK_API_KEY: '', DSH_TELEMETRY_DISABLED: '1', TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url)) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const timeout = setTimeout(() => child.kill(), 30_000)
  try {
    const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    if (!isolated) {
      expect(exit, stderr).toBe(1)
      expect(stderr).toContain('Preset services require isolate realms: fsSearch')
      return
    }
    expect(exit, stderr).toBe(0)
    const result: unknown = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
    expect(result).toMatchObject({ created: { agentPreset: 'standard' }, preset: { id: 'standard' }, genericDenied: true })
    if (typeof result !== 'object' || result === null || !('results' in result)) throw new Error('missing preset results')
    const results: unknown = result.results
    if (typeof results !== 'object' || results === null || !('glob' in results) || !('grep' in results)) {
      throw new Error('missing search results')
    }
    expect(results.glob).toContain('actual.ts')
    expect(results.grep).toContain('export const REAL_PRESET_NEEDLE = 42')
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
      await new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
    }
    await rm(owned, { recursive: true, force: true, maxRetries: 3 })
    await rm(moduleRoot, { recursive: true, force: true, maxRetries: 3 })
  }
}, 40_000)
