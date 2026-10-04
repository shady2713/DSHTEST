/** Keyless smoke of the complete installed profile through the supported profile boot. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  registerWebTestApplication, resolveWebTestApplication,
} from '../../lib/index.js'

const application = resolveWebTestApplication({ base: process.cwd() })
Object.assign(process.env, application.launchEnvironment)
const release = registerWebTestApplication(application)
const { loadLayeredEnv, loadProfileDirectory } = await import('@deepseek-ai/dsh-app-boot')
const installAnchor = fileURLToPath(new URL('../../../../../apps/cli/package.json', import.meta.url))
const hostRequire = createRequire(installAnchor)
const { runProfile } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh/profile-boot')).href)
let running
try {
  const profile = loadProfileDirectory('dsh', application.profileDir, installAnchor)
  running = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor },
    patchFiles: [application.compositionLayerPath],
    args: ['--no-open', '--port', '19431'],
  })
  const { ctx } = running
  for (const service of [
    'webTest', 'webTestContracts', 'webTestRuntime', 'webTestPolicy',
    'webTestModels', 'webTestConversation', 'webTestCommands', 'webTestPresentation', 'webTestAssembly',
  ]) assert.ok(ctx.get(service), `complete profile is missing ${service}`)
  const runtime = ctx.get('webTestRuntime')
  const codeRoot = join(application.home, 'smoke-source')
  mkdirSync(codeRoot)
  const receipt = await runtime.registerProject({
    commandId: 'cmd-full-profile-smoke', codeRoots: [codeRoot], entryUrls: ['http://127.0.0.1:19431/'],
  })
  const identity = runtime.identity()
  assert.equal(identity.controlRoot, join(application.home, 'control').toLowerCase())
  assert.equal(relative(identity.controlRoot, identity.dataRoot), join('data', '1'))
  const medium = readFileSync(join(identity.dataRoot, 'webtest.json'), 'utf8')
  assert.ok(medium.includes(receipt.resourceId))
  assert.ok(ctx.get('webTestModels').probeImage)
  assert.equal(ctx.get('webTest').provides('web-test.projects'), true)
  console.log('WEB_TEST_FULL_PROFILE_READY')
}
finally {
  await running?.shutdown.shutdown(0)
  release()
}
