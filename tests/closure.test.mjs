// Closure pass (2026-10-10): every consumer of the collapsed player's height uses its projection; reader toolbars sit above
// their pages; the downloaded book's Play is an amber action in LLAMA; the series toolbar grows for a wrapped title; and a
// paused streamed book's refocus no longer seeks the native player back to an older server position.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const engine = require('../theme/engine.js')
const presets = require('../theme/presets.js')
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))
const esm = async (path) => import(`data:text/javascript;base64,${Buffer.from(await read(path)).toString('base64')}`)
const { miniPlayerHeight } = await esm('../utils/miniPlayerHeight.js')
const { refocusServerAction, refocusDisplayTime, REMOTE_UPDATE_MARGIN_MS } = await esm('../utils/livePosition.js')
const H = 'var(--mini-player-height, 120px)'

test('miniPlayerHeight: the published projection, 120px when unset or invalid', () => {
  const root = (value) => ({ style: { getPropertyValue: (name) => (name === '--mini-player-height' ? value : '') } })
  assert.equal(miniPlayerHeight(root('92px')), 92)
  assert.equal(miniPlayerHeight(root('120px')), 120)
  assert.equal(miniPlayerHeight(root('')), 120)
  assert.equal(miniPlayerHeight(root('auto')), 120)
  assert.equal(miniPlayerHeight(null), 120)
})

test('Readers: comic, EPUB, MOBI and PDF offsets use the projected height with the previous 120px geometry as fallback', async () => {
  const comic = await read('../components/readers/ComicReader.vue')
  assert.ok(comic.includes(`:class="showingToolbar ? 'translate-y-0' : isPlayerOpen ? 'translate-y-[var(--mini-player-height,120px)]' : 'translate-y-32'" :style="{ bottom: isPlayerOpen ? '${H}' : '0px' }"`))
  assert.ok(comic.includes(`.reader-player-open #comic-reader {\n  height: calc(100% - ${H});\n  max-height: calc(100% - ${H});`))
  const epub = await read('../components/readers/EpubReader.vue')
  assert.ok(epub.includes(`:style="{ bottom: isPlayerOpen ? '${H}' : '0px' }"`))
  assert.match(epub, /import \{ miniPlayerHeight \} from '@\/utils\/miniPlayerHeight'/)
  assert.match(epub, /return this\.isPlayerOpen \? 84 \+ miniPlayerHeight\(\) : 104/)
  assert.equal(84 + 120, 204, 'previous offset with a 120px plate')
  // The EPUB and MOBI frames keep their previous 132px (12px + 120px) with the default plate
  for (const [name, src, sel] of [
    ['epub', epub, '#epub-frame'],
    ['mobi', await read('../components/readers/MobiReader.vue'), '.mobi-ebook-viewer']
  ]) {
    assert.ok(src.includes(`.reader-player-open ${sel} {\n  height: calc(100% - 12px - ${H});\n  max-height: calc(100% - 12px - ${H});`), name)
  }
  const pdf = await read('../components/readers/PdfReader.vue')
  assert.ok(pdf.includes(`:style="{ bottom: isPlayerOpen ? '${H}' : '0px' }"`))
})

