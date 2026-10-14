// Podcast library navigation (2026-10-13): every tab shows its icon and its label, selected or not, and each icon names its
// destination (Home house, Latest clock, Library books, Add plus). Book libraries keep the selected-label strip.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))
const source = await read('../components/home/BookshelfNavBar.vue')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
const { default: component } = await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)

const strings = { ButtonHome: 'Home', ButtonLatest: 'Latest', ButtonLibrary: 'Library', ButtonAdd: 'Add', ButtonPlaylists: 'Playlists', ButtonSeries: 'Series', ButtonCollections: 'Collections', ButtonAuthors: 'Authors' }
const tabs = ({ mediaType = 'podcast', admin = true, playlists = 0, libraryIcon = 'microphone-1' } = {}) => {
  const vm = { $strings: strings, isPodcast: mediaType === 'podcast', userIsAdminOrUp: admin, userHasPlaylists: playlists, currentLibraryIcon: libraryIcon }
  return component.computed.items.call(vm).map(({ routeName, iconPack, icon, text }) => [routeName, iconPack, icon, text])
}

test('Podcast tabs: each icon names its destination; the library icon and the broadcast symbol are gone', () => {
  assert.deepEqual(tabs(), [
    ['bookshelf', 'abs-icons', 'home', 'Home'],
    ['bookshelf-latest', 'material-symbols', 'schedule', 'Latest'],
    ['bookshelf-library', 'material-symbols', 'library_books', 'Library'],
    ['bookshelf-add-podcast', 'material-symbols', 'add', 'Add']
  ])
  // The library's own icon (a microphone for podcast libraries) no longer drives the Library tab
  for (const libraryIcon of ['microphone-1', 'podcast', 'database']) assert.equal(tabs({ libraryIcon })[2][2], 'library_books')
  // Add stays admin-only; Playlists joins when the user has playlists
  assert.deepEqual(
    tabs({ admin: false }).map(([r]) => r),
    ['bookshelf', 'bookshelf-latest', 'bookshelf-library']
  )
  assert.deepEqual(
    tabs({ playlists: 2 })
      .map(([r]) => r)
      .at(-1),
    'bookshelf-playlists'
  )
})

test('Book tabs are unchanged: the library icon, Series, Collections, Authors', () => {
  assert.deepEqual(tabs({ mediaType: 'book', libraryIcon: 'books-1' }), [
    ['bookshelf', 'abs-icons', 'home', 'Home'],
    ['bookshelf-library', 'abs-icons', 'books-1', 'Library'],
    ['bookshelf-series', 'abs-icons', 'columns', 'Series'],
    ['bookshelf-collections', 'material-symbols', 'collections_bookmark', 'Collections'],
    ['bookshelf-authors', 'abs-icons', 'authors', 'Authors']
  ])
  assert.equal(component.computed.labeled.call({ isPodcast: false }), false)
  assert.equal(component.computed.labeled.call({ isPodcast: true }), true)
})

test('Labeled markup: icon and label in both states; decorative icons hidden from screen readers; the selected state keeps its cues', () => {
  const labeled = source.slice(source.indexOf('<template v-if="labeled">'), source.indexOf('<template v-else>'))
  // No v-if on the routeName inside the labeled branch: the icon and the label always render
  assert.doesNotMatch(labeled, /v-if="routeName/)
  assert.equal((labeled.match(/aria-hidden="true" class="nav-icon/g) || []).length, 2)
  assert.match(labeled, /<p class="nav-label" :class="\{ 'font-semibold': routeName === item\.routeName \}">\{\{ item\.text \}\}<\/p>/)
  // The link keeps the selected (bg-primary: LLAMA's glass key with the green ring) and unselected classes
  assert.match(source, /:class="routeName === item\.routeName \? 'bg-primary' : 'text-fg-muted'"/)
  // Book libraries keep the 36px absolute strip; labeled tabs flow so they grow with the font scale
  assert.match(source, /:class="labeled \? 'labeled-nav' : 'h-9'"/)
  assert.match(source, /:class="labeled \? 'relative' : 'absolute top-0 left-0 h-full'"/)
})

test('Labeled sizing: equal-width tabs, 44px stacked in portrait, 36px side by side in landscape, labels never overflow', () => {
  const css = source.slice(source.indexOf('<style>'))
  const rule = (selector, from = css) => {
    const at = from.indexOf(`${selector} {`)
    assert.ok(at >= 0, selector)
    return from.slice(at, from.indexOf('}', at))
  }
  const portrait = rule('.labeled-nav #bookshelf-navbar a')
  for (const d of ['flex: 1 1 0;', 'min-width: 0;', 'min-height: 44px;', 'flex-direction: column;']) assert.ok(portrait.includes(d), d)
  assert.doesNotMatch(portrait, /(^|\s)height:/)
  const label = rule('.labeled-nav .nav-label')
  for (const d of ['max-width: 100%;', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;']) assert.ok(label.includes(d), d)
  const landscape = css.slice(css.indexOf('@media (orientation: landscape)'))
  const row = rule('.labeled-nav #bookshelf-navbar a', landscape)
  for (const d of ['min-height: 36px;', 'flex-direction: row;']) assert.ok(row.includes(d), d)
})
