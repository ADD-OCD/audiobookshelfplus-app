import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const engine = require('../theme/engine.js')
const { coverColorPresentation, THEME_BACKDROP, THEME_CONTROL } = require('../theme/coverPresentation.js')
const { TOKENS } = require('../theme/tokens.js')
// Source files are read LF-normalized, so a Windows (core.autocrlf) checkout and CI see the same text
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))

// Cover samples as utils/coverAverageColor.js produces them (unchanged), plus the player's defaults
const COVERS = {
  bright: { rgb: 'rgba(240,236,220,1)', isLight: true },
  dark: { rgb: 'rgba(18,16,20,1)', isLight: false },
  colorful: { rgb: 'rgba(170,40,160,1)', isLight: false },
  colorfulLight: { rgb: 'rgba(250,210,60,1)', isLight: true },
  missing: { rgb: 'rgb(55, 56, 56)', isLight: false }, // AudioPlayer default when no/failed cover
  itemPageBeforeLoad: { rgb: null, isLight: false } // item page before the delayed sample arrives
}

// The exact pre-policy expressions from AudioPlayer.vue / pages/item/_id/index.vue
function legacyExpressions(themeId, cover) {
  return {
    backdrop: cover.rgb, // :style backgroundColor: coverRgb (backdrop, mini panel, body, item header)
    control: cover.rgb, // play button backgroundColor: coverRgb
    isLight: cover.isLight, // white wash v-if="!coverBgIsLight"; 'text-white': coverRgb && !coverBgIsLight
    darkForeground: cover.isLight && themeId !== 'black', // coverBgIsLight && theme !== 'black'
    controlWash: !cover.isLight // play button white wash v-if="!coverBgIsLight"
  }
}

test('Dark, Black and Light keep the exact legacy cover-derived chrome for every kind of cover', () => {
  for (const id of ['dark', 'black', 'light']) {
    for (const [name, cover] of Object.entries(COVERS)) {
      const result = coverColorPresentation(engine.getTheme(id), cover)
      const legacy = legacyExpressions(id, cover)
      assert.equal(result.usesTheme, false, `${id}/${name}`)
      assert.equal(result.backdrop, legacy.backdrop, `${id}/${name} backdrop`)
      assert.equal(result.control, legacy.control, `${id}/${name} control`)
      assert.equal(result.isLight, legacy.isLight, `${id}/${name} isLight`)
      assert.equal(result.darkForeground, legacy.darkForeground, `${id}/${name} darkForeground`)
      assert.equal(result.controlWash, legacy.controlWash, `${id}/${name} controlWash`)
      // the play icon's text-white condition: coverRgb && !coverBgIsLight
      assert.equal(!!(result.control && !result.isLight), !!(cover.rgb && !cover.isLight), `${id}/${name} play icon`)
    }
  }
})

test('the Black theme keeps its light-foreground exception on light covers', () => {
  assert.equal(coverColorPresentation(engine.getTheme('black'), COVERS.bright).darkForeground, false)
  assert.equal(coverColorPresentation(engine.getTheme('dark'), COVERS.bright).darkForeground, true)
  assert.equal(coverColorPresentation(engine.getTheme('light'), COVERS.bright).darkForeground, true)
})

test('LLAMA chrome uses its own surfaces, whatever the cover (bright, dark, colorful, missing, loading)', () => {
  const llama = engine.getTheme('llama')
  for (const [name, cover] of Object.entries({ ...COVERS, hostile: { rgb: 'red; } body { display: none', isLight: true } })) {
    const result = coverColorPresentation(llama, cover)
    assert.deepEqual({ ...result }, { usesTheme: true, backdrop: THEME_BACKDROP, control: THEME_CONTROL, isLight: false, darkForeground: false, controlWash: false }, name)
  }
})

test('theme-policy chrome only references token variables that exist', () => {
  const vars = new Set(TOKENS.filter((t) => t.cssVar).map((t) => t.cssVar))
  for (const value of [THEME_BACKDROP, THEME_CONTROL]) {
    const [, name] = value.match(/^rgb\(var\((--[a-z-]+)\)\)$/)
    assert.ok(vars.has(name), name)
  }
  assert.equal(THEME_BACKDROP, 'rgb(var(--color-primary))') // surface.base
  assert.equal(THEME_CONTROL, 'rgb(var(--color-secondary))') // surface.raised
})

