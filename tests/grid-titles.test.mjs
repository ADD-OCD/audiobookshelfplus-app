// Grid titles (2026-10-10): a book card's title block hangs below its cover, and the shelves size the title space by the
// platform text scale, so enlarged text never overlaps the artwork. Identical at text scale 1.0.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))
const { textScale } = await import(`data:text/javascript;base64,${Buffer.from(await read('../utils/textScale.js')).toString('base64')}`)

const fakeDoc = () => {
  const added = []
  return {
    added,
    body: { appendChild: (e) => added.push(e) },
    createElement: () => ({
      style: {},
      remove() {
        added.pop()
      }
    })
  }
}

test('textScale: the probe font size over 16px; 1 when unmeasurable; the probe is removed', () => {
  const doc = fakeDoc()
  assert.equal(
    textScale(doc, () => ({ fontSize: '20.8px' })),
    1.3
  )
  assert.equal(doc.added.length, 0)
  assert.equal(
    textScale(fakeDoc(), () => ({ fontSize: '16px' })),
    1
  )
  assert.equal(
    textScale(fakeDoc(), () => ({ fontSize: '' })),
    1
  )
  assert.equal(
    textScale(null, () => ({ fontSize: '20px' })),
    1
  )
  assert.equal(textScale(fakeDoc(), null), 1)
})

test('Book card title block hangs from the cover bottom (no fixed upward offset)', async () => {
  const card = await read('../components/cards/LazyBookCard.vue')
  assert.match(card, /<div v-if="isAltViewEnabled" class="absolute left-0 z-50 w-full" :style="\{ top: '100%', paddingTop: 0\.45 \* sizeMultiplier \+ 'rem' \}">/)
  assert.doesNotMatch(card, /titleDisplayBottomOffset|bottom: `-/)
})

function computedOf(source, injected) {
  const script = source
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.component =')
  const sandbox = { ...injected, console, window: { innerWidth: 384 } }
  vm.runInNewContext(script, sandbox)
  return sandbox.component.computed
}

test('Library/series grids (LazyBookshelf): the book title space follows the text scale; other entities unchanged', async () => {
  const source = await read('../components/bookshelf/LazyBookshelf.vue')
  let scale = 1
  const c = computedOf(source, { textScale: () => scale, bookshelfCardsHelpers: {}, createPageRetry: () => ({}) })
  const ctx = (isBookEntity) => ({ showBookshelfListView: false, altViewEnabled: true, isBookEntity, entityHeight: 160, sizeMultiplier: 160 / 192 })
  assert.equal(c.shelfHeight.call(ctx(true)), 160 + 80 * (160 / 192), 'text scale 1: the previous height')
  scale = 1.3
  assert.equal(c.shelfHeight.call(ctx(true)), 160 + 80 * 1.3 * (160 / 192))
  assert.equal(c.shelfHeight.call(ctx(false)), 160 + 40 * (160 / 192), 'series/collections: unchanged')
  assert.equal(c.shelfHeight.call({ ...ctx(true), altViewEnabled: false }), 200, 'classic shelf view: unchanged')
})

test('Home shelves (Shelf.vue): the book title band follows the text scale; series and author shelves unchanged', async () => {
  const source = await read('../components/bookshelf/Shelf.vue')
  let scale = 1
  const c = computedOf(source, { textScale: () => scale })
  const ctx = (type) => {
    const o = { type, altViewEnabled: true, entityHeight: 160, sizeMultiplier: 160 / 192 }
    Object.defineProperty(o, 'bookTitleSpace', { get: () => c.bookTitleSpace.call(o) })
    return o
  }
  assert.equal(c.entityPaddingBottom.call(ctx('book')), 60 * (160 / 192))
  assert.equal(c.shelfHeight.call(ctx('book')), 160 + 60 * (160 / 192))
  scale = 1.3
  assert.equal(c.entityPaddingBottom.call(ctx('book')), 60 * 1.3 * (160 / 192))
  assert.equal(c.shelfHeight.call(ctx('book')), 160 + 60 * 1.3 * (160 / 192))
  assert.equal(c.shelfHeight.call(ctx('series')), 160 + 50 * (160 / 192))
  assert.equal(c.shelfHeight.call(ctx('authors')), 160 + 10 * (160 / 192))
  assert.equal(c.entityPaddingBottom.call(ctx('series')), 40)
  assert.equal(c.entityPaddingBottom.call(ctx('authors')), 10)
})
