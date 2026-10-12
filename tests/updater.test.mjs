// In-app GitHub updater (Settings → Updates): the view shows exactly the controls each native state allows, every
// message exists, and the JS side never passes a URL, file or package to the native updater.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))
const { updateView, updateErrorKey } = await import(`data:text/javascript;base64,${Buffer.from(await read('../utils/updaterView.js')).toString('base64')}`)
const strings = JSON.parse(await read('../strings/en-us.json'))

const candidate = { version: '0.17.0', title: 'Audiobookshelf+ v0.17.0', publishedAt: '2026-11-01T10:00:00Z', summary: 'x', size: 15000000 }
const base = { installedVersion: '0.16.0', installedVersionCode: 132, downloadsEnabled: true, installPermissionNeeded: false }
const view = (state, extra = {}, prompt = false) => updateView({ ...base, state, ...extra }, prompt)

test('each state offers only its own actions', () => {
  assert.deepEqual(view('IDLE').actions, ['check'])
  assert.deepEqual(view('CHECKING').actions, [])
  assert.deepEqual(view('UP_TO_DATE', { candidate }).actions, ['check', 'notes'])
  assert.deepEqual(view('AVAILABLE', { candidate }).actions, ['check', 'download', 'notes'])
  assert.deepEqual(view('DOWNLOADING', { candidate, downloadedBytes: 5, totalBytes: 10 }).actions, ['cancel', 'notes'])
  assert.deepEqual(view('VERIFYING', { candidate }).actions, ['notes'])
  assert.deepEqual(view('READY', { candidate }).actions, ['check', 'install', 'notes'])
  assert.deepEqual(view('INSTALLING', { candidate }).actions, ['reopen', 'notes'])
  assert.deepEqual(view('CANCELLED', { candidate }).actions, ['check', 'retry', 'notes'])
  assert.deepEqual(view('FAILED', { candidate, error: 'DIGEST_MISMATCH' }).actions, ['check', 'retry', 'notes'])
  assert.deepEqual(view('FAILED', { error: 'NETWORK' }).actions, ['check'], 'a failed check has nothing to retry but the check')
  assert.deepEqual(view('FAILED', { candidate, error: 'NOT_NEWER' }).actions, ['check', 'notes'], 'no retry for an APK that is not newer')
  assert.deepEqual(view('UNSUPPORTED').actions, [])
})

