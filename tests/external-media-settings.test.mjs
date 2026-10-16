import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parseComponent, compile } = require('vue-template-compiler')
const source = await readFile(new URL('../pages/settings.vue', import.meta.url), 'utf8')
const { script, template } = parseComponent(source)
const context = { jumpLabelMixin: {}, diagnosticLogMixin: {} }
vm.runInNewContext(script.content.replace(/^import .*$/gm, '').replace('export default', 'globalThis.page ='), context)

test('existing settings and unknown navigation modes default to time; explicit selections survive reload', () => {
  for (const [saved, expected] of [[undefined, 'time'], [null, 'time'], ['bad', 'time'], ['time', 'time'], ['chapters', 'chapters'], ['files', 'files']]) {
    const page = { deviceData: { deviceSettings: { externalMediaNavigation: saved, jumpForwardTime: 30, jumpBackwardsTime: 15 } }, settings: {} }
    context.page.methods.setDeviceSettings.call(page)
    assert.equal(page.settings.externalMediaNavigation, expected)
    assert.equal(page.settings.jumpForwardTime, 30)
    assert.equal(page.settings.jumpBackwardsTime, 15)
  }
})

test('the accessible Android playback selector uses all three persisted modes and semantic theme colors', () => {
  const select = template.content.match(/<select id="external-media-navigation"[\s\S]*?<\/select>/)?.[0]
  assert.ok(select)
  assert.match(template.content, /<label for="external-media-navigation"/)
  assert.match(select, /v-model="settings.externalMediaNavigation"/)
  assert.match(select, /@change="saveSettings"/)
  assert.match(select, /bg-bg text-fg border border-border/)
  assert.deepEqual([...select.matchAll(/value="(.*?)"/g)].map((m) => m[1]), ['time', 'chapters', 'files'])
  assert.deepEqual(compile(template.content).errors, [])
})

test('all new labels have English fallback, with explicit metadata and queue boundary explanations', async () => {
  const strings = JSON.parse(await readFile(new URL('../strings/en-us.json', import.meta.url), 'utf8'))
  const keys = [...template.content.matchAll(/\$strings\.(\w*ExternalMedia\w*)/g)].map((m) => m[1])
  for (const key of keys) assert.equal(typeof strings[key], 'string', key)
  assert.match(strings.MessageExternalMediaControls, /Fast Forward and Rewind/)
  assert.match(strings.MessageExternalMediaControls, /current book or episode/)
  const i18n = await readFile(new URL('../plugins/i18n.js', import.meta.url), 'utf8')
  assert.match(i18n, /strings\[key\] \|\| translations\[defaultCode\]\[key\]/)
})

test('saving the selector uses the existing database bridge and preserves unrelated settings', async () => {
  const saved = []
  const page = {
    settings: { externalMediaNavigation: 'files', jumpForwardTime: 30, jumpBackwardsTime: 15, languageCode: 'en-us', autoDownloadEnabled: true },
    $hapticsImpact: async () => {},
    $db: { updateDeviceSettings: async (payload) => { saved.push(structuredClone(payload)); return { deviceSettings: payload } } },
    $store: { commit: () => {} }, $setLanguageCode: () => {}
  }
  page.setDeviceSettings = () => context.page.methods.setDeviceSettings.call(page)
  await context.page.methods.saveSettings.call(page)
  assert.equal(saved[0].externalMediaNavigation, 'files')
  assert.equal(saved[0].autoDownloadEnabled, true)
  assert.equal(saved[0].jumpForwardTime, 30)
  assert.equal(page.deviceData.deviceSettings.externalMediaNavigation, 'files')
})

test('advanced controls default off without changing the retained basic mode or skip intervals', () => {
  const page = { deviceData: { deviceSettings: { externalMediaNavigation: 'chapters', jumpForwardTime: 30, jumpBackwardsTime: 15 } }, settings: {} }
  context.page.methods.setDeviceSettings.call(page)
  assert.equal(page.settings.externalMediaMultiPressEnabled, false)
  assert.equal(page.settings.externalMediaNavigation, 'chapters')
  assert.equal(page.settings.jumpForwardTime, 30)
  assert.equal(page.settings.jumpBackwardsTime, 15)
  assert.deepEqual([
    page.settings.externalMediaForwardSingle, page.settings.externalMediaForwardDouble, page.settings.externalMediaForwardTriple,
    page.settings.externalMediaBackwardSingle, page.settings.externalMediaBackwardDouble, page.settings.externalMediaBackwardTriple
  ], ['skip_forward', 'next_chapter', 'next_file', 'skip_backward', 'previous_chapter', 'previous_file'])
})

test('all six mappings independently round-trip through Settings save and the existing bridge', async () => {
  const keys = ['externalMediaForwardSingle', 'externalMediaForwardDouble', 'externalMediaForwardTriple', 'externalMediaBackwardSingle', 'externalMediaBackwardDouble', 'externalMediaBackwardTriple']
  const values = ['none', 'play_pause', 'previous_file', 'next_file', 'skip_forward', 'next_chapter']
  let persisted
  const settings = { externalMediaMultiPressEnabled: true, externalMediaNavigation: 'files', jumpForwardTime: 30, jumpBackwardsTime: 15, ...Object.fromEntries(keys.map((key, i) => [key, values[i]])) }
  const page = { settings, $hapticsImpact: async () => {}, $db: { updateDeviceSettings: async (payload) => { persisted = structuredClone(payload); return { deviceSettings: persisted } } }, $store: { commit() {} }, $setLanguageCode() {} }
  page.setDeviceSettings = () => context.page.methods.setDeviceSettings.call(page)
  await context.page.methods.saveSettings.call(page)
  assert.equal(persisted.externalMediaMultiPressEnabled, true)
  assert.deepEqual(keys.map((key) => page.settings[key]), values)
  assert.equal(page.settings.externalMediaNavigation, 'files')
})

test('unknown action strings fail to No action; missing legacy fields use suggested defaults', () => {
  const page = { deviceData: { deviceSettings: { externalMediaForwardSingle: 'bad', externalMediaBackwardTriple: null } }, settings: {} }
  context.page.methods.setDeviceSettings.call(page)
  assert.equal(page.settings.externalMediaForwardSingle, 'none')
  assert.equal(page.settings.externalMediaBackwardTriple, 'previous_file')
})

test('each assignment has a label and all eight actions are translated with platform limitations explained', async () => {
  const strings = JSON.parse(await readFile(new URL('../strings/en-us.json', import.meta.url), 'utf8'))
  const page = { $strings: strings }
  const bindings = context.page.computed.externalMediaPressBindings.call(page)
  const options = context.page.computed.externalMediaActionOptions.call(page)
  assert.equal(new Set(bindings.map((b) => b.key)).size, 6)
  for (const item of [...bindings, ...options]) assert.equal(typeof item.label, 'string')
  assert.deepEqual(Array.from(options, (o) => o.value), ['skip_forward', 'skip_backward', 'next_chapter', 'previous_chapter', 'next_file', 'previous_file', 'play_pause', 'none'])
  assert.match(template.content, /id="external-media-multipress"[^>]*type="checkbox"/)
  assert.match(template.content, /v-model="settings\[binding.key\]"/)
  assert.match(strings.MessageExternalMediaMultiPress, /350 ms/)
  assert.match(strings.MessageExternalMediaMultiPress, /processed command/)
  assert.match(strings.MessageExternalMediaMultiPress, /single assignment immediately/)
})