test('No hard-coded collapsed-player offsets remain anywhere in components, pages or layouts', async () => {
  const files = []
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${dir}${entry.name}/`)
      else if (entry.name.endsWith('.vue')) files.push(`${dir}${entry.name}`)
    }
  }
  for (const dir of ['../components/', '../pages/', '../layouts/']) await walk(dir)
  assert.ok(files.length > 100)
  for (const f of files) {
    const src = await read(f)
    assert.doesNotMatch(src, /isPlayerOpen \? '120px'|translate-y-\[120px\]|isPlayerOpen \? 204|calc\(100% - (120|132)px\)|calc\(100vh - (300|310|380)px\)/, f)
  }
  const player = await read('../components/app/AudioPlayer.vue')
  assert.match(player, /if \(!this\.showFullscreen && touchPosY < window\.innerHeight - this\.miniLayout\.height\) return/)
  assert.doesNotMatch(player, /window\.innerHeight - 120/)
})

test('Collapsed player touch zone: only the plate itself starts a swipe (92px in LLAMA, 120px otherwise)', async () => {
  const source = await read('../components/app/AudioPlayer.vue')
  const script = source
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.component =')
  const sandbox = { window: { innerHeight: 748 }, coverPresentation: {}, playerLayout: {}, Capacitor: {}, AbsAudioPlayer: {}, Dialog: {}, WrappingMarquee: function () {}, jumpLabelMixin: {}, console }
  vm.runInNewContext(script, sandbox)
  const touchstart = sandbox.component.methods.touchstart
  const start = (height, y) => {
    const ctx = { showFullscreen: false, miniLayout: { height }, $store: { state: { globals: { isModalOpen: false } } }, touchStartY: null }
    touchstart.call(ctx, { changedTouches: [{ pageY: y }], pageX: 100 })
    return ctx.touchStartY
  }
  assert.equal(start(92, 700), 700, 'on the LLAMA plate')
  assert.equal(start(92, 640), null, 'page content above the LLAMA plate is not the player')
  assert.equal(start(120, 640), 640, 'the previous 120px plate is unchanged')
  assert.equal(start(120, 620), null)
})

test('Reader page toolbars sit above their pages and below the reader top bar', async () => {
  const pdf = await read('../components/readers/PdfReader.vue')
  assert.match(pdf, /<div class="fixed left-0 h-8 w-full bg-bg px-4 flex items-center text-fg-muted z-20" :style=/)
  assert.match(pdf, /<pdf v-if="pdfDocInitParams" ref="pdf" class="m-auto z-10 /)
  const comic = await read('../components/readers/ComicReader.vue')
  assert.match(comic, /<div class="fixed left-0 h-8 w-full bg-bg px-4 flex items-center text-fg-muted transition-transform z-20"/)
  const reader = await read('../components/readers/Reader.vue')
  assert.match(reader, /<div class="w-full px-2 fixed top-0 left-0 z-30 /)
})

test('Downloaded book Play: an amber action in LLAMA through a hook; green stays for status and selection', async () => {
  const rules = presets.presentationRules([engine.getTheme('llama')])
  const root = engine.themeSelector('llama')
  assert.deepEqual(rules[`${root} .local-play-action`], { ...presets.PRIMITIVES.PLAYBACK_LEGEND })
  const page = await read('../pages/localMedia/item/_id.vue')
  assert.match(page, /<button v-if="audioTracks\.length && !isPodcast" class="local-play-action shadow-sm text-success flex items-center justify-center rounded-full mx-2" @click\.stop="play">/)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
  // DownloadItem.vue (text-accent Play) has no consumer anywhere; it is dead code, not a rendered control
  const usage = []
  for (const dir of ['../components/', '../pages/', '../layouts/']) {
    const walk = async (d) => {
      for (const e of await readdir(new URL(d, import.meta.url), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(`${d}${e.name}/`)
        else if (e.name.endsWith('.vue') && /modals-downloads-download-item|<DownloadItem/.test(await read(`${d}${e.name}`))) usage.push(`${d}${e.name}`)
      }
    }
    await walk(dir)
  }
  assert.deepEqual(usage, [])
})

test('Series toolbar: grows for a wrapped title (two lines at most); the shelf takes the remaining height', async () => {
  const toolbar = await read('../components/home/BookshelfToolbar.vue')
  assert.match(toolbar, /<div class="browse-toolbar w-full min-h-9 bg-bg relative z-20">\n\s+<div id="bookshelf-toolbar" class="relative w-full min-h-9 z-20 flex items-center px-2">/)
  assert.match(toolbar, /<p v-show="selectedSeriesName" class="ml-2 pt-1 min-w-0 break-words line-clamp-2">/)
  const page = await read('../pages/bookshelf.vue')
  assert.match(page, /<div class="w-full h-full flex flex-col">\n\s+<home-bookshelf-nav-bar \/>\n\s+<home-bookshelf-toolbar v-show="!hideToolbar" \/>/)
  assert.match(page, /\.main-content \{\n  flex: 1 1 0;\n  min-height: 0;\n  max-width: 100vw;\n\}/)
  assert.doesNotMatch(page, /calc\(100% - (72|36)px\)/)
  const nav = await read('../components/home/BookshelfNavBar.vue')
  assert.match(nav, /<div class="w-full h-9 bg-bg relative">/, 'the navigation keeps its 36px')
})

test('refocusServerAction: another device’s newer progress is applied; a paused native move here is kept', () => {
  const session = { id: 's1' }
  const native = (currentTime, updatedAt) => ({ playbackSession: { id: 's1', updatedAt }, currentTime, isPlaying: false })
  const T = 1_791_684_022_099
  // The S22 case: server at 1269.279 (last synced before), native moved to 1569.279 while paused
  assert.deepEqual(refocusServerAction(session, native(1569.279, T), { currentTime: 1269.279, lastUpdate: T - 2_000_000 }, 1569.28), { action: 'display', time: 1569.279 })
  // Our own last sync stamps the server a moment after the session: still ours, not a remote update
  assert.deepEqual(refocusServerAction(session, native(1569.279, T), { currentTime: 1269.279, lastUpdate: T + 300 }, 1269.28), { action: 'display', time: 1569.279 })
  // Another device moved on later: applied as before
  assert.deepEqual(refocusServerAction(session, native(1569.279, T), { currentTime: 3000, lastUpdate: T + REMOTE_UPDATE_MARGIN_MS + 1 }, 1569.28), { action: 'seek', time: 3000 })
  assert.deepEqual(refocusServerAction(session, native(3000.5, T), { currentTime: 3000, lastUpdate: T + 60_000 }, 1569.28), { action: 'display', time: 3000.5 }, 'within 1s: no seek')
  // No matching native session: the previous rule against the displayed time
  assert.deepEqual(refocusServerAction(session, { playbackSession: { id: 'other' }, currentTime: 5 }, { currentTime: 100, lastUpdate: 1 }, 50), { action: 'seek', time: 100 })
  assert.deepEqual(refocusServerAction(session, null, { currentTime: 100.5, lastUpdate: 1 }, 100), { action: 'none' })
  assert.deepEqual(refocusServerAction(session, native(1, T), null, 1), { action: 'none' })
  // The downloaded-book rule is unchanged
  assert.deepEqual(refocusDisplayTime(session, native(7107.976, T), 6107.556), { time: 7107.976, source: 'live' })
})

test('deviceFocused for a paused streamed book: no seek back to an older server position; remote updates still apply', async () => {
  const source = await read('../components/app/AudioPlayerContainer.vue')
  const script = source
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.component =')
  const sandbox = { AbsAudioPlayer: {}, AbsLogger: { info: async () => {} }, Dialog: {}, CellularPermissionHelpers: {}, nativeQueueItems() {}, resolvePlaybackQueue() {}, resolveQueueSourceAppendItems() {}, sessionToQueueItem() {}, refocusDisplayTime, refocusServerAction, console: { log() {}, error() {} } }
  vm.runInNewContext(script, sandbox)
  const methods = sandbox.component.methods
  const T = 1_791_684_022_099
  const run = async (server) => {
    const seeks = []
    const ctx = { currentPlaybackSession: { id: 's1' }, currentTime: 1569.28, onPlaybackEnded: async () => {}, getServerMediaProgressForCurrentSession: async () => server }
    ctx.$refs = {
      audioPlayer: {
        isPlaying: false,
        isLocalPlayMethod: false,
        currentTime: 1569.28,
        seek: (t) => seeks.push(t),
        timeupdate() {
          ctx.currentTime = this.currentTime
        }
      }
    }
    ctx.getNativePlaybackState = methods.getNativePlaybackState.bind(ctx)
    sandbox.AbsAudioPlayer.getCurrentPlaybackState = async () => ({ playbackSession: { id: 's1', updatedAt: T }, currentTime: 1569.279, isPlaying: false })
    await methods.deviceFocused.call(ctx, true)
    return { seeks, shown: ctx.currentTime }
  }
  assert.deepEqual(await run({ currentTime: 1269.279, lastUpdate: T - 2_000_000 }), { seeks: [], shown: 1569.279 })
  assert.deepEqual(await run({ currentTime: 3000, lastUpdate: T + 60_000 }), { seeks: [3000], shown: 1569.28 })
})