test('no contradictory combinations', () => {
  for (const state of ['IDLE', 'CHECKING', 'UP_TO_DATE', 'AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'READY', 'INSTALLING', 'CANCELLED', 'FAILED', 'UNSUPPORTED']) {
    const v = view(state, { candidate, error: 'NETWORK', downloadedBytes: 3, totalBytes: 4 })
    const a = v.actions
    assert.ok(!(a.includes('download') && a.includes('install')), state)
    assert.ok(!(a.includes('cancel') && (a.includes('check') || a.includes('install') || a.includes('retry'))), state)
    assert.ok(!(a.includes('install') && a.includes('retry')), state)
    assert.equal(v.showProgress, state === 'DOWNLOADING', state)
    if (state === 'CHECKING' || state === 'DOWNLOADING') assert.equal(v.errorKey, null, `${state} hides an old error`)
  }
})

test('downloads stay off where the native side disables them (debug builds against the production source)', () => {
  const v = view('AVAILABLE', { candidate, downloadsEnabled: false })
  assert.deepEqual(v.actions, ['check', 'notes'])
  assert.equal(v.debugNote, true)
  assert.equal(view('AVAILABLE', { candidate, downloadsEnabled: false, testSource: true }).debugNote, false)
  assert.equal(view('AVAILABLE', { candidate }).debugNote, false)
})

test('progress, permission prompt and notices', () => {
  assert.equal(view('DOWNLOADING', { candidate, downloadedBytes: 7_500_000, totalBytes: 15_000_000 }).percent, 50)
  assert.equal(view('DOWNLOADING', { candidate, downloadedBytes: 1, totalBytes: 0 }).percent, 0)
  const ready = view('READY', { candidate, installPermissionNeeded: true }, true)
  assert.deepEqual(ready.actions, ['check', 'install', 'permission', 'notes'])
  assert.equal(ready.permissionNote, true)
  assert.equal(view('READY', { candidate, installPermissionNeeded: true }).permissionNote, false, 'not before the user taps Install')
  assert.equal(view('READY', { candidate, notice: 'INSTALL_CANCELLED' }).noticeKey, 'MessageUpdateInstallCancelled')
  assert.equal(view('IDLE', { notice: 'INTERRUPTED' }).noticeKey, 'MessageUpdateInterrupted')
})

test('every native error and every message has English text', async () => {
  const codes = [
    'NETWORK',
    'TIMEOUT',
    'TLS',
    'RATE_LIMITED',
    'GITHUB_ERROR',
    'NO_RELEASE',
    'MALFORMED',
    'NOT_STABLE',
    'NO_APK',
    'AMBIGUOUS_APK',
    'BAD_ASSET',
    'UNTRUSTED_URL',
    'UNEXPECTED_CONTENT',
    'SIZE_MISMATCH',
    'DIGEST_MISMATCH',
    'STORAGE',
    'CANCELLED',
    'INVALID_APK',
    'WRONG_PACKAGE',
    'NOT_NEWER',
    'DEBUGGABLE',
    'UNSIGNED',
    'UNTRUSTED_SIGNER',
    'MULTIPLE_SIGNERS',
    'PERMISSION_REQUIRED',
    'INSTALL_FAILED',
    'INSTALL_BLOCKED',
    'UNSUPPORTED',
    'BUSY'
  ]
  const kotlin = await read('../android/app/src/main/java/app/absplus/android/updater/ReleaseSelector.kt')
  const declared = kotlin
    .match(/enum class UpdateErrorCode \{([^}]*)\}/)[1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  assert.deepEqual(declared, codes, 'the JS list follows the native enum')
  for (const code of codes) assert.ok(strings[updateErrorKey(code)], code)
  const component = await read('../components/settings/Updates.vue')
  const view = await read('../utils/updaterView.js')
  for (const key of new Set([...component.matchAll(/\$strings\.(\w+)/g), ...view.matchAll(/'((?:Message|Button|Label|Header)\w+)'/g)].map((m) => m[1]))) assert.ok(strings[key], key)
})

test('wiring: plugin registered natively and in JS; Settings shows the section on Android; no URL or file crosses from JS', async () => {
  const main = await read('../android/app/src/main/java/app/absplus/android/MainActivity.kt')
  assert.match(main, /registerPlugin\(AbsUpdater::class\.java\)/)
  const index = await read('../plugins/capacitor/index.js')
  assert.match(index, /import \{ AbsUpdater \} from '\.\/AbsUpdater'/)
  const settings = await read('../pages/settings.vue')
  assert.match(settings, /<!-- In-app updates from the official GitHub releases \(Android\) -->\n\s+<settings-updates \/>\n\s+<\/template>/)
  const component = await read('../components/settings/Updates.vue')
  const calls = [...component.matchAll(/AbsUpdater\.(\w+)\(([^)]*)\)/g)]
  assert.deepEqual([...new Set(calls.map((m) => m[1]))].sort(), ['addListener', 'cancelDownload', 'checkForUpdates', 'downloadUpdate', 'getState', 'installUpdate', 'openInstallPermissionSettings', 'openReleaseNotes', 'reopenInstaller'])
  for (const m of calls) if (m[1] !== 'addListener') assert.equal(m[2], '', `${m[1]} takes no arguments`)
  assert.doesNotMatch(component, /v-html|window\.open|setTestSource/)
  // Installing while audio plays asks first
  assert.match(component, /if \(this\.\$store\.state\.playerIsPlaying && this\.status\.state === 'READY'\) \{\n\s+const \{ value \} = await Dialog\.confirm/)
})

test('Open installer shows the waiting confirmation again (review fix: it used to call Install, which is refused while installing)', async () => {
  const component = await read('../components/settings/Updates.vue')
  assert.match(component, /reopen: \{ icon: 'open_in_new', text: this\.\$strings\.ButtonOpenInstaller, handler: this\.reopenInstaller \}/)
  assert.match(component, /reopenInstaller\(\) \{\n\s+return this\.run\(\(\) => AbsUpdater\.reopenInstaller\(\)\)/)
  const plugin = await read('../android/app/src/main/java/app/absplus/android/plugins/AbsUpdater.kt')
  assert.match(plugin, /fun reopenInstaller\(call: PluginCall\) \{\n\s+val pending = UpdateManager\.pendingConfirm\n\s+if \(pending == null \|\| UpdateManager\.snapshot\(\)\.state != UpdateState\.INSTALLING\) return call\.resolve\(JSObject\(\)\.put\("opened", false\)\)\n\s+showConfirm\(pending\)/)
})

test('PLUS_VERSION follows the release ledger, so installed apps neither miss releases nor re-offer their own', async () => {
  const gradle = await read('../android/app/build.gradle')
  const versionCode = Number(gradle.match(/^\s+versionCode (\d+)$/m)[1])
  const plus = gradle.match(/buildConfigField "String", "PLUS_VERSION", "\\"(\d+\.\d+\.\d+)\\""/)[1]
  const ledger = await read('../docs/release-process.md')
  // The newest ledger row that is a public release ("| 132 | **Audiobookshelf+ v0.16.0** ...")
  const releases = [...ledger.matchAll(/^\| (\d+) \| \*\*Audiobookshelf\+ v(\d+\.\d+\.\d+)\*\*/gm)].map((m) => ({ code: Number(m[1]), version: m[2] }))
  const latest = releases.sort((a, b) => b.code - a.code)[0]
  const cmp = (a, b) => {
    const x = a.split('.').map(Number)
    const y = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
    return 0
  }
  assert.ok(latest, 'a released row in the ledger')
  if (versionCode === latest.code) assert.equal(plus, latest.version, `versionCode ${versionCode} is ${latest.version}; PLUS_VERSION must match`)
  else {
    assert.ok(versionCode > latest.code, 'versionCode never goes below the last release')
    assert.ok(cmp(plus, latest.version) > 0, `versionCode ${versionCode} is beyond release ${latest.version} (${latest.code}): set PLUS_VERSION to the new public version`)
  }
})