test('a theme-policy theme with a light color scheme would use dark foregrounds (future-proofing)', () => {
  const light = engine.getTheme('light')
  const { theme } = engine.validateTheme({ ...light, tokens: { ...light.tokens, 'presentation.cover-color': 'theme' } }, light.tokens)
  assert.deepEqual({ ...coverColorPresentation(theme, COVERS.dark) }, { usesTheme: true, backdrop: THEME_BACKDROP, control: THEME_CONTROL, isLight: true, darkForeground: true, controlWash: false })
})

test('no cover-derived style binding bypasses the policy in the player or item header', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  assert.doesNotMatch(template, /backgroundColor:[^}]*coverRgb/)
  assert.doesNotMatch(template, /coverBgIsLight/)
  assert.doesNotMatch(template, /theme !== 'black'/)
  assert.equal((template.match(/coverChrome\./g) || []).length, 10)
  // The play button's white wash follows the projection, never a theme id check in the player
  assert.match(template, /<div v-if="coverChrome\.controlWash" class="absolute top-0 left-0 w-full h-full bg-white bg-opacity-20 pointer-events-none" \/>/)
  assert.doesNotMatch(player, /llama|theme\.id|\$theme\.(id|current)/i)
  const item = await read('../pages/item/_id/index.vue')
  const itemTemplate = item.slice(0, item.indexOf('</template>'))
  assert.doesNotMatch(itemTemplate, /coverRgb/)
  assert.match(itemTemplate, /backgroundColor: headerCoverChrome\.backdrop/)
})

// Exercise the real AudioPlayer.vue watchers/computed with stubbed imports and a stub document body
async function playerComponent() {
  const source = await read('../components/app/AudioPlayer.vue')
  const script = source
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.component =')
  const body = { style: { backgroundColor: '' } }
  const sandbox = { coverPresentation: { coverColorPresentation }, Capacitor: {}, AbsAudioPlayer: {}, Dialog: {}, getAverageColorFromCoverUrl: async () => null, WrappingMarquee: function () {}, jumpLabelMixin: {}, document: { querySelector: (sel) => (sel === 'body' ? body : null) }, console }
  vm.runInNewContext(script, sandbox)
  const component = sandbox.component
  const ctx = { themeId: 'dark', coverRgb: 'rgb(55, 56, 56)', coverBgIsLight: false, showFullscreen: false, updateScreenSize() {}, $store: { commit() {} } }
  Object.defineProperty(ctx, '$theme', { get: () => ({ theme: engine.getTheme(ctx.themeId) }) })
  Object.defineProperty(ctx, 'presentationTheme', { get: () => component.computed.presentationTheme.call(ctx) })
  Object.defineProperty(ctx, 'coverChrome', { get: () => component.computed.coverChrome.call(ctx) })
  const watch = (name) => component.watch[name].call(ctx, ctx[name])
  return { ctx, body, watch, setFullscreen: (v) => ((ctx.showFullscreen = v), component.watch.showFullscreen.call(ctx, v)) }
}

test('fullscreen body background follows the policy, and switching themes while fullscreen never leaves it stale', async () => {
  const { ctx, body, watch, setFullscreen } = await playerComponent()
  ctx.coverRgb = 'rgba(170,40,160,1)'
  setFullscreen(true)
  assert.equal(body.style.backgroundColor, 'rgba(170,40,160,1)') // Dark: legacy cover color
  for (const [to, expected] of [
    ['llama', THEME_BACKDROP],
    ['dark', 'rgba(170,40,160,1)'],
    ['llama', THEME_BACKDROP],
    ['black', 'rgba(170,40,160,1)'],
    ['llama', THEME_BACKDROP],
    ['light', 'rgba(170,40,160,1)'],
    ['llama', THEME_BACKDROP]
  ]) {
    ctx.themeId = to
    watch('coverChrome.usesTheme') // what Vue runs when the policy flips
    assert.equal(body.style.backgroundColor, expected, `-> ${to}`)
  }
  setFullscreen(false)
  assert.equal(body.style.backgroundColor, '') // collapsing clears it, as before
  ctx.themeId = 'dark'
  watch('coverChrome.usesTheme')
  assert.equal(body.style.backgroundColor, '') // collapsed: a policy change never paints the body
  setFullscreen(true)
  assert.equal(body.style.backgroundColor, 'rgba(170,40,160,1)')
})

test('a legacy cover update while fullscreen behaves exactly as before (body not re-synced)', async () => {
  const { ctx, body, setFullscreen } = await playerComponent()
  setFullscreen(true)
  assert.equal(body.style.backgroundColor, 'rgb(55, 56, 56)')
  ctx.coverRgb = 'rgba(240,236,220,1)' // delayed cover sample arrives; no watcher on the color itself
  assert.equal(body.style.backgroundColor, 'rgb(55, 56, 56)')
})
