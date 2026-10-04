/** Owner checks for the test-only route observer's delegation, redaction and cleanup. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { apply } from './fixtures/browser-route-stage-observer.mjs'

for (const fails of [false, true]) test(fails ? 'preserves failure identity and publishes only its closed category' : 'records save steps and restores the original descriptors', async () => {
  const directory = resolve('.artifacts/web-testing/codex-m0-m1/carrier-finish/route-stage-owner-check')
  await mkdir(directory, { recursive: true })
  const output = join(await mkdtemp(join(directory, 'case-')), 'result.json')
  const failure = Object.assign(new Error('fixture-private-error'), { name: 'DataCloneError' })
  class Editor {
    async edit(_entry, change) {
      change({ privateValue: 'fixture-private-value' }, {})
      if (fails) throw failure
    }
  }
  const editor = new Editor()
  class Settings {
    async mutate() { await editor.edit({ options: { id: 'web-test-models' } }, () => ({})) }
  }
  const settings = new Settings()
  const selection = { taskType: 'analysis', route: { provider: 'deepseek-account', model: 'deepseek-flash' } }
  const store = { async put(value) { await settings.mutate('web-test-models', value); return true } }
  class Presentation {
    async configureRoute() { await store.put(selection); return { ready: true } }
  }
  const presentation = new Presentation()
  const originals = [Object.getOwnPropertyDescriptor(store, 'put'), Object.getOwnPropertyDescriptor(Settings.prototype, 'mutate'), Object.getOwnPropertyDescriptor(Editor.prototype, 'edit'), Object.getOwnPropertyDescriptor(Presentation.prototype, 'configureRoute')]
  let dispose
  apply({ webTestPresentation: presentation, webTestModels: { selections: store }, get: key => key === 'settings' ? settings : editor, logger: { warn: () => assert.fail('Unexpected evidence write failure') }, effect: install => { dispose = install() } }, { responsePath: output })
  try {
    if (fails) await assert.rejects(presentation.configureRoute('deepseek-account', 'deepseek-flash', 'analysis'), error => error === failure)
    else assert.deepEqual(await presentation.configureRoute('deepseek-account', 'deepseek-flash', 'analysis'), { ready: true })
    const raw = await readFile(output, 'utf8')
    assert.equal(raw.includes('fixture-private'), false)
    const evidence = JSON.parse(raw)
    assert.equal(evidence.status, fails ? 'threw' : 'returned')
    assert.deepEqual(evidence.steps.slice(0, 5).map(row => row.step), ['put-entered', 'settings-mutate-entered', 'editor-edit-entered', 'editor-change-entered', 'editor-change-completed'])
    if (fails) assert.equal(evidence.code, 'DataCloneError')
    else assert.equal(evidence.ready, true)
  } finally { await dispose() }
  assert.deepEqual([Object.getOwnPropertyDescriptor(store, 'put'), Object.getOwnPropertyDescriptor(Settings.prototype, 'mutate'), Object.getOwnPropertyDescriptor(Editor.prototype, 'edit'), Object.getOwnPropertyDescriptor(Presentation.prototype, 'configureRoute')], originals)
})
