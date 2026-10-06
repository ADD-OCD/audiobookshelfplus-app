import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))

// The opening tag of the first element whose opening tag contains `marker`, and the source of that whole element
const element = (source, marker) => {
  const at = source.indexOf(marker)
  assert.ok(at >= 0, marker)
  const open = source.lastIndexOf('<div', at)
  let depth = 0
  const tags = /<\/?div\b[^>]*>/g
  tags.lastIndex = open
  for (let m; (m = tags.exec(source)); ) {
    if (m[0].startsWith('</')) depth--
    else if (!m[0].endsWith('/>')) depth++
    if (depth === 0) return source.slice(open, m.index + m[0].length)
  }
  throw new Error(`unclosed ${marker}`)
}

// Library list rows: the downloaded tick sat at the row's top-right, over the top 13px of the vertically centered 40x40
// Play key, so a tap there opened the item instead of playing (S26). It now sits on the artwork corner as on the grid card.
test('list row: the downloaded tick is on the artwork, not over the Play key', async () => {
  const list = await read('../components/cards/LazyListBookCard.vue')
  const cover = element(list, 'class="card-artwork list-card-cover relative"')
  assert.equal((list.match(/download_done/g) || []).length, 1)
  assert.ok(cover.includes('download_done'), 'the tick is inside the cover box')
  // It never takes taps: a tap on it reaches the row (opens the item) as on the rest of the artwork
  assert.match(cover, /<div v-if="localLibraryItem \|\| isLocal" class="absolute top-0 right-0 z-20 pointer-events-none"/)
  // Same icon, color and size formula as before (and as the grid card)
  assert.match(cover, /:style="\{ top: 0\.375 \* sizeMultiplier \+ 'rem', right: 0\.375 \* sizeMultiplier \+ 'rem', padding: `\$\{0\.1 \* sizeMultiplier\}rem \$\{0\.25 \* sizeMultiplier\}rem` \}">\n\s*<span class="material-symbols text-2xl text-success">download_done<\/span>/)
})

test('list row: the Play key and its column are unchanged', async () => {
  const list = await read('../components/cards/LazyListBookCard.vue')
  const column = element(list, 'v-if="showPlayButton" class="absolute top-0 bottom-0 right-0 h-full flex items-center justify-center z-20 pr-1"')
  assert.match(column, /<button type="button" class="list-play-key relative rounded-full bg-fg-muted\/50" :class="\{ 'p-2': !playerIsStartingForThisMedia \}" @click\.stop\.prevent="play">/)
  assert.doesNotMatch(column, /download_done/)
  // Nothing else is positioned in the row's top-right corner any more
  const row = list.slice(list.indexOf('<div class="h-full flex relative">'))
  const rowLevel = row.replace(element(list, 'class="card-artwork list-card-cover relative"'), '').replace(column, '')
  assert.doesNotMatch(rowLevel, /absolute top-0 right-0/)
  assert.match(list, /<div class="flex-grow pl-2" :class="showPlayButton \? 'pr-12' : 'pr-2'">/)
})

// Rescan Folder: activity is shown at once, progress comes from AbsFileSystem "onRescanProgress" scoped to this folder,
// and failures are never reported as "Matched 0 item(s)".
test('folder page: rescan status, folder-scoped progress and error handling', async () => {
  const page = await read('../pages/localMedia/folders/_id.vue')
  assert.match(page, /<div v-if="scan" class="flex items-start mb-2 text-sm" role="status" aria-live="polite">/)
  assert.match(page, /this\.scan = \{ folderId: this\.folderId, phase: 'loading'/)
  assert.match(page, /if \(!data \|\| data\.folderId !== this\.folderId\) return/)
  assert.match(page, /if \(localLibraryItem\) this\.newLocalLibraryItem\(localLibraryItem\)/)
  // Unsupported (podcast) folders and running scans don't offer Rescan
  assert.match(page, /if \(this\.mediaType === 'book' && !this\.isScanning\) \{/)
  // An error result is a failure with its own message, before any success toast
  const rescan = page.slice(page.indexOf('async rescanFolder()'), page.indexOf('rescanErrorMessage(error) {'))
  assert.ok(rescan.indexOf("phase: 'failed'") < rescan.indexOf('MessageRescanFolderResult'))
  // The listener is removed with the page, also when the page goes before it was registered
  assert.match(page, /const listener = await AbsFileSystem\.addListener\('onRescanProgress', this\.onRescanProgress\)/)
  assert.match(page, /if \(this\._isDestroyed\) \{\n\s*listener\?\.remove\(\)/)
  // A page reopened mid-scan shows the running scan before its next event
  assert.match(page, /await AbsFileSystem\.isRescanning\(\{ folderId: this\.folderId \}\)/)
  assert.match(page, /this\.rescanProgressListener\?\.remove\(\)/)
  const strings = JSON.parse(await read('../strings/en-us.json'))
  for (const key of ['LabelRescanChecked', 'LabelRescanComplete', 'LabelRescanFailed', 'LabelRescanFound', 'LabelRescanLoading', 'LabelRescanScanning', 'MessageRescanErrorCatalog', 'MessageRescanErrorFolder', 'MessageRescanErrorRunning', 'MessageRescanErrorServer', 'MessageRescanErrorUnexpected']) {
    assert.ok(strings[key], key)
    assert.ok(page.includes(key), `${key} is used`)
  }
  assert.doesNotMatch(strings.LabelRescanChecked, /%/, 'no percentage')
})
