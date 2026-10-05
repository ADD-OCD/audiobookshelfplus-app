import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const engine = require('../theme/engine.js')
const presets = require('../theme/presets.js')
const { TOKEN_NAMES } = require('../theme/tokens.js')
const { BUILTIN_THEMES } = require('../theme/builtins.js')
// Source files are read LF-normalized, so a Windows (core.autocrlf) checkout and CI see the same text
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))

const llama = () => engine.getTheme('llama')

// WCAG relative luminance / contrast ratio
const luminance = ([r, g, b]) => {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('LLAMA is a registered built-in that defines every token explicitly (no silent fallbacks)', () => {
  const definition = BUILTIN_THEMES.find((t) => t.id === 'llama')
  for (const name of TOKEN_NAMES) assert.ok(Object.prototype.hasOwnProperty.call(definition.tokens, name), name)
  assert.deepEqual(engine.validateTheme(definition, null).errors, [])
  assert.deepEqual(engine.BUILTIN_ERRORS, [])
  assert.equal(llama().id, 'llama')
  assert.equal(llama().colorScheme, 'dark')
  assert.equal(engine.resolveThemeId('llama'), 'llama')
  for (const value of ['LLAMA', 'Llama', 'llama ', 'llama;']) assert.equal(engine.resolveThemeId(value), 'dark', value)
})

test('LLAMA uses the equipment finish and theme cover color', () => {
  assert.equal(llama().tokens['presentation.finish'], 'equipment')
  assert.equal(llama().tokens['presentation.cover-color'], 'theme')
})

test('LLAMA label uses the localization architecture (English fallback key exists)', async () => {
  const strings = JSON.parse(await read('../strings/en-us.json'))
  assert.equal(strings[llama().labelKey], 'LLAMA')
})

test('LLAMA palette keeps its intended depth order: recessed < base < content < raised < hover', () => {
  const t = llama().tokens
  const order = ['surface.recessed', 'surface.base', 'surface.content', 'surface.raised', 'surface.hover'].map((n) => luminance(t[n]))
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `step ${i}`)
  // Blue-gray, not neutral charcoal: blue channel leads on every chassis surface
  for (const n of ['surface.base', 'surface.content', 'surface.raised', 'surface.hover']) assert.ok(t[n][2] > t[n][0] + 10, n)
})

test('LLAMA chassis is a restrained deep navy with an indigo lean (finishing pass), over unchanged wells and semantics', () => {
  const t = llama().tokens
  const hsl = ([r, g, b]) => {
    const [R, G, B] = [r / 255, g / 255, b / 255]
    const max = Math.max(R, G, B)
    const min = Math.min(R, G, B)
    const l = (max + min) / 2
    const d = max - min
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
    const h = d ? (max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4) * 60 : 0
    return [(h + 360) % 360, s, l]
  }
  // The chassis family: blue with a slight indigo lean, visibly chromatic but never neon, and dark
  for (const n of ['surface.base', 'surface.content', 'surface.raised', 'surface.hover', 'border.default', 'control.toggle', 'control.toggle-selected']) {
    const [h, s, l] = hsl(t[n])
    assert.ok(h >= 215 && h <= 230, `${n} hue ${h.toFixed(0)}`)
    assert.ok(s >= 0.27 && s <= 0.5, `${n} saturation ${s.toFixed(2)}`)
    assert.ok(l <= 0.5, `${n} lightness ${l.toFixed(2)}`)
  }
  // Toggles follow the chassis levels they sit on
  assert.deepEqual(t['control.toggle'], t['surface.content'])
  assert.deepEqual(t['control.toggle-selected'], t['surface.hover'])
  // The chassis steps keep their luminance separation (OLED: no level collapses into the next)
  assert.ok(contrast(t['surface.content'], t['surface.base']) >= 1.3, 'content vs base')
  assert.ok(contrast(t['surface.base'], t['surface.recessed']) >= 1.2, 'base vs recessed')
  assert.ok(contrast(t['surface.raised'], t['surface.content']) >= 1.5, 'raised vs content')
  // The wells, the seek channel and the semantic colors are not part of the chassis tuning
  assert.deepEqual(t['surface.recessed'], [10, 13, 18])
  assert.deepEqual(t['progress.track'], [40, 46, 56])
  assert.deepEqual(t['progress.buffered'], [86, 98, 116])
  assert.deepEqual(t['progress.played'], [245, 190, 40])
  assert.deepEqual(t['accent.primary'], [96, 232, 104])
  // The overlays fade into the chassis colors themselves, so the player and item header blend with the new navy
  const stops = (n) => t[n].stops.map((s) => s.color.slice(0, 3))
  for (const c of stops('overlay.player')) assert.deepEqual(c, t['surface.base'])
  for (const c of stops('overlay.mini-player')) assert.deepEqual(c, t['surface.base'])
  assert.deepEqual(stops('overlay.item-header'), [t['surface.recessed'], t['surface.content']])
})

test('LLAMA text, readout and progress colors meet contrast targets on the surfaces they sit on', () => {
  const t = llama().tokens
  for (const surface of ['surface.base', 'surface.content', 'surface.recessed']) {
    assert.ok(contrast(t['text.primary'], t[surface]) >= 4.5, `text.primary on ${surface}`)
    assert.ok(contrast(t['text.muted'], t[surface]) >= 4.5, `text.muted on ${surface}`)
    assert.ok(contrast(t['accent.primary'], t[surface]) >= 4.5, `accent.primary on ${surface}`)
  }
  assert.ok(contrast(t['text.primary'], t['surface.raised']) >= 4.5, 'text.primary on surface.raised')
  assert.ok(contrast(t['text.muted'], t['surface.raised']) >= 3, 'text.muted (icons) on surface.raised')
  // Played progress vs its recessed track, and the buffered portion vs the track
  assert.ok(contrast(t['progress.played'], t['progress.track']) >= 3, 'played vs track')
  assert.ok(contrast(t['progress.buffered'], t['progress.track']) >= 1.5, 'buffered visibly distinct from track')
})

test('LLAMA keeps semantic states, and amber progress stays distinguishable from warning', () => {
  const t = llama().tokens
  const dark = engine.getTheme('dark').tokens
  for (const n of ['state.success', 'state.success-strong', 'state.warning', 'state.error', 'state.info']) assert.deepEqual(t[n], dark[n], n)
  const [pr, pg, pb] = t['progress.played']
  const [wr, wg, wb] = t['state.warning']
  assert.ok(Math.abs(pg - wg) >= 40, 'amber progress vs orange warning: green channel apart')
  assert.notDeepEqual([pr, pg, pb], [wr, wg, wb])
  assert.ok(t['accent.primary'][1] > 200 && t['accent.primary'][0] < 128 && t['accent.primary'][2] < 128, 'phosphor green accent')
})

test('the real Tailwind build emits LLAMA variables and its equipment root while Dark stays :root', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const { css } = await postcss([tailwind({ ...config, content: [{ raw: '<div class="text-success"></div>' }] })]).process(source, { from: undefined })
  const selector = engine.themeSelector('llama')
  assert.equal(selector, "html[data-theme='llama']")
  const blocks = [...css.matchAll(/html\[data-theme='llama'\] \{([^}]*)\}/g)].map((m) => m[1]).join('\n')
  for (const [property, value] of Object.entries(engine.themeDeclarations(llama().tokens))) assert.ok(blocks.includes(`${property}: ${value};`), property)
  for (const [property, value] of Object.entries(presets.equipmentDerivedDeclarations(llama().tokens))) assert.ok(blocks.includes(`${property}: ${value};`), property)
  assert.equal(engine.themeSelector('dark'), ':root')
})

// ThemeService with mocked boundaries (same approach as tests/theme.test.mjs)
async function loadThemePlugin(stored) {
  const source = (await read('../plugins/theme.client.js'))
    .replace(/^import .*$/gm, '')
    .replace('export class ThemeService', 'class ThemeService')
    .replace('export default', 'globalThis.plugin =')
  const store = { value: stored, writes: [] }
  const calls = []
  const root = { dataset: {} }
  const sandbox = {
    Vue: { observable: (o) => o },
    Capacitor: { getPlatform: () => 'android' },
    StatusBar: { setStyle: async (o) => calls.push(o.style) },
    Style: { Dark: 'DARK', Light: 'LIGHT' },
    themeEngine: engine,
    AbsDatabase: { refreshWidgets: async () => {} },
    document: { documentElement: root },
    console: { ...console, error: () => {} }
  }
  vm.runInNewContext(source, sandbox)
  let service
  sandbox.plugin(
    {
      app: {
        $localStore: {
          getTheme: async () => store.value,
          setTheme: async (v) => {
            store.value = v
            store.writes.push(v)
          }
        }
      }
    },
    (name, value) => (service = value)
  )
  await service.ready
  return { service, root, store, calls }
}

test('a persisted LLAMA selection restores after restart', async () => {
  const { service, root, calls } = await loadThemePlugin('llama')
  assert.equal(service.id, 'llama')
  assert.equal(root.dataset.theme, 'llama')
  assert.deepEqual(calls, ['DARK', 'DARK'])
})

test('switching LLAMA to Dark, Black and Light and back persists each selection', async () => {
  const { service, root, store } = await loadThemePlugin('dark')
  for (const id of ['llama', 'dark', 'llama', 'black', 'llama', 'light', 'llama']) {
    assert.equal(await service.select(id), id)
    assert.equal(root.dataset.theme, id)
    assert.equal(store.value, id)
  }
  assert.deepEqual(store.writes, ['llama', 'dark', 'llama', 'black', 'llama', 'light', 'llama'])
})

test('non-EPUB reader shell: Dark/Black/Light keep their shell, LLAMA uses the dark-compatible shell', async () => {
  for (const id of ['dark', 'black', 'light']) assert.equal(engine.readerShellId(engine.getTheme(id)), id)
  assert.equal(engine.readerShellId(llama()), 'dark')
  assert.equal(engine.readerShellId(null), 'dark')
  const light = engine.getTheme('light')
  const { theme } = engine.validateTheme({ ...light, id: 'paper' }, light.tokens)
  assert.equal(engine.readerShellId(theme), 'light')
  const reader = await read('../components/readers/Reader.vue')
  assert.match(reader, /if \(this\.isEpub\) return this\.ereaderSettings\.theme/) // EPUB preference untouched
  assert.match(reader, /data-\[theme=dark\]:bg-\[#232323\]/) // the existing dark shell it maps onto
})

test('LLAMA progress repaint targets only unfinished playback bars and the current-chapter marker, never warning semantics or finished state', () => {
  const selectors = Object.keys(presets.presentationRules([llama()]))
  const progress = selectors.filter((s) => s.includes('bg-yellow-400'))
  assert.deepEqual(progress, ["html[data-theme='llama'] .modal .chapters-panel li > .bg-yellow-400", "html[data-theme='llama'] .absolute.bottom-0.left-0.z-10.bg-yellow-400"])
  // The one Gate H exception names bg-error only to whiten the glyph on it; the error fill itself is untouched
  const errorGlyph = "html[data-theme='llama'] .icon-btn.border.bg-error:not(:disabled) > .material-symbols"
  for (const s of selectors) {
    if (s !== errorGlyph) assert.doesNotMatch(s, /warning|bg-success|text-success|bg-error/, s)
    if (s.includes('bg-yellow-400')) assert.ok(s.includes('.absolute.bottom-0.left-0.z-10') || s.includes('.chapters-panel li > '), s) // never bare yellow
  }
  const rules = presets.presentationRules([llama()])
  for (const s of progress) assert.deepEqual(rules[s], { 'background-color': 'rgb(var(--color-track-cursor))' }, s)
})

test('Chapters: LLAMA-only paint (recessed list, chassis header, lit current row, played-amber marker)', async () => {
  const rules = presets.presentationRules([llama()])
  const chapters = Object.entries(rules).filter(([s]) => s.includes('.chapters-panel'))
  assert.ok(chapters.length >= 4)
  for (const [selector, declarations] of chapters) {
    assert.ok(selector.startsWith("html[data-theme='llama'] .modal .chapters-panel"), selector)
    for (const property of Object.keys(declarations)) assert.match(property, /^(background-color|background-image|box-shadow|color)$/, `${selector}: ${property} (paint only)`)
  }
  const t = llama().tokens
  assert.equal(rules["html[data-theme='llama'] .modal .chapters-panel.bg-secondary"]['background-color'], 'rgb(var(--color-recessed))')
  // Current row is clearly lit against the well; text stays readable on both
  assert.equal(rules["html[data-theme='llama'] .modal .chapters-panel li.bg-primary"]['background-color'], 'rgb(var(--color-bg))')
  assert.ok(luminance(t['surface.content']) > luminance(t['surface.recessed']) * 2)
  for (const surface of ['surface.recessed', 'surface.content']) assert.ok(contrast(t['text.muted'], t[surface]) >= 4.5, `muted times on ${surface}`)
  // Header labels on the raised strip get the same contrast margin as other small muted headers
  const blend = t['text.primary'].map((c, i) => Math.round(c * 0.85 + t['surface.raised'][i] * 0.15))
  assert.ok(contrast(blend, t['surface.raised']) >= 4.5, 'header labels')
  // The current-chapter marker is repainted with the played-progress token (color only: same element, size, position)
  assert.deepEqual(rules["html[data-theme='llama'] .modal .chapters-panel li > .bg-yellow-400"], { 'background-color': 'rgb(var(--color-track-cursor))' })
  assert.deepEqual(t['progress.played'], [245, 190, 40])
  // Standard themes: no rules at all, and the hook class is the only template change
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
  const modal = await read('../components/modals/ChaptersModal.vue')
  assert.match(modal, /class="chapters-panel w-full overflow-x-hidden overflow-y-auto bg-secondary rounded-lg border border-fg\/20"/)
  assert.match(modal, /class="w-0\.5 h-full absolute top-0 left-0 bg-yellow-400"/)
})

test('LLAMA toggle styling keeps the on-state color and only recolors the off slot and thumb', () => {
  const rules = presets.presentationRules([llama()])
  const toggle = Object.entries(rules).filter(([s]) => s.includes('border-gray-400'))
  assert.ok(toggle.length >= 3)
  for (const [selector, declarations] of toggle) {
    assert.doesNotMatch(selector, /bg-success/, selector)
    for (const property of Object.keys(declarations)) assert.doesNotMatch(property, /width|height|transform|padding|margin|left|top/, property)
  }
})

// --- Phase 2C Gate A: shared equipment primitives and presentation defect fixes ---

const SAFE_VALUE = /^[a-z0-9 .,%()/#-]+$/i

test('shared equipment primitives exist as fixed, frozen, paint-only recipe values', () => {
  const P = presets.PRIMITIVES
  assert.ok(Object.isFrozen(P))
  for (const name of ['RADIUS', 'ELEVATION', 'RAISED_BEVEL', 'PRESSED_BEVEL', 'RECESSED_WELL', 'STEEL_SHEEN', 'PRIMARY_KEY', 'PRIMARY_KEY_PRESSED', 'CHASSIS_SHEEN', 'ARTWORK_FRAME', 'ENGRAVED_SEPARATOR', 'ENGRAVED_SEPARATOR_TOP', 'RECESSED_FACE', 'KEY_CAP', 'KEY_CAP_PRESSED', 'SELECTED_KEY']) assert.ok(P[name], name)
  // Radius scale: squared frames, squared keys/wells/panels (Phase 4H squared the last round control, Play/Pause)
  assert.deepEqual({ ...P.RADIUS }, { frame: '2px', key: '4px', none: '0px' })
  assert.ok(Object.isFrozen(P.RADIUS) && Object.isFrozen(P.ELEVATION))
  // Three elevation levels, increasing blur, each a plain black drop shadow
  assert.deepEqual(Object.keys(P.ELEVATION), ['raised', 'panel', 'overlay'])
  const levels = Object.values(P.ELEVATION)
  const blur = (v) => Number(v.split(' ')[2].replace('px', ''))
  for (let i = 1; i < levels.length; i++) assert.ok(blur(levels[i]) > blur(levels[i - 1]), levels[i])
  for (const v of levels) assert.match(v, /^\d+(px)? \d+px \d+px rgb\(0 0 0 \/ 0\.\d+\)$/, v)
  // Engraved separator: two inset lines only (never changes size): light return over a dark seam
  const parts = P.ENGRAVED_SEPARATOR.split(', ')
  assert.equal(parts.length, 2)
  for (const part of parts) assert.match(part, /^inset 0 -\d+px 0 rgb\(var\(--color-edge-(light|dark)\)/, part)
  assert.match(parts[0], /--color-edge-light\) \/ 0\.\d+/)
  assert.match(parts[1], /--color-edge-dark/)
  // Control states are declaration sets of paint properties only
  for (const set of [P.KEY_CAP, P.KEY_CAP_PRESSED, P.SELECTED_KEY]) {
    assert.ok(Object.isFrozen(set))
    for (const [property, value] of Object.entries(set)) {
      assert.match(property, /^(background-color|background-image|box-shadow|border-radius|color)$/, property)
      assert.match(value, SAFE_VALUE, value)
    }
  }
  // Selected key: pressed (inset) + an accent cue, so state never relies on color alone
  assert.match(P.SELECTED_KEY['box-shadow'], /^inset 0 0 0 1px rgb\(var\(--color-accent\)/)
  assert.ok(P.SELECTED_KEY['box-shadow'].includes(P.PRESSED_BEVEL))
  assert.equal(P.SELECTED_KEY['background-image'], 'none')
  // Key cap: raised bevel on the control's own box (squared), pressed inverts it; no fill or size change
  assert.deepEqual({ ...P.KEY_CAP }, { 'border-radius': P.RADIUS.key, 'background-image': P.STEEL_SHEEN, 'box-shadow': P.RAISED_BEVEL })
  assert.deepEqual({ ...P.KEY_CAP_PRESSED }, { 'background-image': 'none', 'box-shadow': P.PRESSED_BEVEL })
  // Every string primitive is a safe paint value that references only derived edge colors or the accent token
  for (const value of [P.RAISED_BEVEL, P.PRESSED_BEVEL, P.RECESSED_WELL, P.STEEL_SHEEN, P.CHASSIS_SHEEN, P.ARTWORK_FRAME, P.ENGRAVED_SEPARATOR, P.ENGRAVED_SEPARATOR_TOP, P.RECESSED_FACE, P.SELECTED_KEY['box-shadow'], ...Object.values(P.RADIUS), ...Object.values(P.ELEVATION)]) {
    assert.match(value, SAFE_VALUE, value)
    for (const v of value.match(/--[a-z-]+/g) || []) assert.ok(['--color-edge-light', '--color-edge-dark', '--color-accent'].includes(v), v)
  }
})

test('existing rules reuse the primitives (radius scale, elevation levels, pressed state)', () => {
  const P = presets.PRIMITIVES
  const rules = presets.presentationRules([llama()])
  const root = engine.themeSelector('llama')
  assert.equal(rules[`${root} .fullscreen #playerTrack`]['border-radius'], P.RADIUS.key)
  assert.equal(rules[`${root} .fullscreen .total-track`]['border-radius'], P.RADIUS.key)
  assert.ok(rules[`${root} .btn:not(:disabled)`]['box-shadow'].endsWith(P.ELEVATION.raised))
  assert.ok(rules[`${root} .card-artwork`]['box-shadow'].endsWith(P.ELEVATION.panel))
  for (const s of ['.modal .rounded-lg.bg-primary', '.modal .queue-panel.rounded-lg.bg-primary', '.modal .chapters-panel.bg-secondary']) assert.ok(rules[`${root} ${s}`]['box-shadow'].endsWith(P.ELEVATION.overlay), s)
  assert.deepEqual(rules[`${root} .btn:not(:disabled):active`], { ...P.KEY_CAP_PRESSED })
  assert.deepEqual(rules[`${root} .icon-btn.border:not(:disabled):active`], { ...P.KEY_CAP_PRESSED })
  // No radius in the recipe falls outside the scale
  for (const [selector, declarations] of Object.entries(rules)) {
    for (const [property, value] of Object.entries(declarations)) if (/^border(-(top|bottom)-(left|right))?-radius$/.test(property)) assert.ok(Object.values(P.RADIUS).includes(value), `${selector}: ${property}`)
  }
  // The square corner is only for the dual-track display's inner corners
  for (const [selector, declarations] of Object.entries(rules)) {
    for (const [property, value] of Object.entries(declarations)) if (/radius$/.test(property) && value === P.RADIUS.none) assert.match(selector, /faceplate-dual/, `${selector}: ${property}`)
  }
})

test('artwork frame targets artwork via the card-artwork hook, never a whole list row', async () => {
  const rules = presets.presentationRules([llama()])
  assert.ok(!Object.keys(rules).some((s) => s.includes('book-card')), 'no id-prefix selector (it also matches list rows)')
  const frame = rules["html[data-theme='llama'] .card-artwork"]
  assert.deepEqual(Object.keys(frame), ['box-shadow'])
  assert.ok(frame['box-shadow'].startsWith(presets.PRIMITIVES.ARTWORK_FRAME))
  // Grid card: the card root is the cover, so it carries the hook (next to the id other code relies on)
  const grid = await read('../components/cards/LazyBookCard.vue')
  assert.match(grid, /<div ref="card" tabindex="0" :id="`book-card-\$\{index\}`"[^>]*class="card-artwork rounded-sm z-10 bg-primary cursor-pointer box-shadow-book"/)
  assert.equal((grid.match(/card-artwork/g) || []).length, 1)
  // List row: the row root (same id prefix) has no hook; only its cover box does
  const list = await read('../components/cards/LazyListBookCard.vue')
  const rowRoot = list.match(/<div ref="card" :id="`book-card-\$\{index\}`"[^>]*>/)[0]
  assert.doesNotMatch(rowRoot, /card-artwork/)
  assert.match(list, /<div class="card-artwork list-card-cover relative">/)
  assert.equal((list.match(/card-artwork/g) || []).length, 1)
})

test('only bordered icon buttons get the steel key treatment; borderless icon buttons stay bare glyphs', async () => {
  const rules = presets.presentationRules([llama()])
  const iconSelectors = Object.keys(rules).filter((s) => s.includes('icon-btn'))
  assert.deepEqual(iconSelectors, ["html[data-theme='llama'] .icon-btn.border:not(:disabled)", "html[data-theme='llama'] .icon-btn.border:not(:disabled):active", "html[data-theme='llama'] .icon-btn.border.bg-error:not(:disabled) > .material-symbols"])
  // The components add `border` exactly when the button is not borderless
  const iconBtn = await read('../components/ui/IconBtn.vue')
  assert.match(iconBtn, /if \(!this\.borderless\) \{\s*classes\.push\(`bg-\$\{this\.bgColor\} border border-gray-600`\)/)
  const readBtn = await read('../components/ui/ReadIconBtn.vue')
  assert.match(readBtn, /:class="borderless \? '' : 'bg-primary border border-gray-600'"/)
})

test('Gate A rules compile through Tailwind with their exact values; standard themes get none of them', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, selector)
    return css.slice(i, css.indexOf('}', i))
  }
  assert.match(block("html[data-theme='llama'] .modal .chapters-panel li > .bg-yellow-400"), /background-color: rgb\(var\(--color-track-cursor\)\)/)
  assert.match(block("html[data-theme='llama'] .card-artwork"), /box-shadow: 0 0 0 1px rgb\(var\(--color-edge-dark\)\)/)
  assert.match(block("html[data-theme='llama'] .icon-btn.border:not(:disabled)"), /background-image: linear-gradient/)
  assert.ok(!/(^|\n)\s*\.card-artwork\s*\{/.test(css), 'no unscoped card-artwork rule')
  assert.ok(!css.includes('[id^=book-card]'), 'the old row-matching selector is gone')
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

// --- Phase 2C Gate B: full player and mini-player equipment fidelity (paint only) ---

// The player keys' own rules are Phase 4J key faces (tested below); Gate B keeps the deck, seams, readouts and seek states
const GATE_B = ['.fullscreen .cover-wrapper', '.fullscreen #playerContent', '.fullscreen #playerControls', '#streamContainer:not(.fullscreen) #playerTrack', '#playerContent .sleep-readout', '#playerTrack .bg-track-cursor.bg-yellow-300']

test('Gate B player rules are paint only, built from the shared primitives', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const rule = (s) => rules[`${root} ${s}`]
  for (const s of GATE_B) {
    assert.ok(rule(s), s)
    for (const [property, value] of Object.entries(rule(s))) {
      assert.match(property, /^(background-color|background-image|box-shadow|border-radius|color)$/, `${s}: ${property}`)
      assert.match(value, SAFE_VALUE, `${s}: ${value}`)
    }
  }
  // Artwork: squared frame radius (replaces the player's 16px fullscreen card radius), mounted with the panel elevation
  assert.equal(rule('.cover-wrapper')['border-radius'], P.RADIUS.frame)
  assert.equal(rule('.fullscreen .cover-wrapper')['box-shadow'], `${P.ARTWORK_FRAME}, ${P.ELEVATION.panel}`)
  // Transport deck: raised chassis panel with a dark seam above it
  assert.deepEqual(rule('.fullscreen #playerContent'), { 'background-color': 'rgb(var(--color-bg))', 'background-image': P.CHASSIS_SHEEN, 'box-shadow': `${P.RAISED_BEVEL}, 0 -1px 0 rgb(var(--color-edge-dark))` })
  // Seam between the transport and secondary rows (fullscreen); the mini's seek region is a recessed readout strip
  // (Phase 7B, in place of its former top seam)
  assert.deepEqual(rule('.fullscreen #playerControls'), { 'box-shadow': P.ENGRAVED_SEPARATOR })
  assert.deepEqual(rule('#streamContainer:not(.fullscreen) #playerTrack'), { ...P.MINI_READOUT_STRIP })
  // Recessed displays keep their content-box well and squared radius, now with a recessed face
  for (const s of ['.fullscreen #playerTrack', '.fullscreen .total-track']) {
    assert.equal(rule(s)['background-image'], P.RECESSED_FACE, s)
    assert.equal(rule(s)['background-clip'], 'content-box', s)
    assert.equal(rule(s)['border-radius'], P.RADIUS.key, s)
  }
  // Mirror-image seam: two inset lines, never a size change
  const top = P.ENGRAVED_SEPARATOR_TOP.split(', ')
  assert.equal(top.length, 2)
  assert.match(top[0], /^inset 0 1px 0 rgb\(var\(--color-edge-dark\)\)$/)
  assert.match(top[1], /^inset 0 2px 0 rgb\(var\(--color-edge-light\) \/ 0\.\d+\)$/)
})

test('Gate B readouts: sleep countdown is a phosphor readout in LLAMA only; success keeps its meaning', () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  assert.deepEqual(rules[`${root} #playerContent .sleep-readout`], { color: 'rgb(var(--color-accent))' })
  // No LLAMA rule repaints success semantics anywhere
  for (const [selector, declarations] of Object.entries(rules)) {
    assert.doesNotMatch(selector, /success/, selector)
    for (const value of Object.values(declarations)) assert.doesNotMatch(value, /--color-success/, selector)
  }
})

test('Gate B pending seek stays the played-progress amber but segmented, distinct from the settled bar', async () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const pending = rules[`${root} #playerTrack .bg-track-cursor.bg-yellow-300`]
  const settled = rules[`${root} #playerTrack .bg-track-cursor.bg-gray-200`]
  assert.deepEqual(settled, { 'background-color': 'rgb(var(--color-track-cursor))' })
  assert.equal(pending['background-color'], 'transparent')
  assert.match(pending['background-image'], /^repeating-linear-gradient\(90deg, rgb\(var\(--color-track-cursor\)\) 0 \d+px, rgb\(var\(--color-track-cursor\) \/ 0\.\d+\) \d+px \d+px\)$/)
  // The seek code still toggles exactly these two state classes on the played bar
  const player = await read('../components/app/AudioPlayer.vue')
  assert.match(player, /this\.\$refs\.playedTrack\.classList\.remove\('bg-gray-200'\)\s*this\.\$refs\.playedTrack\.classList\.add\('bg-yellow-300'\)/)
  assert.match(player, /this\.\$refs\.playedTrack\.classList\.remove\('bg-yellow-300'\)\s*this\.\$refs\.playedTrack\.classList\.add\('bg-gray-200'\)/)
})

test('Phase 3A: a drag started while a seek is still pending keeps the played line solid amber', async () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const dragging = rules[`${root} #playerTrack .seek-dragging > .bg-track-cursor.bg-yellow-300`]
  assert.deepEqual(dragging, { 'background-color': 'rgb(var(--color-track-cursor))', 'background-image': 'none' })
  // The pending (segmented) rule is unchanged for the not-dragging case
  assert.match(rules[`${root} #playerTrack .bg-track-cursor.bg-yellow-300`]['background-image'], /^repeating-linear-gradient/)
  // The hook is bound to the drag state on the seek rail itself (the played bar's parent)
  const player = await read('../components/app/AudioPlayer.vue')
  assert.match(player, /ref="track"[^>]*:class="\{[^}]*'seek-dragging': isDraggingCursor[^}]*\}"/)
  assert.match(player, /<div ref="track"[^>]*>\s*<div ref="readyTrack"[\s\S]*?<div ref="playedTrack"/)
  // The standard finish has no such rule: Dark/Black/Light are untouched
  for (const id of ['dark', 'black', 'light']) assert.ok(!Object.keys(presets.presentationRules([engine.getTheme(id)])).some((s) => s.includes('seek-dragging')), id)
})

test('Gate B semantic hooks: player keys, unavailable state and sleep readout are marked in the player template', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  // Eight keys: chapter start/end, both jumps, and queue, bookmark, sleep, chapters in the secondary row
  assert.equal((template.match(/class="player-key /g) || []).length, 8)
  assert.equal((template.match(/class="player-key [^"]*next-icon/g) || []).length, 2)
  assert.equal((template.match(/class="player-key [^"]*jump-icon/g) || []).length, 2)
  // The four secondary-row keys also carry the utility hooks (Phase 4J); the sleep key is the icon's wrapper
  assert.match(template, /v-if="playerSettings\.showQueueIcon" class="player-key utility-key queue-key relative cursor-pointer"/)
  assert.match(template, /class="player-key utility-key bookmark-key material-symbols text-3xl text-fg-muted cursor-pointer" :class="\{ fill: bookmarks\.length \}"/)
  assert.match(template, /<span v-if="!sleepTimerRunning" class="player-key utility-key sleep-key flex cursor-pointer" @click\.stop="\$emit\('showSleepTimer'\)">\s*<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="h-7 w-7 text-fg-muted"/)
  assert.match(template, /class="player-key utility-key chapters-key material-symbols text-3xl text-fg cursor-pointer" :class="chapters\.length \? 'text-opacity-75' : 'text-opacity-10 key-disabled'"/)
  // Unavailable keys are marked together with the existing dimmed glyph state, never instead of it
  assert.equal((template.match(/'text-opacity-10 key-disabled'/g) || []).length, 5)
  assert.doesNotMatch(template, /'text-opacity-10'/)
  // The invisible podcast placeholder, the speed readout and the round play button are not keys
  assert.match(template, /<span v-else class="material-symbols text-3xl text-white text-opacity-0">bookmark<\/span>/)
  assert.match(template, /<span class="speed-readout font-mono text-fg-muted cursor-pointer" style="font-size: 1\.35rem"/)
  assert.doesNotMatch(template, /player-key[^"]*play-btn|play-btn[^"]*player-key/)
  assert.match(template, /<p class="sleep-readout text-xl font-mono text-success">/)
  // The geometry the hooks sit on is unchanged: 120px mini-player, 200px fullscreen panel, control sizes
  const style = player.slice(player.indexOf('<style>'))
  assert.match(style, /\.playerContainer \{\s*height: 120px;\s*\}/)
  assert.match(style, /\.fullscreen \.playerContainer \{\s*height: 200px;\s*\}/)
  assert.match(style, /#playerControls \.play-btn \{[^}]*height: 40px;\s*width: 40px;/)
  assert.match(style, /\.fullscreen #playerControls \.play-btn \{\s*height: 65px;\s*width: 65px;/)
})

test('Gate B rules compile through Tailwind under the LLAMA root only', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, selector)
    return css.slice(i, css.indexOf('}', i))
  }
  const root = "html[data-theme='llama']"
  assert.match(block(`${root} .fullscreen #playerControls .player-key`), /width: 60px;[\s\S]*border-radius: 4px;[\s\S]*background-image: linear-gradient/)
  assert.match(block(`${root} #playerContent .sleep-readout`), /color: rgb\(var\(--color-accent\)\)/)
  assert.match(block(`${root} #playerTrack .bg-track-cursor.bg-yellow-300`), /background-image: repeating-linear-gradient/)
  assert.match(block(`${root} #playerTrack .seek-dragging > .bg-track-cursor.bg-yellow-300`), /background-image: none/)
  assert.match(block(`${root} .fullscreen #playerContent`), /background-color: rgb\(var\(--color-bg\)\)/)
  assert.match(block(`${root} .cover-wrapper`), /border-radius: 2px/)
  for (const hook of ['player-key', 'key-disabled', 'sleep-readout']) assert.ok(!new RegExp(`(^|\\n|\\})\\s*\\.${hook}`).test(css), `no unscoped ${hook} rule`)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

// --- Phase 2C Gate B.1: primary play control steel finish ---

test('Gate B.1 steel stays on the secondary steel surfaces; the play button no longer uses steel (Phase 4H)', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  // The silver PRIMARY_STEEL face of Gate B.1 is retired: Play/Pause is the dark primary key (see Phase 4H below)
  assert.ok(!('PRIMARY_STEEL' in P) && !('PRIMARY_STEEL_PRESSED' in P))
  assert.deepEqual(rules[`${root} #playerControls .play-btn`], { ...P.PRIMARY_KEY })
  // Secondary keys and the other steel surfaces are unchanged
  assert.equal(P.KEY_CAP['background-image'], P.STEEL_SHEEN)
  assert.equal(P.STEEL_SHEEN, 'linear-gradient(180deg, rgb(var(--color-edge-light) / 0.18) 0%, rgb(var(--color-edge-light) / 0) 55%, rgb(0 0 0 / 0.18) 100%)')
  for (const s of ['#bookshelf-navbar', '.btn:not(:disabled)', '.icon-btn.border:not(:disabled)', '.bookshelfDivider']) assert.equal(rules[`${root} ${s}`]['background-image'], P.STEEL_SHEEN, s)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

// --- Phase 2C Gate C: Up Next and player-adjacent overlays (paint only) ---

const GATE_C_HOOKS = {
  '../components/modals/QueueModal.vue': [/class="queue-panel /, /<div v-if="nowPlayingDisplay" class="queue-current /, /<li v-for="item in upcomingLocal" :key="itemKey\(item\)" class="queue-row /],
  '../components/modals/PlaybackSpeedModal.vue': [/class="playback-option-panel /, /:class="rate === selected \? 'bg-bg-hover\/50 option-selected' : ''"/, /class="option-panel-footer /, /<p class="speed-readout text-xl">/],
  '../components/modals/SleepTimerModal.vue': [/class="playback-option-panel /, /<p class="sleep-readout text-2xl font-mono text-center">\{\{ timeRemainingPretty \}\}<\/p>/],
  '../components/modals/BookmarksModal.vue': [/<div class="bookmarks-list w-full h-full" v-else>/],
  '../components/modals/bookmarks/BookmarkItem.vue': [/class="bookmark-row /, /:class="highlight \? 'bg-bg bg-opacity-60 bookmark-current' : ' bg-opacity-20'"/, /<i class="bookmark-icon material-symbols/]
}

test('Gate C semantic hooks are present in the player-adjacent overlay templates; behavior hooks are untouched', async () => {
  for (const [file, patterns] of Object.entries(GATE_C_HOOKS)) {
    const source = await read(file)
    for (const pattern of patterns) assert.match(source, pattern, `${file}: ${pattern}`)
  }
  // Drag/reorder and removal wiring stay exactly as they were
  const queue = await read('../components/modals/QueueModal.vue')
  assert.match(queue, /<draggable v-else v-model="upcomingLocal" tag="ul" handle="\.drag-handle" @end="onDragEnd">/)
  assert.match(queue, /<span class="material-symbols drag-handle text-fg-muted cursor-grab text-xl mr-1">drag_indicator<\/span>/)
  assert.match(queue, /@click\.stop="\$emit\('remove', item\)"/)
  // The overlays carrying these hooks are only used by the player container (scoped, not app-wide)
  const container = await read('../components/app/AudioPlayerContainer.vue')
  for (const tag of ['modals-queue-modal', 'modals-playback-speed-modal', 'modals-sleep-timer-modal', 'modals-bookmarks-modal']) assert.match(container, new RegExp(`<${tag} `), tag)
})

test('Gate C rules: paint only, built from the shared primitives, under the LLAMA root', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const rule = (s) => rules[`${root} ${s}`]
  // The overlays' rules only: the player's own speed readout and bookmark key (#playerContent) are Phase 4J's
  const gateC = Object.entries(rules).filter(([s]) => !s.includes('#playerContent') && /queue-current|queue-row|playback-option-panel|speed-readout|\.modal \.sleep-readout|bookmark/.test(s))
  assert.ok(gateC.length >= 14, `${gateC.length} rules`)
  for (const [selector, declarations] of gateC) {
    assert.ok(selector.startsWith(`${root} .modal `), selector)
    for (const [property, value] of Object.entries(declarations)) {
      assert.match(property, /^(background-color|background-image|box-shadow|border-radius|border-color|color)$/, `${selector}: ${property}`)
      assert.match(value, SAFE_VALUE, `${selector}: ${value}`)
    }
  }
  // Recessed list wells inside the chassis panels
  for (const s of ['.modal .playback-option-panel ul[role=listbox]', '.modal .bookmarks-list']) assert.deepEqual(rule(s), { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': P.RECESSED_WELL }, s)
  // Engraved seams between rows (never after the last row)
  for (const s of ['.modal .queue-panel .queue-row:not(:last-child)', '.modal .playback-option-panel li[role=option]:not(:last-child)', '.modal .bookmark-row:not(:last-child)']) assert.deepEqual(rule(s), { 'box-shadow': P.ENGRAVED_SEPARATOR }, s)
  // Selected speed: a selected equipment key (pressed + accent ring) on a lit row
  assert.deepEqual(rule('.modal .playback-option-panel li[role=option].option-selected'), { 'background-color': 'rgb(var(--color-bg))', ...P.SELECTED_KEY })
  // Speed steppers are equipment keys on a raised chassis strip
  assert.deepEqual(rule('.modal .playback-option-panel .icon-num-btn:not(:disabled)'), { ...P.KEY_CAP })
  assert.deepEqual(rule('.modal .playback-option-panel .icon-num-btn:not(:disabled):active'), { ...P.KEY_CAP_PRESSED })
  assert.equal(rule('.modal .playback-option-panel .option-panel-footer')['background-image'], P.CHASSIS_SHEEN)
  assert.equal(rule('.modal .playback-option-panel .option-panel-footer')['box-shadow'], P.RAISED_BEVEL)
})

test('Gate C current entries: lit, pressed in and marked with the played-progress amber like Chapters', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const marker = 'inset 2px 0 0 rgb(var(--color-track-cursor))'
  for (const s of ['.modal .queue-panel .queue-current', '.modal .bookmark-row.bookmark-current']) {
    const r = rules[`${root} ${s}`]
    assert.equal(r['background-color'], 'rgb(var(--color-bg))', s) // the same lit surface as Chapters' current row
    assert.ok(r['box-shadow'].startsWith(`${marker}, ${P.PRESSED_BEVEL}`), s) // amber marker + pressed: not color alone
  }
  // Chapters' marker is the same amber, 2px wide (w-0.5)
  assert.deepEqual(rules[`${root} .modal .chapters-panel li > .bg-yellow-400`], { 'background-color': 'rgb(var(--color-track-cursor))' })
  // The bookmark at the current position is amber (position), not success green; live readouts are accent green
  assert.deepEqual(rules[`${root} .modal .bookmark-current .bookmark-icon`], { color: 'rgb(var(--color-track-cursor))' })
  for (const s of ['.modal .speed-readout', '.modal .sleep-readout']) assert.deepEqual(rules[`${root} ${s}`], { color: 'rgb(var(--color-accent))' }, s)
})

test('Gate C cascade: state rules outrank the row seams they share an element with', () => {
  const root = engine.themeSelector('llama')
  const order = Object.keys(presets.presentationRules([llama()]))
  // [ids, classes/attributes/pseudo-classes, elements] for the simple selectors used by the recipe
  const specificity = (selector) => {
    const s = selector.replace(/:not\(([^)]*)\)/g, ' $1')
    return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!not)[\w-]+/g) || []).length, (s.match(/(^|[\s>+~])[a-z]+/g) || []).length]
  }
  const wins = (a, b) => {
    const [x, y] = [specificity(a), specificity(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
    return order.indexOf(a) > order.indexOf(b)
  }
  const pairs = [
    ['.modal .playback-option-panel li[role=option].option-selected', '.modal .playback-option-panel li[role=option]:not(:last-child)'],
    ['.modal .bookmark-row.bookmark-current', '.modal .bookmark-row:not(:last-child)']
  ]
  for (const [state, seam] of pairs) assert.ok(wins(`${root} ${state}`, `${root} ${seam}`), `${state} must win over ${seam}`)
})

test('Gate C rules compile through Tailwind; Dark, Black and Light still get no presentation rules', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const root = "html[data-theme='llama']"
  for (const s of ['.modal .queue-panel .queue-current', '.modal .playback-option-panel li[role=option].option-selected', '.modal .playback-option-panel ul[role=listbox]', '.modal .bookmark-current .bookmark-icon', '.modal .speed-readout']) assert.ok(css.includes(`${root} ${s} {`), s)
  for (const hook of ['queue-current', 'queue-row', 'playback-option-panel', 'option-selected', 'bookmark-row', 'bookmark-current', 'bookmarks-list', 'speed-readout']) assert.ok(!new RegExp(`(^|\\n|\\})\\s*\\.${hook}\\b`).test(css), `no unscoped ${hook} rule`)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

// --- Phase 2C Gate D: browsing and detail surfaces (paint only) ---

// [ids, classes/attributes/pseudo-classes, elements] for the simple selectors the recipe and app.css use
const specificityOf = (selector) => {
  const s = selector.replace(/:not\(([^)]*)\)/g, ' $1')
  return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!not)[\w-]+/g) || []).length, (s.match(/(^|[\s>+~])[a-z]+/g) || []).length]
}
const outranks = (a, b, order = []) => {
  const [x, y] = [specificityOf(a), specificityOf(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return order.indexOf(a) > order.indexOf(b)
}

test('Gate D artwork hooks mark the artwork box of every card type, never a card root or row', async () => {
  // Series, collection and playlist cards: the root is the card, the inner box is the cover
  for (const [file, id] of [
    ['../components/cards/LazySeriesCard.vue', 'series-card'],
    ['../components/cards/LazyCollectionCard.vue', 'collection-card'],
    ['../components/cards/LazyPlaylistCard.vue', 'playlist-card']
  ]) {
    const source = await read(file)
    const root = source.match(new RegExp(`<div ref="card" :id="\`${id}-\\$\\{index\\}\`"[^>]*>`))[0]
    assert.doesNotMatch(root, /card-artwork/, `${file} root`)
    assert.match(source, /<div class="card-artwork w-full h-full bg-primary relative rounded overflow-hidden">/, file)
    assert.equal((source.match(/card-artwork/g) || []).length, 1, file)
  }
  // Author card: the portrait box (its own rounded portrait shape is kept), not the outer wrapper
  const author = await read('../components/cards/AuthorCard.vue')
  assert.match(author, /<div :style="\{ width: width \+ 'px', height: height \+ 'px' \}" class="card-artwork bg-primary box-shadow-book rounded-md relative overflow-hidden">/)
  assert.equal((author.match(/card-artwork/g) || []).length, 1)
  // Group-table rows: the cover box only; the collection row root is a group-row, not artwork
  const bookRow = await read('../components/tables/collection/BookTableRow.vue')
  assert.match(bookRow, /<div class="group-row w-full px-2 py-2 overflow-hidden relative">/)
  assert.match(bookRow, /<div class="card-artwork h-full relative" :style="\{ width: bookWidth \+ 'px' \}">/)
  const itemRow = await read('../components/tables/playlist/ItemTableRow.vue')
  assert.match(itemRow, /<div class="card-artwork h-full relative" :style="\{ width: '50px' \}">/)
  for (const row of [bookRow, itemRow]) assert.equal((row.match(/card-artwork/g) || []).length, 1)
  // Detail artwork: the item cover box (it also holds the progress bar), and the collection/playlist cover
  // components at their detail usage only (cards and the playlists modal keep their own treatment)
  const item = await read('../pages/item/_id/index.vue')
  assert.match(item, /<div class="detail-artwork relative" @click="showFullscreenCover = true">/)
  assert.match(item, /<div v-if="!isPodcast" class="absolute bottom-0 left-0 h-1 z-10 box-shadow-progressbar" :class="userIsFinished \? 'bg-success' : 'bg-yellow-400'"/)
  assert.match(await read('../pages/collection/_id.vue'), /<covers-collection-cover class="detail-artwork" /)
  assert.match(await read('../pages/playlist/_id.vue'), /<covers-playlist-cover class="detail-artwork" /)
  // Playlists-modal row (Gate E): its cover component is card artwork; the row root never is, and it has no detail artwork
  const playlistRow = await read('../components/modals/playlists/PlaylistRow.vue')
  assert.doesNotMatch(playlistRow, /detail-artwork/)
  assert.doesNotMatch(playlistRow.match(/<div :key="playlist\.id"[^>]*>/)[0], /card-artwork/)
  assert.match(playlistRow, /<covers-playlist-cover class="card-artwork" :items="items" :width="52" :height="52" \/>/)
})

test('Gate D semantic hooks are present on browsing and detail surfaces', async () => {
  const hooks = {
    '../components/bookshelf/Shelf.vue': [/<div class="shelf-section w-full relative">/],
    '../components/home/BookshelfToolbar.vue': [/<div class="browse-toolbar w-full h-9 bg-bg relative z-20">/, /class="filter-indicator absolute top-0 right-2 w-2 h-2 rounded-full bg-success/],
    '../components/app/Appbar.vue': [/aria-label="Show library modal" class="library-selector /],
    '../components/modals/LibrariesModal.vue': [/class="library-option-panel /, /'bg-primary bg-opacity-80 option-selected'/, /class="option-marker absolute top-0 left-0 w-0\.5 bg-warning h-full"/],
    '../pages/item/_id/index.vue': [/class="detail-progress px-4 py-2 bg-primary text-sm font-semibold rounded-md/],
    '../components/tables/ChaptersTable.vue': [/<div class="section-bar w-full bg-primary/, /<div class="section-count h-6 w-6 rounded-full/],
    '../components/tables/TracksTable.vue': [/<div class="section-bar w-full bg-primary/, /<div class="section-count h-6 w-6 rounded-full/],
    '../components/tables/ebook/EbookFilesTable.vue': [/<div class="section-bar w-full bg-primary/, /<div class="section-count h-6 w-6 rounded-full/],
    '../components/tables/collection/CollectionBooksTable.vue': [/<div class="group-items /, /<div class="section-bar w-full h-14/, /class="section-count /, /class="section-readout text-sm text-fg"/],
    '../components/tables/playlist/PlaylistItemsTable.vue': [/<div class="group-items /, /<div class="section-bar w-full h-14/, /class="section-count /, /class="section-readout text-sm text-fg"/],
    '../components/tables/collection/BookTableRow.vue': [/<button v-if="showPlayBtn" class="row-play-btn w-8 h-8 rounded-full/],
    '../components/tables/playlist/ItemTableRow.vue': [/<button v-if="showPlayBtn" class="row-play-btn w-8 h-8 rounded-full/]
  }
  for (const [file, patterns] of Object.entries(hooks)) {
    const source = await read(file)
    for (const pattern of patterns) assert.match(source, pattern, `${file}: ${pattern}`)
  }
  // Completed player/overlay surfaces carry none of the Gate D hooks, so no Gate D rule can repaint them
  for (const file of ['../components/app/AudioPlayer.vue', '../components/modals/QueueModal.vue', '../components/modals/ChaptersModal.vue', '../components/modals/PlaybackSpeedModal.vue', '../components/modals/SleepTimerModal.vue', '../components/modals/BookmarksModal.vue']) {
    assert.doesNotMatch(await read(file), /shelf-section|browse-toolbar|library-selector|library-option-panel|detail-artwork|detail-progress|section-bar|section-count|group-items|group-row|row-play-btn|tracksTable/, file)
  }
})

test('Gate D rules: paint only, built from the shared primitives, with LLAMA color semantics', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const rule = (s) => rules[`${root} ${s}`]
  const gateD = Object.entries(rules).filter(([s]) => /shelf-section|browse-toolbar|library-selector|library-option-panel|detail-artwork|detail-progress|section-bar|tracksTable|group-items|row-play-btn/.test(s))
  assert.ok(gateD.length >= 20, `${gateD.length} rules`)
  for (const [selector, declarations] of gateD) {
    for (const [property, value] of Object.entries(declarations)) {
      assert.match(property, /^(background-color|background-image|box-shadow|border-radius|border-color|color)$/, `${selector}: ${property}`)
      assert.match(value, SAFE_VALUE, `${selector}: ${value}`)
      assert.doesNotMatch(value, /--color-success|--color-warning/, `${selector}: success/warning never mean selected or active`)
    }
  }
  // Artwork: detail artwork is mounted exactly like card artwork, on the squared frame radius
  assert.deepEqual(rule('.detail-artwork'), { 'border-radius': P.RADIUS.frame, 'box-shadow': `${P.ARTWORK_FRAME}, ${P.ELEVATION.panel}` })
  assert.equal(rule('.card-artwork')['box-shadow'], `${P.ARTWORK_FRAME}, ${P.ELEVATION.panel}`)
  // Information displays are recessed; tappable section headers are raised strips; their readouts are accent
  assert.deepEqual(rule('.detail-progress'), { 'background-color': 'rgb(var(--color-recessed))', 'border-radius': P.RADIUS.key, 'box-shadow': P.RECESSED_WELL })
  assert.deepEqual(rule('.section-bar'), { 'background-image': P.CHASSIS_SHEEN, 'box-shadow': P.RAISED_BEVEL })
  assert.equal(rule('.section-bar .section-count').color, 'rgb(var(--color-accent))')
  assert.deepEqual(rule('.section-bar .section-readout'), { color: 'rgb(var(--color-accent))' })
  assert.deepEqual(rule('.group-items'), { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': P.RECESSED_WELL })
  // Seams: shelf sections, the toolbar, list/group rows (never after the last row)
  for (const s of ['.shelf-section', '.group-items .group-row:not(:last-child)', '.modal .library-option-panel li[role=option]:not(:last-child)']) assert.equal(rule(s)['box-shadow'], P.ENGRAVED_SEPARATOR, s)
  assert.deepEqual(rule('.browse-toolbar'), { 'background-image': P.CHASSIS_SHEEN, 'box-shadow': P.ENGRAVED_SEPARATOR })
  // Keys: only real controls (library selector, row play buttons), with the pressed state
  for (const s of ['.library-selector', '.row-play-btn']) {
    assert.deepEqual(rule(s), { ...P.KEY_CAP }, s)
    assert.deepEqual(rule(`${s}:active`), { ...P.KEY_CAP_PRESSED }, s)
  }
  for (const [selector, declarations] of gateD) assert.ok(!Object.values(declarations).includes(P.PRIMARY_KEY['background-image']), `${selector}: the primary key face is reserved for the play button`)
  // Selection and activity: selected key + accent, never warning orange or success green
  assert.deepEqual(rule('.modal .library-option-panel li[role=option].option-selected'), { 'background-color': 'rgb(var(--color-bg))', ...P.SELECTED_KEY })
  assert.deepEqual(rule('.modal .library-option-panel .option-marker'), { 'background-color': 'rgb(var(--color-accent))' })
  assert.equal(rule('.browse-toolbar .filter-indicator')['background-color'], 'rgb(var(--color-accent))')
  // Progress semantics are untouched: unfinished bars stay amber via the existing rule, finished bars keep success
  assert.deepEqual(rules[`${root} .absolute.bottom-0.left-0.z-10.bg-yellow-400`], { 'background-color': 'rgb(var(--color-track-cursor))' })
  assert.ok(!Object.keys(rules).some((s) => /bg-success/.test(s)))
})

test('Gate D cascade: state, zebra and artwork rules win over the rules they share an element with', async () => {
  const root = engine.themeSelector('llama')
  const order = Object.keys(presets.presentationRules([llama()]))
  const r = (s) => `${root} ${s}`
  // Selected library outranks the row seam
  assert.ok(outranks(r('.modal .library-option-panel li[role=option].option-selected'), r('.modal .library-option-panel li[role=option]:not(:last-child)'), order))
  // Table zebra: the LLAMA even rows outrank the LLAMA base rows, and both outrank assets/app.css
  const css = await read('../assets/app.css')
  for (const base of ['.tracksTable tr', '.tracksTable tr:nth-child(even)']) assert.ok(css.includes(`${base} {`), base)
  assert.ok(outranks(r('.tracksTable tr:nth-child(even)'), r('.tracksTable tr'), order))
  assert.ok(outranks(r('.tracksTable tr:nth-child(even)'), '.tracksTable tr:nth-child(even)'))
  assert.ok(outranks(r('.tracksTable tr'), '.tracksTable tr'))
  // The frame outranks the author card's own box-shadow utility, and the item cover's progress bar keeps its
  // amber/success rule (no Gate D rule targets it)
  assert.ok(outranks(r('.card-artwork'), '.box-shadow-book'))
  const gateD = order.filter((s) => /detail-artwork/.test(s))
  assert.deepEqual(gateD, [r('.detail-artwork')])
})

test('Gate D rules compile through Tailwind under the LLAMA root; standard themes get none', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const root = "html[data-theme='llama']"
  for (const s of ['.detail-artwork', '.detail-progress', '.section-bar', '.tracksTable tr:nth-child(even)', '.group-items', '.library-selector', '.modal .library-option-panel li[role=option].option-selected', '.row-play-btn', '.browse-toolbar .filter-indicator', '.shelf-section']) assert.ok(css.includes(`${root} ${s} {`), s)
  for (const hook of ['shelf-section', 'browse-toolbar', 'library-selector', 'library-option-panel', 'detail-artwork', 'detail-progress', 'section-bar', 'section-count', 'group-items', 'group-row', 'row-play-btn', 'filter-indicator', 'option-marker']) assert.ok(!new RegExp(`(^|\\n|\\})\\s*\\.${hook}\\b`).test(css), `no unscoped ${hook} rule`)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

// --- Phase 2C Gate E: forms, shared dialogs and interactive controls (paint only) ---

const GATE_E = /toggle-btn|range-input|checkbox-box|dropdown-button|dropdown-menu|dialog-panel|membership-marker/

test('Gate E hooks: shared controls keep their native semantics and carry purpose-named hooks', async () => {
  const checkbox = await read('../components/ui/Checkbox.vue')
  assert.match(checkbox, /<div class="checkbox-box border-2 rounded flex flex-shrink-0 justify-center items-center" :class="\[wrapperClass, \{ 'checkbox-checked': selected, 'checkbox-disabled': disabled \}\]">/)
  assert.match(checkbox, /<input v-model="selected" :disabled="disabled" type="checkbox" class="opacity-0 absolute"/) // native input kept
  assert.match(checkbox, /<svg v-if="selected" class="checkbox-mark fill-current pointer-events-none"/)
  const range = await read('../components/ui/RangeInput.vue')
  assert.match(range, /<div class="range-input inline-flex">\s*<input v-model="input" type="range" :min="min" :max="max" :step="step"/)
  const dropdown = await read('../components/ui/Dropdown.vue')
  assert.match(dropdown, /class="dropdown-button relative w-full border[^"]*"[^>]*aria-haspopup="listbox"/)
  assert.match(dropdown, /<ul v-show="showMenu" class="dropdown-menu absolute z-10[^"]*" role="listbox">/)
  const toggles = await read('../components/ui/ToggleBtns.vue')
  assert.match(toggles, /class="toggle-btn outline-none relative border border-border px-4 py-1" :class="\{ selected: item\.value === value \}"/)
  const dialog = await read('../components/modals/Dialog.vue')
  assert.match(dialog, /<div ref="container" class="dialog-panel w-full overflow-x-hidden overflow-y-auto bg-primary rounded-lg border border-fg\/20 p-2"/)
  assert.match(dialog, /:class="selected === item\.value \? 'bg-success bg-opacity-10 option-selected' : ''"/)
  assert.match(dialog, /<ul class="h-full w-full" role="listbox"/)
  const playlistRow = await read('../components/modals/playlists/PlaylistRow.vue')
  assert.match(playlistRow, /<div v-if="inPlaylist" class="membership-marker absolute top-0 left-0 h-full w-1 bg-success z-10" \/>/)
  // Search results: the cover is the artwork; the result card root never is
  for (const [file, pattern] of [
    ['../components/cards/ItemSearchCard.vue', /<covers-book-cover class="card-artwork" /],
    ['../components/cards/EpisodeSearchCard.vue', /<covers-book-cover class="card-artwork" /],
    ['../components/cards/SeriesSearchCard.vue', /<covers-group-cover class="card-artwork" /],
    ['../components/cards/AuthorSearchCard.vue', /<div class="card-artwork overflow-hidden bg-primary rounded" style="height: 50px; width: 40px">/]
  ]) {
    const source = await read(file)
    assert.match(source, pattern, file)
    assert.equal((source.match(/card-artwork/g) || []).length, 1, file)
    assert.match(source, /<template>\s*<div class="flex h-full px-1 overflow-hidden">/, `${file}: root unchanged`)
  }
})

test('Gate E rules: paint only, primitives, and control-state semantics', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const rule = (s) => rules[`${root} ${s}`]
  const gateE = Object.entries(rules).filter(([s]) => GATE_E.test(s))
  assert.ok(gateE.length >= 21, `${gateE.length} rules`)
  for (const [selector, declarations] of gateE) {
    for (const [property, value] of Object.entries(declarations)) {
      assert.match(property, /^(background-color|background-image|box-shadow|border-radius|border-color|color|outline|outline-color|outline-offset)$/, `${selector}: ${property}`)
      assert.match(value, SAFE_VALUE, `${selector}: ${value}`)
      assert.doesNotMatch(value, /--color-success|--color-warning|--color-error/, `${selector}: state colors keep their meaning`)
    }
    assert.ok(!Object.values(declarations).includes(P.PRIMARY_KEY['background-image']), `${selector}: the primary key face stays the play button's`)
  }
  // Toggles: raised segments; selected = selected key; pressed inverts
  assert.deepEqual(rule('.toggle-btn'), { 'background-image': P.STEEL_SHEEN, 'box-shadow': P.RAISED_BEVEL })
  assert.deepEqual(rule('.toggle-btn.selected'), { ...P.SELECTED_KEY })
  assert.deepEqual(rule('.toggle-btn:active'), { ...P.KEY_CAP_PRESSED })
  // Checkbox: recessed empty well, checked = pressed with accent edge and accent check, disabled = flat and muted
  assert.equal(rule('.checkbox-box')['box-shadow'], P.RECESSED_WELL)
  assert.deepEqual(rule('.checkbox-box.checkbox-checked'), { 'background-color': 'rgb(var(--color-bg))', 'border-color': 'rgb(var(--color-accent))', 'box-shadow': P.PRESSED_BEVEL })
  assert.deepEqual(rule('.checkbox-box .checkbox-mark'), { color: 'rgb(var(--color-accent))' })
  assert.equal(rule('.checkbox-box.checkbox-disabled')['box-shadow'], 'none')
  assert.deepEqual(rule('.checkbox-box.checkbox-disabled .checkbox-mark'), { color: 'rgb(var(--color-fg-muted))' })
  assert.match(rule('.checkbox-box:has(input:focus-visible)').outline, /rgb\(var\(--color-accent\)\)/)
  // Range: recessed slot and steel thumb, never the playback amber (a setting is not progress)
  for (const [selector, declarations] of gateE.filter(([s]) => s.includes('range-input'))) for (const value of Object.values(declarations)) assert.doesNotMatch(value, /--color-track-cursor/, selector)
  assert.equal(rule('.range-input input[type=range]::-webkit-slider-thumb')['background-image'], P.STEEL_SHEEN)
  // Dropdown: the enabled trigger is a key (disabled stays flat); the open list is a recessed module
  assert.deepEqual(rule('.dropdown-button:not(:disabled)'), { ...P.KEY_CAP })
  assert.ok(!rules[`${root} .dropdown-button`], 'no rule for the disabled trigger')
  assert.ok(rule('.dropdown-menu')['box-shadow'].startsWith(P.RECESSED_WELL))
  // Dialog: recessed list, seamed rows, selected key instead of the success wash
  assert.deepEqual(rule('.modal .dialog-panel ul[role=listbox] > li.option-selected'), { 'background-color': 'rgb(var(--color-bg))', ...P.SELECTED_KEY })
  assert.equal(rule('.modal .dialog-panel ul[role=listbox] > li:not(:last-child)')['box-shadow'], P.ENGRAVED_SEPARATOR)
  assert.deepEqual(rule('.membership-marker'), { 'background-color': 'rgb(var(--color-accent))' })
  // IconBtn contract from Gate A is untouched: only bordered icon buttons are keys
  assert.ok(!gateE.some(([s]) => s.includes('icon-btn')))
  assert.deepEqual(
    Object.keys(rules).filter((s) => s.includes('icon-btn')),
    [`${root} .icon-btn.border:not(:disabled)`, `${root} .icon-btn.border:not(:disabled):active`, `${root} .icon-btn.border.bg-error:not(:disabled) > .material-symbols`]
  )
})

test('Gate E cascade: disabled, selected and pressed states win where they share an element', () => {
  const root = engine.themeSelector('llama')
  const order = Object.keys(presets.presentationRules([llama()]))
  const r = (s) => `${root} ${s}`
  assert.ok(outranks(r('.checkbox-box.checkbox-disabled'), r('.checkbox-box.checkbox-checked'), order), 'disabled checked never reads as active')
  assert.ok(outranks(r('.checkbox-box.checkbox-disabled .checkbox-mark'), r('.checkbox-box .checkbox-mark'), order))
  assert.ok(outranks(r('.toggle-btn.selected'), r('.toggle-btn'), order))
  assert.ok(outranks(r('.toggle-btn:active'), r('.toggle-btn.selected'), order), 'pressing a selected segment still inverts')
  assert.ok(outranks(r('.modal .dialog-panel ul[role=listbox] > li.option-selected'), r('.modal .dialog-panel ul[role=listbox] > li:not(:last-child)'), order))
  // The LLAMA toggle rules outrank the component's scoped styles ([data-v] adds one attribute)
  assert.ok(outranks(r('.toggle-btn.selected'), '.toggle-btn.selected[data-v-x]'))
  assert.ok(outranks(r('.toggle-btn:not(.selected)'), '.toggle-btn[data-v-x]'))
  assert.ok(outranks(r('.range-input input[type=range]::-webkit-slider-thumb'), 'input[type=range][data-v-x]::-webkit-slider-thumb'))
})

test('Gate E scoping: frozen player, overlays and browsing surfaces carry none of the Gate E hooks', async () => {
  // Player seek is not a range input, so the range rules cannot reach it
  assert.doesNotMatch(await read('../components/app/AudioPlayer.vue'), /type="range"|range-input/)
  // Gate C/D option panels and Chapters are not Dialog panels, so the Dialog rules cannot repaint them
  for (const file of ['../components/modals/QueueModal.vue', '../components/modals/PlaybackSpeedModal.vue', '../components/modals/SleepTimerModal.vue', '../components/modals/BookmarksModal.vue', '../components/modals/ChaptersModal.vue', '../components/modals/LibrariesModal.vue']) {
    assert.doesNotMatch(await read(file), /dialog-panel|checkbox-box|dropdown-menu|membership-marker/, file)
  }
  const rules = presets.presentationRules([llama()])
  for (const s of Object.keys(rules).filter((x) => GATE_E.test(x))) assert.doesNotMatch(s, /playerContent|playerTrack|queue-|playback-option-panel|chapters-panel|library-option-panel|bookmark/, s)
})

test('Gate E rules compile through Tailwind (pseudo-elements and :has included); standard themes get none', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const root = "html[data-theme='llama']"
  for (const s of ['.toggle-btn.selected', '.range-input input[type=range]::-webkit-slider-thumb', '.checkbox-box:has(input:focus-visible)', '.checkbox-box.checkbox-disabled', '.dropdown-button:not(:disabled)', '.modal .dialog-panel ul[role=listbox] > li.option-selected', '.membership-marker']) assert.ok(css.includes(`${root} ${s} {`), s)
  for (const hook of ['range-input', 'checkbox-box', 'dropdown-button', 'dropdown-menu', 'dialog-panel', 'membership-marker']) assert.ok(!new RegExp(`(^|\\n|\\})\\s*\\.${hook}\\b`).test(css), `no unscoped ${hook} rule`)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

test('Gate H: the LLAMA destructive key glyph is pure white (non-text contrast), and nothing else about icon buttons changes', () => {
  const rules = presets.presentationRules([llama()])
  const root = "html[data-theme='llama']"
  assert.deepEqual(rules[`${root} .icon-btn.border.bg-error:not(:disabled) > .material-symbols`], { color: 'rgb(255 255 255)' })
  // Paint only: the glyph color, no size/spacing properties
  for (const [selector, declarations] of Object.entries(rules)) if (selector.includes('bg-error')) assert.deepEqual(Object.keys(declarations), ['color'], selector)
  // White on the error fill clears 3:1 at every point of the steel sheen (edge-light at 0-18% over #FF5252)
  const t = llama().tokens
  const edge = presets.equipmentDerivedDeclarations(t)['--color-edge-light'].split(' ').map(Number)
  for (const a of [0, 0.09, 0.18])
    assert.ok(
      contrast(
        [255, 255, 255],
        t['state.error'].map((c, i) => edge[i] * a + c * (1 - a))
      ) >= 3,
      String(a)
    )
})

// --- Phase 4B: LLAMA secondary control finish (player and mini-player keys) ---

const PAINT_ONLY = /^(background-color|background-image|box-shadow|border-radius|color|-webkit-text-stroke)$/
const GEOMETRY_PROPERTY = /^(width|height|min-|max-|padding|margin|border(-width|-style)?$|top|right|bottom|left|inset|position|display|flex|gap|transform|translate|scale|line-height|font|letter-spacing|text-|overflow|z-index)/
// The full-player transport keys (the key's own fixed box is its face since the finishing pass): resting and pressed
const KEY_SELECTORS = ['.fullscreen #playerControls .player-key', '.fullscreen #playerControls .player-key:not(.key-disabled):active']
const LEGEND_SELECTORS = ['#playerContent .jump-icon:not(.key-disabled)', '#playerContent .next-icon:not(.key-disabled)']
const PRIMARY_LEGEND_SELECTORS = ['#playerControls .play-btn .material-symbols', '#playerControls .play-btn .la-ball-spin-clockwise']
// The utility keys' legends (Phase 4 finishing pass: amber = illuminated physical-control legend, superseding "amber is playback only")
const UTILITY_LEGEND_SELECTORS = ['#playerContent .utility-key:not(.key-disabled)', '#playerContent .utility-key:not(.key-disabled) > .material-symbols', '#playerContent .utility-key:not(.key-disabled) > svg']

test('Phase 4B player keys are a dedicated, frozen, paint-only primitive; the shared KEY_CAP is untouched', () => {
  const P = presets.PRIMITIVES
  for (const set of [P.PLAYER_KEY, P.PLAYER_KEY_PRESSED, P.PLAYBACK_LEGEND, P.PLAYBACK_GLYPH_WEIGHT]) {
    assert.ok(Object.isFrozen(set))
    for (const [property, value] of Object.entries(set)) {
      assert.match(property, PAINT_ONLY, property)
      assert.doesNotMatch(property, GEOMETRY_PROPERTY, property)
      assert.match(value, SAFE_VALUE, `${property}: ${value}`)
    }
  }
  // Every other surface that uses KEY_CAP (selectors, dropdowns, steppers, row play buttons, ...) keeps exactly the old key cap
  assert.deepEqual({ ...P.KEY_CAP }, { 'border-radius': P.RADIUS.key, 'background-image': P.STEEL_SHEEN, 'box-shadow': P.RAISED_BEVEL })
  assert.deepEqual({ ...P.KEY_CAP_PRESSED }, { 'background-image': 'none', 'box-shadow': P.PRESSED_BEVEL })
  const rules = presets.presentationRules([llama()])
  const root = engine.themeSelector('llama')
  for (const s of ['.library-selector', '.row-play-btn', '.dropdown-button:not(:disabled)', '.modal .playback-option-panel .icon-num-btn:not(:disabled)']) assert.deepEqual(rules[`${root} ${s}`], { ...P.KEY_CAP }, s)
  // Resting key: squared, with its own face fill (the recessed token, translucent so it follows the deck) and a sheen
  assert.equal(P.PLAYER_KEY['border-radius'], P.RADIUS.key)
  assert.match(P.PLAYER_KEY['background-color'], /^rgb\(var\(--color-recessed\) \/ 0\.\d+\)$/)
  assert.match(P.PLAYER_KEY['background-image'], /^linear-gradient\(180deg, rgb\(var\(--color-edge-light\)/)
  // Edge depth: lit and dark inner bevel, a second faint highlight line, a dark outer ring and a drop shadow (all box-shadow layers)
  const edge = P.PLAYER_KEY['box-shadow'].split(/, (?=inset|0)/)
  assert.ok(edge.length >= 5, P.PLAYER_KEY['box-shadow'])
  assert.ok(
    edge.some((l) => /^inset 1px 1px 0 rgb\(var\(--color-edge-light\)/.test(l)),
    'lit inner edge'
  )
  assert.ok(
    edge.some((l) => /^inset -1px -1px 0 rgb\(var\(--color-edge-dark\)\)/.test(l)),
    'dark inner edge'
  )
  assert.ok(
    edge.some((l) => /^0 0 0 1px rgb\(var\(--color-edge-dark\)\)/.test(l)),
    'dark outer ring'
  )
  assert.ok(
    edge.some((l) => /^0 2px 3px rgb\(0 0 0/.test(l)),
    'drop shadow'
  )
  // Pressed: no sheen, no drop shadow, an inverted inner bevel and an inner shade; the ring stays
  assert.equal(P.PLAYER_KEY_PRESSED['background-image'], 'none')
  assert.match(P.PLAYER_KEY_PRESSED['box-shadow'], /^inset 1px 1px 0 rgb\(var\(--color-edge-dark\)\), inset -1px -1px 0 rgb\(var\(--color-edge-light\)/)
  assert.match(P.PLAYER_KEY_PRESSED['box-shadow'], /inset 0 3px 6px rgb\(0 0 0/)
  assert.doesNotMatch(P.PLAYER_KEY_PRESSED['box-shadow'], /(^|, )0 2px 3px/)
  assert.notEqual(P.PLAYER_KEY['box-shadow'], P.PLAYER_KEY_PRESSED['box-shadow'])
  // Playback legend: exactly the played-progress amber, nothing else
  assert.deepEqual({ ...P.PLAYBACK_LEGEND }, { color: 'rgb(var(--color-track-cursor))' })
  // Heavier playback glyphs: a hairline stroke in the glyph's own color (restrained: at most 0.6px), ink only
  assert.deepEqual({ ...P.PLAYBACK_GLYPH_WEIGHT }, { '-webkit-text-stroke': '0.5px currentColor' })
  assert.ok(parseFloat(P.PLAYBACK_GLYPH_WEIGHT['-webkit-text-stroke']) <= 0.6)
})

test('Phase 4B legends are LLAMA-only paint: Dark, Black and Light get nothing', () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  // The key faces themselves are Phase 4J (fixed-size ::before plates, tested below); the legends stay paint only
  for (const s of LEGEND_SELECTORS) {
    const declarations = rules[`${root} ${s}`]
    assert.ok(declarations, s)
    for (const property of Object.keys(declarations)) {
      assert.match(property, PAINT_ONLY, `${s}: ${property}`)
      assert.doesNotMatch(property, GEOMETRY_PROPERTY, `${s}: ${property}`)
    }
  }
  // No selector with a player hook can escape the LLAMA root (a comma list would leave a second selector unscoped)
  for (const selector of Object.keys(rules)) {
    if (/player-key|jump-icon|next-icon/.test(selector)) {
      assert.ok(selector.startsWith(`${root} `), selector)
      assert.ok(!selector.slice(root.length).includes(','), selector)
    }
  }
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

test('Phase 4B amber legends: both jumps and chapter start/end, and (finishing pass) the utility keys; nothing else in the deck', async () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  assert.deepEqual(rules[`${root} ${LEGEND_SELECTORS[0]}`], { ...P.PLAYBACK_LEGEND })
  assert.deepEqual(rules[`${root} ${LEGEND_SELECTORS[1]}`], { ...P.PLAYBACK_LEGEND, ...P.PLAYBACK_GLYPH_WEIGHT })
  // The jump keys' glyph (not their label) takes the heavier weight; an unavailable key takes neither
  assert.deepEqual(rules[`${root} #playerContent .jump-icon:not(.key-disabled) > .material-symbols`], { ...P.PLAYBACK_GLYPH_WEIGHT })
  // The generic key rules paint no glyph color, so no key gets amber (or any other legend) by default
  for (const s of KEY_SELECTORS) assert.ok(!('color' in rules[`${root} ${s}`]), s)
  // Among the player's key and transport rules the amber token appears on exactly the two legend selectors, the
  // primary Play/Pause legend and its loading spinner (Phase 4H) and the utility keys' legends (finishing pass)
  const amber = Object.entries(rules).filter(([selector, d]) => /#playerContent|#playerControls/.test(selector) && Object.values(d).some((v) => String(v).includes('--color-track-cursor')))
  assert.deepEqual(amber.map(([selector]) => selector.slice(root.length + 1)).sort(), [...LEGEND_SELECTORS, ...PRIMARY_LEGEND_SELECTORS, ...UTILITY_LEGEND_SELECTORS].sort())
  // The hooks sit on the four transport keys only: queue, bookmark, sleep and chapters carry neither hook
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  assert.equal((template.match(/jump-icon/g) || []).length, 2)
  assert.equal((template.match(/next-icon/g) || []).length, 2)
  for (const utility of [/showQueueIcon" class="[^"]*"/, /class="player-key utility-key bookmark-key [^"]*"/, /<span v-if="!sleepTimerRunning"[^>]*class="[^"]*"/, /class="player-key utility-key chapters-key [^"]*"/]) {
    const m = template.match(utility)
    assert.ok(m, String(utility))
    assert.doesNotMatch(m[0], /jump-icon|next-icon/, m[0])
  }
  // The primary play control is not a player key and keeps its own recipe (Phase 4H)
  assert.deepEqual(rules[`${root} #playerControls .play-btn`], { ...P.PRIMARY_KEY })
  assert.deepEqual(rules[`${root} #playerControls .play-btn:active`], { ...P.PRIMARY_KEY_PRESSED })
  assert.ok(!Object.keys(rules).some((s) => /play-btn/.test(s) && /player-key/.test(s)))
})

test('Phase 4B states stay distinct: unavailable keys get no legend amber; pressed differs from resting', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  // Every legend rule and the pressed face exclude the unavailable state: a key-disabled key keeps no amber and never presses
  for (const s of [...LEGEND_SELECTORS, KEY_SELECTORS[1]]) assert.ok(s.includes(':not(.key-disabled)'), s)
  // Phase 4J: an unavailable key is a sunken socket with a dimmed legend; those are the only rules that target it
  const disabled = Object.keys(rules).filter((s) => s.includes('.key-disabled') && !s.includes(':not(.key-disabled)'))
  for (const s of disabled) assert.deepEqual(rules[s], { ...P.KEY_SOCKET, ...P.KEY_SOCKET_LEGEND }, s)
  assert.equal(disabled.length, 3, 'full transport, collapsed transport and utility')
  const resting = rules[`${root} ${KEY_SELECTORS[0]}`]
  const pressed = rules[`${root} ${KEY_SELECTORS[1]}`]
  assert.notEqual(resting['box-shadow'], pressed['box-shadow'])
  assert.notEqual(resting['background-image'], pressed['background-image'])
  // Pressed deepens the same recessed face (higher alpha), never changes its color family
  const alpha = (v) => Number(v.match(/^rgb\(var\(--color-recessed\) \/ (0\.\d+)\)$/)[1])
  assert.ok(alpha(pressed['background-color']) > alpha(resting['background-color']))
})

test('Phase 4B contrast: the key face is darker than its deck, the legend and glyphs clear AA on it', () => {
  const P = presets.PRIMITIVES
  const t = llama().tokens
  const alphaOf = (value) => Number(value.match(/\/ (0\.\d+)\)/)[1])
  const face = (deck, alpha) => t['surface.recessed'].map((c, i) => c * alpha + deck[i] * (1 - alpha))
  // Decks: the fullscreen panel (surface.content, resting face) and the collapsed player (surface.base, deeper face)
  const cases = { 'surface.content': alphaOf(P.PLAYER_KEY['background-color']), 'surface.base': alphaOf(P.PLAYER_KEY_FACE_MINI) }
  assert.ok(cases['surface.base'] > cases['surface.content'], 'the collapsed player needs the deeper face')
  for (const [name, alpha] of Object.entries(cases)) {
    const deck = t[name]
    const key = face(deck, alpha)
    assert.ok(luminance(key) < luminance(deck), `${name}: face darker than deck`)
    const separation = contrast(key, deck)
    assert.ok(separation >= 1.1 && separation <= 2, `${name}: key vs deck ${separation.toFixed(2)}:1 stays a visible but restrained step`)
    // The legend includes the 10px "10s" label, so it must clear the text threshold, not only the icon threshold
    assert.ok(contrast(t['progress.played'], key) >= 4.5, `${name}: amber legend on key face`)
    // Neutral utility glyphs: muted (bookmark, sleep, queue) and the 75% primary (chapters) over the face
    assert.ok(contrast(t['text.muted'], key) >= 4.5, `${name}: muted glyph on key face`)
    const dim = t['text.default'].map((c, i) => c * 0.75 + key[i] * 0.25)
    assert.ok(contrast(dim, key) >= 4.5, `${name}: 75% glyph on key face`)
  }
  // The silver primary play face is why amber must never go on it (the reason the legend is limited to the dark keys)
  const silver = [112, 121, 136]
  assert.ok(contrast(t['progress.played'], silver) < 3, 'amber on the silver play face fails 3:1')
})

test('Phase 4B rules compile through Tailwind under the LLAMA root only', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, selector)
    return css.slice(i, css.indexOf('}', i))
  }
  const root = "html[data-theme='llama']"
  assert.match(block(`${root} ${KEY_SELECTORS[0]}`), /background-color: rgb\(var\(--color-recessed\) \/ 0\.\d+\)/)
  assert.match(block(`${root} ${KEY_SELECTORS[1]}`), /background-image: none/)
  for (const s of LEGEND_SELECTORS) assert.match(block(`${root} ${s}`), /color: rgb\(var\(--color-track-cursor\)\)/, s)
  assert.match(block(`${root} #playerContent .jump-icon:not(.key-disabled) > .material-symbols`), /-webkit-text-stroke: 0\.5px currentColor/)
  assert.match(block(`${root} #playerContent .next-icon:not(.key-disabled)`), /-webkit-text-stroke: 0\.5px currentColor/)
  // Every compiled rule that mentions a player hook is under the LLAMA root
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    for (const selector of m[1].split(',')) if (/player-key|jump-icon|next-icon/.test(selector)) assert.ok(selector.trim().startsWith("html[data-theme='llama'] "), selector.trim())
  }
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

// --- Phase 4E: full-player metadata readout (the recipe's one authorized geometry) ---

const READOUT = '.fullscreen .title-author-texts'
const READOUT_ABOVE_TOTAL_TRACK = '.fullscreen .total-track ~ .title-author-texts'
// Phase 4H adds the primary glyph size (inside the unchanged Play/Pause box) as the recipe's only other geometry
const PRIMARY_GLYPH_FULL = '.fullscreen #playerControls .play-btn .material-symbols'
const PRIMARY_GLYPH_MINI = '#streamContainer:not(.fullscreen) #playerControls .play-btn .material-symbols'
// The control deck (Phase 4J, recomposed in the finishing pass) adds its own named geometry: each key's fixed box, the
// packed transport bank, the primary's lift, the utility row's padding, the readout boxes, the top chrome keys and display,
// the queue badge and the legends' sizes and offsets (transforms, which move no box)
const KEY_BOX_GEOMETRY = ['width', 'height', 'flex', 'display']
const READOUT_BOX_GEOMETRY = ['display', 'height', 'min-width', 'width', 'padding', 'line-height']
const READOUT_LAYOUT_PROPERTIES = {
  [READOUT]: ['left', 'width', 'padding', 'bottom'],
  [READOUT_ABOVE_TOTAL_TRACK]: ['bottom'],
  [PRIMARY_GLYPH_FULL]: ['font-size'],
  [PRIMARY_GLYPH_MINI]: ['font-size'],
  '#streamContainer.fullscreen #playerControls': ['bottom', 'padding-bottom'],
  '.fullscreen #playerControls > div': ['gap'],
  '.fullscreen #playerControls .play-btn': ['margin', 'top'],
  '.fullscreen #playerControls .player-key': KEY_BOX_GEOMETRY,
  '.fullscreen #playerControls .jump-icon > .material-symbols': ['font-size', 'transform'],
  '.fullscreen #playerControls .jump-label': ['font-weight'],
  '.fullscreen #playerControls .next-icon': ['font-size'],
  '#streamContainer:not(.fullscreen) #playerControls .player-key': KEY_BOX_GEOMETRY,
  '#streamContainer:not(.fullscreen) #playerControls .jump-icon > .material-symbols': ['transform'],
  '#playerContent .utility-key': KEY_BOX_GEOMETRY,
  '#playerContent .queue-key > span.absolute': ['bottom', 'right'],
  '.fullscreen #playerContent .utility-row': ['bottom', 'padding-top', 'padding-bottom'],
  '.fullscreen #playerContent .speed-readout': READOUT_BOX_GEOMETRY,
  '.fullscreen #playerContent .sleep-display': READOUT_BOX_GEOMETRY,
  '#streamContainer.fullscreen .chrome-key': [...KEY_BOX_GEOMETRY, 'font-size'],
  '#streamContainer.fullscreen .collapse-key': ['margin-top'],
  '#streamContainer.fullscreen .cast-key': ['margin-top'],
  '#streamContainer.fullscreen .menu-key': ['margin-top'],
  '#streamContainer.fullscreen .playback-method': ['width', 'padding', 'top'],
  // Phase 6B: the faceplate console banks, each exactly its framed section with its row centered (tests/player-layout)
  '#streamContainer.fullscreen.faceplate #playerControls': ['height', 'padding-top', 'padding-bottom', 'display', 'flex-direction'],
  '#streamContainer.fullscreen.faceplate #playerContent .utility-row': ['bottom', 'height', 'display', 'flex-direction'],
  '#streamContainer.fullscreen.faceplate-flat #playerContent .utility-row': ['bottom', 'height', 'display', 'flex-direction'],
  '#streamContainer.fullscreen.faceplate-dual #playerContent .utility-row': ['bottom', 'height', 'display', 'flex-direction'],
  // Phase 7B: the collapsed mini-player's type (face, spacing, and the times' size on their unchanged line box)
  '#streamContainer:not(.fullscreen) .title-author-texts .title-text': ['font-family', 'letter-spacing'],
  '#streamContainer:not(.fullscreen) .title-author-texts .author-text': ['font-family', 'letter-spacing'],
  '#streamContainer:not(.fullscreen) #playerTrack p.font-mono': ['font-family', 'font-size', 'line-height', 'font-variant-numeric', 'letter-spacing']
}

test('Phase 4E readout is a recessed well in a bezel plate: frozen, paint-only, from the shared primitives', () => {
  const P = presets.PRIMITIVES
  assert.ok(Object.isFrozen(P.METADATA_READOUT))
  assert.deepEqual(Object.keys(P.METADATA_READOUT).sort(), ['background-color', 'border-radius', 'box-shadow'])
  for (const [property, value] of Object.entries(P.METADATA_READOUT)) {
    assert.match(property, PAINT_ONLY, property)
    assert.match(value, SAFE_VALUE, `${property}: ${value}`)
  }
  // The display face is the recessed token with the shared recessed-well edges, on the key radius
  assert.equal(P.METADATA_READOUT['background-color'], 'rgb(var(--color-recessed))')
  assert.equal(P.METADATA_READOUT['border-radius'], P.RADIUS.key)
  assert.ok(P.METADATA_READOUT['box-shadow'].startsWith(`${P.RECESSED_WELL}, `))
  // The plate around it is drawn with outer shadows only (no border, so no layout): a dark seam, a deck-colored
  // plate, a lit upper-left lip, a dark lower-right lip and a soft drop
  const outer = P.METADATA_READOUT['box-shadow'].slice(P.RECESSED_WELL.length + 2).split(/, (?=-?\d)/)
  assert.deepEqual(outer, ['0 0 0 1px rgb(var(--color-edge-dark))', '0 0 0 3px rgb(var(--color-bg))', '-1px -1px 0 3px rgb(var(--color-edge-light) / 0.35)', '1px 1px 0 3px rgb(var(--color-edge-dark))', '0 3px 8px 3px rgb(0 0 0 / 0.4)'])
  // Related to the seek well but distinct from it: the seek display has no plate and no outer shadow
  const rules = presets.presentationRules([llama()])
  const root = engine.themeSelector('llama')
  assert.equal(rules[`${root} .fullscreen #playerTrack`]['box-shadow'], undefined)
  assert.notDeepEqual(rules[`${root} .fullscreen #playerTrack`], rules[`${root} ${READOUT}`])
})

test('Phase 4E geometry is the only geometry in the recipe besides the 4H glyph size, limited to named selectors and properties', () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const P = presets.PRIMITIVES
  for (const [selector, declarations] of Object.entries(rules)) {
    const suffix = selector.slice(root.length + 1)
    const geometry = Object.keys(declarations).filter((p) => GEOMETRY_PROPERTY.test(p))
    assert.deepEqual(geometry, READOUT_LAYOUT_PROPERTIES[suffix] || [], selector)
  }
  assert.deepEqual(rules[`${root} ${READOUT}`], { ...P.METADATA_READOUT, ...P.METADATA_READOUT_LAYOUT })
  assert.deepEqual(rules[`${root} ${READOUT_ABOVE_TOTAL_TRACK}`], { ...P.METADATA_READOUT_ABOVE_TOTAL_TRACK })
  assert.ok(Object.isFrozen(P.METADATA_READOUT_LAYOUT) && Object.isFrozen(P.METADATA_READOUT_ABOVE_TOTAL_TRACK))
  for (const value of [...Object.values(P.METADATA_READOUT_LAYOUT), ...Object.values(P.METADATA_READOUT_ABOVE_TOTAL_TRACK)]) assert.match(value, /^[a-z0-9 .,%()/+-]+$/i, value)
  // Exact values (no tolerances): the readout spans the seek wells' 24px column, has a 6px/12px inner inset and sits
  // 22px below the original block's anchor, so it grows toward the free band rather than toward the artwork; its floor
  // (200px deck + 4px plate + 6px) never applies in portrait and keeps the landscape readout off the deck
  assert.deepEqual({ ...P.METADATA_READOUT_LAYOUT }, { left: '24px', width: 'calc(100% - 48px)', padding: '6px 12px', bottom: 'max(calc(50% - var(--cover-image-height) / 2 + 28px), 210px)' })
  assert.deepEqual({ ...P.METADATA_READOUT_ABOVE_TOTAL_TRACK }, { bottom: 'max(calc(50% - var(--cover-image-height) / 2 + 28px), 249px)' })
})

test('Phase 4E layout rests on the existing player geometry, which is unchanged', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const style = player.slice(player.indexOf('<style>'))
  // The original block: its fullscreen anchor (+50px; the readout uses +28px, 22px lower), width, collapsed placement,
  // and the landscape override, which keeps priority (!important) over the readout's left/width
  assert.match(style, /\.fullscreen \.title-author-texts \{\s*bottom: calc\(50% - var\(--cover-image-height\) \/ 2 \+ 50px\);\s*width: 80%;\s*left: 10%;/)
  assert.match(style, /\.title-author-texts \{[^}]*width: var\(--title-author-width-collapsed\);\s*bottom: 76px;\s*left: var\(--title-author-left-offset-collapsed\);/)
  assert.match(style, /@media \(orientation: landscape\) \{\s*\.fullscreen \.title-author-texts \{\s*left: 50% !important;\s*width: 50% !important;/)
  // The readout's column matches the seek wells (px-6 = 24px); its clearance covers the total-track display at the
  // default font scale (215px offset + 19.2px line + 4px channel) plus the 4px plate and 6px of chassis
  assert.match(player, /<div id="playerTrack" class="absolute left-0 w-full px-6">/)
  assert.match(player, /class="absolute total-track w-full z-30 px-6"/)
  assert.match(style, /\.total-track \{\s*bottom: 215px;/)
  assert.ok(249 >= 215 + 19.2 + 4 + 4 + 6)
  assert.ok(210 >= 200 + 4 + 6)
  // Title/author markup, marquee wrapper and text classes are unchanged (the readout needs no template change)
  assert.match(player, /<div class="title-author-texts absolute z-30 left-0 right-0 overflow-hidden" @click="clickTitleAndAuthor">\s*<div ref="titlewrapper" class="overflow-hidden relative">\s*<p class="title-text whitespace-nowrap"><\/p>\s*<\/div>\s*<p class="author-text text-fg text-opacity-75 truncate">\{\{ authorName \}\}<\/p>/)
  // Protected sizes: mini 120px, full panel 200px, play 65/40
  assert.match(style, /\.playerContainer \{\s*height: 120px;\s*\}/)
  assert.match(style, /\.fullscreen \.playerContainer \{\s*height: 200px;\s*\}/)
  assert.match(style, /#playerControls \.play-btn \{[^}]*height: 40px;\s*width: 40px;/)
  assert.match(style, /\.fullscreen #playerControls \.play-btn \{\s*height: 65px;\s*width: 65px;/)
})

test('Phase 4E metadata stays neutral: no LLAMA rule colors the title or author, no amber or phosphor on the readout', () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  for (const [selector, declarations] of Object.entries(rules)) {
    if (!/title-author|title-text|author-text|titlewrapper/.test(selector)) continue
    // The full-player readout rules, and (Phase 7B) the collapsed player's title and author type: face and spacing only,
    // never its block, box or color
    const mini = [`${root} #streamContainer:not(.fullscreen) .title-author-texts .title-text`, `${root} #streamContainer:not(.fullscreen) .title-author-texts .author-text`]
    assert.ok([`${root} ${READOUT}`, `${root} ${READOUT_ABOVE_TOTAL_TRACK}`, ...mini].includes(selector), selector)
    if (mini.includes(selector)) assert.deepEqual(Object.keys(declarations).sort(), ['font-family', 'letter-spacing'], selector)
    assert.equal(declarations.color, undefined, selector)
    for (const value of Object.values(declarations)) assert.doesNotMatch(value, /--color-(track-cursor|accent|success|warning)/, selector)
  }
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

test('Phase 4E title and author keep their contrast on the recessed readout', () => {
  const t = llama().tokens
  const face = t['surface.recessed']
  // Title: the inherited default text color; author: text-fg at 75% opacity (both unchanged)
  const author = t['text.primary'].map((c, i) => c * 0.75 + face[i] * 0.25)
  assert.ok(contrast(t['text.default'], face) >= 4.5)
  assert.ok(contrast(author, face) >= 4.5)
  // ...and higher than on the chassis they sat on before
  assert.ok(contrast(t['text.default'], face) > contrast(t['text.default'], t['surface.base']))
})

test('Phase 4E readout compiles through Tailwind under the LLAMA root only', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, selector)
    return css.slice(i, css.indexOf('}', i))
  }
  const root = "html[data-theme='llama']"
  assert.match(block(`${root} ${READOUT}`), /padding: 6px 12px;[\s\S]*bottom: max\(calc\(50% - var\(--cover-image-height\) \/ 2 \+ 28px\), 210px\)/)
  assert.match(block(`${root} ${READOUT_ABOVE_TOTAL_TRACK}`), /bottom: max\(calc\(50% - var\(--cover-image-height\) \/ 2 \+ 28px\), 249px\)/)
  // Every compiled rule for the readout's selectors is under the LLAMA root
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    for (const selector of m[1].split(',')) if (selector.includes('.fullscreen .title-author-texts') || selector.includes('.total-track ~')) assert.ok(selector.trim().startsWith(`${root} `), selector.trim())
  }
})

// --- Phase 4E-R1: short-screen readout with the total-track display ---

const COMPACT_QUERY = '(orientation: portrait) and (max-height: 824px)'
const LANDSCAPE_QUERY = '(orientation: landscape)'

test('Phase 4E-R1 short-screen readout is one LLAMA-only media rule on the total-track readout selector', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  // Exactly the readout's two total-track variants: short portrait (R1) and landscape (R2), in that order
  assert.deepEqual(
    presets.EQUIPMENT_MEDIA_RULES.map(([query, suffix]) => [query, suffix]),
    [
      [COMPACT_QUERY, READOUT_ABOVE_TOTAL_TRACK],
      [LANDSCAPE_QUERY, READOUT_ABOVE_TOTAL_TRACK]
    ]
  )
  const media = presets.presentationMediaRules([llama()])
  assert.deepEqual(Object.keys(media), [`@media ${COMPACT_QUERY}`, `@media ${LANDSCAPE_QUERY}`])
  assert.deepEqual(media[`@media ${COMPACT_QUERY}`], { [`${root} ${READOUT_ABOVE_TOTAL_TRACK}`]: { ...P.METADATA_READOUT_COMPACT } })
  assert.deepEqual(presets.builtinPresentationMediaRules(), media)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationMediaRules([engine.getTheme(id)]), {}, id)
  // A theme that fails validation or uses another finish contributes nothing
  const dark = engine.getTheme('dark').tokens
  assert.deepEqual(presets.presentationMediaRules([engine.validateTheme({ id: 'rig', labelKey: 'LabelRig', colorScheme: 'dark', tokens: { ...dark, 'presentation.finish': 'chrome' } }, dark).theme]), {})
  // The reference 842px-tall screen is outside the query, so the accepted Phase 4E readout is unchanged there
  assert.ok(824 < 842)
})

test('Phase 4E-R1 compact readout keeps the well, column and neutral text; only its vertical extent changes', () => {
  const P = presets.PRIMITIVES
  const C = P.METADATA_READOUT_COMPACT
  assert.ok(Object.isFrozen(C))
  assert.deepEqual(Object.keys(C).sort(), ['bottom', 'box-shadow', 'display', 'flex-direction', 'justify-content', 'min-height', 'padding'])
  for (const value of Object.values(C)) assert.match(value, /^[a-z0-9 .,%()/+-]+$/i, value)
  // Same recessed well; a 1px seam all round and the plate and its lips as side rails only (no vertical offset or spread)
  assert.ok(C['box-shadow'].startsWith(`${P.RECESSED_WELL}, `))
  const outer = C['box-shadow'].slice(P.RECESSED_WELL.length + 2).split(/, (?=-?\d)/)
  assert.deepEqual(outer, ['0 0 0 1px rgb(var(--color-edge-dark))', '-4px 0 0 0 rgb(var(--color-bg))', '4px 0 0 0 rgb(var(--color-bg))', '-5px 0 0 0 rgb(var(--color-edge-light) / 0.35)', '5px 0 0 0 rgb(var(--color-edge-dark))', '0 2px 4px rgb(0 0 0 / 0.4)'])
  for (const value of Object.values(C)) assert.doesNotMatch(value, /--color-(track-cursor|accent|success|warning)/)
  assert.equal(C.color, undefined)
  // Horizontal inset, face, radius and column are inherited from the Phase 4E rule (not overridden here)
  assert.equal(C.padding, '0 12px')
  for (const p of ['left', 'width', 'background-color', 'border-radius']) assert.equal(C[p], undefined, p)
  // Text centered in a fixed band instead of a vertical inset; text larger than the band grows the box (min-height, never height)
  assert.deepEqual([C.display, C['flex-direction'], C['justify-content']], ['flex', 'column', 'center'])
  assert.equal(C.height, undefined)
  assert.equal(C['max-height'], undefined)
  // Exact geometry: 2px of chassis plus the 1px seam above the total-track display at font scale 1.3 (215px + 25px line + 4px channel)
  assert.equal(C.bottom, '247px')
  assert.equal(247, 215 + 25 + 4 + 2 + 1)
  // Band below the height-limited artwork (its bottom 320px up = 50% + 120px - coverH / 2): its 2px frame, 3px of chassis,
  // the 1px seam and the 247px bottom; capped at 70px where the artwork is not yet height-limited
  assert.equal(C['min-height'], 'min(calc(50% - var(--cover-image-height) / 2 - 133px), 70px)')
  assert.equal(120 - 2 - 3 - 1 - 247, -133)
})

test('Phase 4E-R1 compact readout compiles through Tailwind inside its media query, under the LLAMA root only', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const at = css.indexOf(`@media ${COMPACT_QUERY} {`)
  assert.ok(at >= 0)
  assert.equal(css.indexOf(`@media ${COMPACT_QUERY} {`, at + 1), -1)
  const block = css.slice(at, css.indexOf('}\n}', at) + 3)
  assert.match(block, /html\[data-theme='llama'\] \.fullscreen \.total-track ~ \.title-author-texts \{[\s\S]*bottom: 247px;[\s\S]*min-height: min\(calc\(50% - var\(--cover-image-height\) \/ 2 - 133px\), 70px\);/)
  assert.equal((block.match(/\{/g) || []).length, 2)
  // The unconditional Phase 4E rules are still emitted as before
  assert.match(css, /html\[data-theme='llama'\] \.fullscreen \.total-track ~ \.title-author-texts \{\s*bottom: max\(calc\(50% - var\(--cover-image-height\) \/ 2 \+ 28px\), 249px\);\s*\}/)
})

// --- Phase 4E-R2: landscape readout with the total-track display ---

test('Phase 4E-R2 landscape readout only ends before the top-bar controls: LLAMA-only, total-track readout only, two properties', async () => {
  const P = presets.PRIMITIVES
  const L = P.METADATA_READOUT_LANDSCAPE
  const root = engine.themeSelector('llama')
  assert.ok(Object.isFrozen(L))
  // Horizontal only: no vertical placement, padding, paint or text color; the readout keeps the Phase 4E look and floor
  assert.deepEqual({ ...L }, { 'margin-left': '24px', 'max-width': 'calc(50% - 135px)' })
  const media = presets.presentationMediaRules([llama()])
  assert.deepEqual(media[`@media ${LANDSCAPE_QUERY}`], { [`${root} ${READOUT_ABOVE_TOTAL_TRACK}`]: { ...L } })
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationMediaRules([engine.getTheme(id)]), {}, id)
  // Landscape only: the portrait R1 query and every portrait rule are untouched by it
  assert.doesNotMatch(LANDSCAPE_QUERY, /portrait|height/)
  assert.deepEqual(media[`@media ${COMPACT_QUERY}`], { [`${root} ${READOUT_ABOVE_TOTAL_TRACK}`]: { ...P.METADATA_READOUT_COMPACT } })
  // The arithmetic: the cast control's 64px right offset (right-16) plus its 39px width at font scale 1.3, the 4px plate
  // and 4px of chassis (111px), and the 24px left margin that aligns the readout with the seek well (px-6)
  assert.equal(24 + 64 + 39 + 4 + 4, 135)
  const player = await read('../components/app/AudioPlayer.vue')
  assert.match(player, /<div v-show="showCastBtn" class="top-6 right-16 absolute cursor-pointer">\s*<span class="chrome-key cast-key material-symbols text-3xl"/)
  assert.match(player, /<div class="top-6 right-4 absolute cursor-pointer">\s*<span class="chrome-key menu-key material-symbols text-3xl"/)
  // Finishing pass: the cast key is a fixed 44px key in the same 64px slot, so the readout (111px from the right edge, plate
  // 4px) still ends before it: the cast face starts 108px from the right edge
  assert.equal(presets.PRIMITIVES.DECK.chrome.width, 44)
  assert.ok(64 + presets.PRIMITIVES.DECK.chrome.width >= 111 - 4)
  // The player's landscape rule it limits (max-width still applies under an !important width) is unchanged
  const style = player.slice(player.indexOf('<style>'))
  assert.match(style, /@media \(orientation: landscape\) \{\s*\.fullscreen \.title-author-texts \{\s*left: 50% !important;\s*width: 50% !important;/)
})

test('Phase 4E-R2 landscape rule compiles through Tailwind inside its media query, under the LLAMA root only', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  // Find the media block that holds the readout rule (the player's own landscape rules live in component CSS, not here)
  const blocks = [...css.matchAll(/@media \(orientation: landscape\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).filter((b) => b.includes('title-author-texts'))
  assert.equal(blocks.length, 1)
  assert.match(blocks[0], /^\s*html\[data-theme='llama'\] \.fullscreen \.total-track ~ \.title-author-texts \{\s*margin-left: 24px;\s*max-width: calc\(50% - 135px\);\s*\}\s*$/)
})

// --- Phase 4H: primary Play/Pause control ---

test('Phase 4H: a pending seek spins only the play glyph; the play button face never rotates (every theme)', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  const button = template.match(/<div class="play-btn [^>]*>/)[0]
  assert.doesNotMatch(button, /animate-spin/)
  // Same click, hit target and handlers as before: only the animation moved
  assert.match(button, /@mousedown\.prevent @mouseup\.prevent @click\.stop="playPauseClick"/)
  const glyph = template.match(/<span v-if="!showLoadingState" class="material-symbols fill"[^>]*>[^<]*<\/span>/)[0]
  assert.match(glyph, /:class="\{[^}]*'animate-spin': seekLoading[^}]*\}"/)
  assert.match(glyph, />\{\{ seekLoading \? 'autorenew' : !isPlaying \? 'play_arrow' : 'pause' \}\}</)
  assert.equal((template.match(/'animate-spin': seekLoading/g) || []).length, 1)
})

const PRIMARY_RULES = {
  rest: '#playerControls .play-btn',
  pressed: '#playerControls .play-btn:active',
  restMini: '#streamContainer:not(.fullscreen) #playerControls .play-btn',
  pressedMini: '#streamContainer:not(.fullscreen) #playerControls .play-btn:active'
}

test('Phase 4H primary key: squared on RADIUS.key, dark face, primary bezel; frozen paint only', () => {
  const P = presets.PRIMITIVES
  for (const set of [P.PRIMARY_KEY, P.PRIMARY_KEY_MINI, P.PRIMARY_KEY_PRESSED, P.PRIMARY_KEY_PRESSED_MINI]) {
    assert.ok(Object.isFrozen(set))
    for (const [property, value] of Object.entries(set)) {
      assert.match(property, PAINT_ONLY, property)
      assert.doesNotMatch(property, GEOMETRY_PROPERTY, property)
      assert.match(value, SAFE_VALUE, `${property}: ${value}`)
    }
  }
  // Squared on the existing key radius (no new radius); no round radius is left in the recipe
  assert.equal(P.PRIMARY_KEY['border-radius'], P.RADIUS.key)
  assert.ok(!Object.values(P.RADIUS).includes('9999px'))
  // Dark face: the recessed token at 0.72 (0.85 collapsed) over the player's own fill, under the player-key sheen
  // (background-image only, because the player sets the fill inline)
  const sheen = P.PLAYER_KEY['background-image']
  assert.equal(P.PRIMARY_KEY['background-image'], `${sheen}, linear-gradient(rgb(var(--color-recessed) / 0.72), rgb(var(--color-recessed) / 0.72))`)
  assert.deepEqual({ ...P.PRIMARY_KEY_MINI }, { 'background-image': `${sheen}, linear-gradient(rgb(var(--color-recessed) / 0.85), rgb(var(--color-recessed) / 0.85))` })
  assert.ok(!('background-color' in P.PRIMARY_KEY), 'the inline fill stays the base')
  // Primary bezel, in order: lit inner edge, faint second highlight, dark inner edge, 1px dark channel, lit return ring, deeper drop
  assert.deepEqual(P.PRIMARY_KEY['box-shadow'].split(/, (?=inset|0)/), ['inset 1px 1px 0 rgb(var(--color-edge-light) / 0.6)', 'inset 2px 2px 0 rgb(var(--color-edge-light) / 0.12)', 'inset -1px -1px 0 rgb(var(--color-edge-dark))', '0 0 0 1px rgb(var(--color-edge-dark))', '0 0 0 2px rgb(var(--color-edge-light) / 0.3)', '0 3px 5px rgb(0 0 0 / 0.55)'])
  // Stronger than a secondary player key: the same inner bevel and channel, plus a return ring and a deeper drop
  assert.ok(P.PRIMARY_KEY['box-shadow'].startsWith(P.PLAYER_KEY['box-shadow'].replace(/, 0 2px 3px rgb\(0 0 0 \/ 0\.5\)$/, '')))
  assert.match(P.PLAYER_KEY['box-shadow'], /0 2px 3px rgb\(0 0 0 \/ 0\.5\)$/)
  // No decoration: no texture, gloss, glass or radial highlight
  assert.doesNotMatch(P.PRIMARY_KEY['background-image'], /radial|url|repeating/)
})

test('Phase 4H pressed: mechanically depressed in place (no movement), bezel ring retained', () => {
  const P = presets.PRIMITIVES
  const pressed = P.PRIMARY_KEY_PRESSED
  assert.deepEqual(Object.keys(pressed).sort(), ['background-image', 'box-shadow'])
  // Sheen removed, face deepened (0.86; 0.94 collapsed)
  assert.equal(pressed['background-image'], 'linear-gradient(rgb(var(--color-recessed) / 0.86), rgb(var(--color-recessed) / 0.86))')
  assert.deepEqual({ ...P.PRIMARY_KEY_PRESSED_MINI }, { 'background-image': 'linear-gradient(rgb(var(--color-recessed) / 0.94), rgb(var(--color-recessed) / 0.94))' })
  // Inverted bevel, inner shade, channel and return ring kept, no drop shadow
  assert.deepEqual(pressed['box-shadow'].split(/, (?=inset|0)/), ['inset 1px 1px 0 rgb(var(--color-edge-dark))', 'inset -1px -1px 0 rgb(var(--color-edge-light) / 0.3)', 'inset 0 3px 6px rgb(0 0 0 / 0.6)', '0 0 0 1px rgb(var(--color-edge-dark))', '0 0 0 2px rgb(var(--color-edge-light) / 0.3)'])
  assert.doesNotMatch(pressed['box-shadow'], /(^|, )0 3px 5px/)
  // Nothing in any primary state moves or resizes the key
  const rules = presets.presentationRules([llama()])
  const root = engine.themeSelector('llama')
  for (const s of Object.values(PRIMARY_RULES)) for (const p of Object.keys(rules[`${root} ${s}`])) assert.doesNotMatch(p, /transform|translate|scale|top|left|margin|width|height/, `${s}: ${p}`)
})

test('Phase 4H rules: LLAMA-only primary key, amber Play/Pause, seek-pending and spinner, large glyph sizes', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const rule = (s) => rules[`${root} ${s}`]
  assert.deepEqual(rule(PRIMARY_RULES.rest), { ...P.PRIMARY_KEY })
  assert.deepEqual(rule(PRIMARY_RULES.pressed), { ...P.PRIMARY_KEY_PRESSED })
  assert.deepEqual(rule(PRIMARY_RULES.restMini), { ...P.PRIMARY_KEY_MINI })
  assert.deepEqual(rule(PRIMARY_RULES.pressedMini), { ...P.PRIMARY_KEY_PRESSED_MINI })
  // One playback legend color for every glyph the key shows (play_arrow, pause, autorenew) and for its loading spinner
  for (const s of PRIMARY_LEGEND_SELECTORS) assert.deepEqual(rule(s), { color: 'rgb(var(--color-track-cursor))' }, s)
  assert.ok(!Object.entries(rules).some(([s, d]) => /play-btn/.test(s) && Object.values(d).some((v) => /--color-accent|--color-success/.test(v))), 'never green')
  // Option E: large solid glyph, 2.8rem full (44.8px) and 1.875rem collapsed (30px); the boxes stay 65px / 40px
  assert.deepEqual(rule(PRIMARY_GLYPH_FULL), { 'font-size': '2.8rem' })
  assert.deepEqual(rule(PRIMARY_GLYPH_MINI), { 'font-size': '1.875rem' })
  assert.ok(2.8 * 16 < 65 && 1.875 * 16 < 40)
  // Every play-btn selector stays under the LLAMA root, with no comma list
  const own = Object.keys(rules).filter((s) => s.includes('play-btn') && !s.includes('row-play-btn'))
  // 8 Phase 4H rules plus the finishing pass's placement of the primary in the transport bank (margin and lift only)
  assert.equal(own.length, 9)
  assert.deepEqual(rules[`${root} .fullscreen #playerControls .play-btn`], { ...presets.PRIMITIVES.PRIMARY_IN_BANK })
  for (const s of own) assert.ok(s.startsWith(`${root} `) && !s.slice(root.length).includes(','), s)
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

test('Phase 4H contrast: the amber legend keeps at least 7:1 wherever the glyph can sit, in every face state', () => {
  const t = llama().tokens
  const edge = presets.equipmentDerivedDeclarations(t)['--color-edge-light'].split(' ').map(Number)
  const over = (base, top, a) => base.map((c, i) => c + (top[i] - c) * a)
  const amber = t['progress.played']
  const base = t['surface.raised'] // the player's inline fill under the face
  // The player-key sheen falls from edge-light 0.2 at the top to 0 at 45%. The brightest face point any glyph ink can
  // reach is the top of the glyph's own (centered, square) box: 10.1px down a 65px key, 5px down a 40px key
  assert.match(presets.PRIMITIVES.PLAYER_KEY['background-image'], /^linear-gradient\(180deg, rgb\(var\(--color-edge-light\) \/ 0\.2\) 0%, rgb\(var\(--color-edge-light\) \/ 0\) 45%/)
  const sheenAt = (box, glyph) => 0.2 * (1 - (box - glyph) / 2 / box / 0.45)
  for (const [label, face, sheen] of [
    ['full rest', 0.72, sheenAt(65, 44.8)],
    ['mini rest', 0.85, sheenAt(40, 30)],
    ['full pressed', 0.86, 0],
    ['mini pressed', 0.94, 0]
  ]) {
    const brightest = over(over(base, t['surface.recessed'], face), edge, sheen)
    const ratio = contrast(amber, brightest)
    assert.ok(ratio >= 7, `${label}: ${ratio.toFixed(2)}`)
  }
})

test('Phase 4H CSS: the LLAMA glyph size and amber outrank the player rules; standard sizes and boxes unchanged', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, selector)
    return css.slice(i, css.indexOf('}', i))
  }
  const root = "html[data-theme='llama']"
  assert.match(block(`${root} #playerControls .play-btn`), /border-radius: 4px;[\s\S]*background-image: linear-gradient/)
  assert.match(block(`${root} ${PRIMARY_GLYPH_FULL}`), /font-size: 2\.8rem/)
  assert.match(block(`${root} ${PRIMARY_GLYPH_MINI}`), /font-size: 1\.875rem/)
  assert.match(block(`${root} #playerControls .play-btn .la-ball-spin-clockwise`), /color: rgb\(var\(--color-track-cursor\)\)/)
  assert.ok(!/(^|\n|\})\s*#playerControls \.play-btn \.la-ball-spin-clockwise/.test(css), 'no unscoped spinner rule')
  // The player's own (standard) rules: glyph 2.1rem full / 1.5rem collapsed, boxes 65px / 40px, round face. The LLAMA
  // selectors carry the theme root and one more class or id than these, so they win without !important
  const player = await read('../components/app/AudioPlayer.vue')
  const style = player.slice(player.indexOf('<style>'))
  assert.match(style, /\n#playerControls \.play-btn \.material-symbols \{[^}]*font-size: 1\.5rem;/)
  assert.match(style, /\.fullscreen #playerControls \.play-btn \.material-symbols \{\s*font-size: 2\.1rem;/)
  assert.match(style, /#playerControls \.play-btn \{[^}]*height: 40px;\s*width: 40px;/)
  assert.match(style, /\.fullscreen #playerControls \.play-btn \{\s*height: 65px;\s*width: 65px;/)
  assert.match(player, /<div class="play-btn cursor-pointer shadow-sm flex items-center justify-center rounded-full text-primary mx-4 relative overflow-hidden" :style="\{ backgroundColor: coverChrome\.control \}"/)
  // The spinner the rule targets is the player's loading spinner component
  assert.match(player, /<widgets-spinner-icon v-else class="h-8 w-8" \/>/)
  assert.match(await read('../components/widgets/SpinnerIcon.vue'), /<div class="la-ball-spin-clockwise la-dark la-sm">/)
})

// --- Control deck: Phase 4J key faces, recomposed in the Phase 4 finishing pass ---

const TIERS = {
  transport: { host: '.fullscreen #playerControls .player-key', size: [60, 60], paint: 'TRANSPORT_KEY' },
  utility: { host: '#playerContent .utility-key', size: [54, 52], paint: 'UTILITY_KEY' },
  mini: { host: '#streamContainer:not(.fullscreen) #playerControls .player-key', size: [34, 34], paint: 'TRANSPORT_KEY_MINI' },
  chrome: { host: '#streamContainer.fullscreen .chrome-key', size: [44, 44], paint: 'UTILITY_KEY' }
}

test('Control deck: every key is its own fixed px box (60x60, 54x52, 34x34, 44x44), never content- or font-sized', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  for (const [tier, { host, size, paint }] of Object.entries(TIERS)) {
    const rule = rules[`${root} ${host}`]
    assert.ok(rule, tier)
    assert.equal(rule.width, `${size[0]}px`, tier)
    assert.equal(rule.height, `${size[1]}px`, tier)
    assert.equal(rule.flex, 'none', `${tier}: a flex row never stretches or shrinks the key`)
    assert.equal(rule['border-radius'], P.RADIUS.key, tier)
    for (const p of ['min-width', 'min-height', 'max-width', 'max-height', 'padding']) assert.equal(rule[p], undefined, `${tier} ${p}`)
    // The face is painted on the key itself
    for (const [property, value] of Object.entries(P[paint])) assert.equal(rule[property], value, `${tier} ${property}`)
  }
  assert.deepEqual({ ...P.DECK.transport }, { width: 60, height: 60, gap: 8 })
  // Hierarchy by size: primary 65 > transport 60 > utility 54x52; the collapsed keys stay inside the 40px primary height
  assert.ok(65 > P.DECK.transport.height && P.DECK.transport.height > P.DECK.utility.height && P.DECK.mini.height < 40)
})

test('Control deck: the full bank fits 412px with one gap, the primary lifted a few px and not resized', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const { width, gap } = P.DECK.transport
  assert.deepEqual(rules[`${root} .fullscreen #playerControls > div`], { 'justify-content': 'center', gap: `${gap}px` })
  assert.deepEqual(rules[`${root} .fullscreen #playerControls .play-btn`], { margin: '0', top: `-${P.DECK.primaryLift}px` })
  assert.ok(P.DECK.primaryLift > 0 && P.DECK.primaryLift <= 5)
  // Five keys and four gaps inside the 412px reference width minus the deck's 24px side padding
  assert.ok(4 * width + 65 + 4 * gap <= 412 - 48, 'bank fits')
  // The primary keeps its Phase 4H box (the player's own 65px / 40px rules)
  for (const s of Object.keys(rules)) if (s.includes('play-btn')) for (const p of ['width', 'height', 'min-width', 'min-height', 'transform']) assert.equal(rules[s][p], undefined, `${s}: ${p}`)
})

test('Control deck: the seam drops inside an unchanged deck, clear of the bank, over a centered utility row', async () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const { base, drop } = P.DECK.seam
  // The player's own placement of the transport row (its bottom edge is the seam), which the drop is measured from
  const player = (await readFile(new URL('../components/app/AudioPlayer.vue', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  assert.ok(player.includes(`.fullscreen #playerControls {\n  width: 100%;\n  padding-left: 24px;\n  padding-right: 24px;\n  bottom: ${base}px;`))
  // The row grows down by exactly what its offset loses: the bank stays put and the deck keeps its height
  assert.deepEqual(rules[`${root} #streamContainer.fullscreen #playerControls`], { bottom: `${base - drop}px`, 'padding-bottom': `${drop}px` })
  assert.ok(drop >= 3 && drop <= 7, 'a small drop')
  // The clearance under the keys covers their drop shadows: transport 0 2px 4px centered in the 65px row, primary 0 3px 5px, lifted
  const transportClear = (65 - P.DECK.transport.height) / 2 + drop
  const primaryClear = P.DECK.primaryLift + drop
  assert.ok(P.TRANSPORT_KEY['box-shadow'].endsWith('0 2px 4px rgb(0 0 0 / 0.5)') && transportClear >= 2 + 4, `transport ${transportClear}`)
  assert.ok(primaryClear >= 3 + 5, `primary ${primaryClear}`)
  // The utility row: no padding, its keys centered in the section under the seam (an odd px above), comfortable both ways
  const depth = base - drop
  const below = Math.floor((depth - P.DECK.utility.height) / 2)
  assert.deepEqual(rules[`${root} .fullscreen #playerContent .utility-row`], { bottom: `${below}px`, 'padding-top': '0px', 'padding-bottom': '0px' })
  const above = depth - P.DECK.utility.height - below
  assert.ok(above - below <= 1 && below >= 8, `utility margins ${above}/${below}`)
  // Utility hardware stays subordinate to the transport bank, and five keys keep comfortable gaps across 364px
  assert.ok(P.DECK.utility.height <= P.DECK.transport.height - 6 && P.DECK.utility.width < P.DECK.transport.width)
  assert.ok((412 - 48 - 5 * P.DECK.utility.width) / 4 >= 16, 'utility gaps')
})

test('Control deck: the hit target is the visible key itself (no pseudo-element hit area, no stacking tricks)', () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  for (const [selector, d] of Object.entries(rules)) {
    if (!/#playerContent|#playerControls|#streamContainer/.test(selector)) continue
    assert.ok(!selector.includes('::before') && !selector.includes('::after'), `${selector}: no pseudo-element faces`)
    for (const p of ['z-index', 'isolation', 'pointer-events', 'content']) assert.equal(d[p], undefined, `${selector}: ${p}`)
  }
  // A key is a flex box that centers its legend: the glyph never sizes it
  for (const { host } of Object.values(TIERS)) assert.equal(rules[`${root} ${host}`].display, 'flex', host)
})

test('Control deck hooks: semantic classes on the keys, readouts, utility row and top chrome; no theme branch in the player', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  for (const hook of ['queue-key', 'bookmark-key', 'sleep-key', 'chapters-key', 'speed-readout', 'sleep-readout', 'sleep-display', 'utility-row', 'collapse-key', 'cast-key', 'menu-key', 'playback-method']) {
    assert.equal((template.match(new RegExp(`\\b${hook}\\b`, 'g')) || []).length, 1, hook)
  }
  assert.equal((template.match(/\butility-key\b/g) || []).length, 4)
  assert.equal((template.match(/\bchrome-key\b/g) || []).length, 3)
  // The sleep wrapper is a flex span carrying the key hooks and the original click
  const sleep = template.match(/<span v-if="!sleepTimerRunning" class="([^"]*)" @click\.stop="\$emit\('showSleepTimer'\)">\s*<svg [^>]*class="h-7 w-7 text-fg-muted"[^>]*>/)
  assert.ok(sleep)
  assert.deepEqual(sleep[1].split(' ').sort(), ['cursor-pointer', 'flex', 'player-key', 'sleep-key', 'utility-key'])
  assert.doesNotMatch(template, /<svg[^>]*@click/)
  // The top chrome keep their own clicks on the same elements
  assert.match(template, /class="chrome-key collapse-key [^"]*"[^>]*@click="collapseFullscreen"/)
  assert.match(template, /class="chrome-key cast-key [^"]*"[^>]*@click="castClick"/)
  assert.match(template, /class="chrome-key menu-key [^"]*"[^>]*@click="showMoreMenuDialog = true"/)
  // Presentation lives in the theme recipe only (the one $theme read feeds the token-driven cover-color and layout
  // projections, theme/coverPresentation.js and theme/playerLayout.js)
  assert.doesNotMatch(player, /llama|data-theme|themeId|theme\.id\b/i)
  assert.equal((player.match(/\$theme\b/g) || []).length, 1)
})

test('Control deck states: pressed cuts the key in, an unavailable key is a dimmed socket, on every tier', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const layers = (v) => v.split(/, (?=inset|0)/)
  // Transport: the primary's inner bevel and channel, a weaker lit return (0.18 vs 0.3) and a shorter drop
  const transport = layers(P.TRANSPORT_KEY['box-shadow'])
  const primary = layers(P.PRIMARY_KEY['box-shadow'])
  assert.deepEqual(transport.slice(0, 4), primary.slice(0, 4))
  assert.equal(transport[4], '0 0 0 2px rgb(var(--color-edge-light) / 0.18)')
  assert.equal(primary[4], '0 0 0 2px rgb(var(--color-edge-light) / 0.3)')
  // Utility: restrained bezel, no lit return
  assert.doesNotMatch(P.UTILITY_KEY['box-shadow'], /0 0 0 2px/)
  for (const [host, pressed] of [
    [TIERS.transport.host, P.TRANSPORT_KEY_PRESSED],
    [TIERS.mini.host, P.TRANSPORT_KEY_PRESSED_MINI],
    [TIERS.utility.host, P.UTILITY_KEY_PRESSED]
  ]) {
    assert.deepEqual(rules[`${root} ${host}:not(.key-disabled):active`], { ...pressed }, host)
    assert.equal(pressed['background-image'], 'none')
    assert.match(pressed['box-shadow'], /^inset 1px 1px 0 rgb\(var\(--color-edge-dark\)\)/)
    for (const p of Object.keys(pressed)) assert.doesNotMatch(p, /transform|top|left|width|height|margin/, p)
    // Unavailable: socket face and dimmed legend in one rule; never pressed
    assert.deepEqual(rules[`${root} ${host}.key-disabled`], { ...P.KEY_SOCKET, ...P.KEY_SOCKET_LEGEND }, host)
  }
  assert.deepEqual(rules[`${root} ${TIERS.chrome.host}:active`], { ...P.UTILITY_KEY_PRESSED })
  assert.deepEqual({ ...P.KEY_SOCKET_LEGEND }, { color: 'rgb(var(--color-fg) / 0.22)' })
  assert.doesNotMatch(P.KEY_SOCKET['box-shadow'], /edge-light\) \/ 0\.6|0 0 0 2px|(^|, )0 2px [34]px/)
})

test('Control deck legends: amber transport and utility keys, dynamic durations, sizes safe in the fixed keys; neutral chrome', async () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  assert.deepEqual(rules[`${root} #playerContent .jump-icon:not(.key-disabled)`], { ...P.PLAYBACK_LEGEND })
  assert.deepEqual({ ...P.JUMP_GLYPH }, { 'font-size': '2rem', transform: 'translateY(2px)' })
  assert.deepEqual({ ...P.JUMP_DURATION }, { 'font-weight': '700' })
  assert.deepEqual({ ...P.CHAPTER_GLYPH }, { 'font-size': '2.25rem' })
  assert.deepEqual({ ...P.MINI_JUMP_GLYPH }, { transform: 'translateY(1px) scale(0.78)' })
  // Physical deck keys share one illuminated amber legend (the transport keys' token); readouts are green (below). The
  // utility glyphs keep the regular weight, so the transport legends stay the heavier tier
  assert.deepEqual({ ...P.UTILITY_LEGEND }, { ...P.PLAYBACK_LEGEND })
  for (const s of UTILITY_LEGEND_SELECTORS) {
    assert.deepEqual(rules[`${root} ${s}`], { ...P.UTILITY_LEGEND }, s)
    assert.equal(rules[`${root} ${s}`]['-webkit-text-stroke'], undefined, s)
  }
  // An unavailable utility key (chapters with none) is a socket with the dimmed legend, never amber
  assert.deepEqual(rules[`${root} #playerContent .utility-key.key-disabled`], { ...P.KEY_SOCKET, ...P.KEY_SOCKET_LEGEND })
  // The queue badge keeps its own neutral marking (its markup color), painted by no legend rule
  assert.equal(rules[`${root} #playerContent .queue-key > span.absolute`].color, undefined)
  // The top chrome (navigation and menus) keeps the neutral legend
  assert.deepEqual({ ...P.CHROME_LEGEND }, { color: 'rgb(var(--color-fg) / 0.8)' })
  assert.equal(rules[`${root} #streamContainer.fullscreen .chrome-key`].color, P.CHROME_LEGEND.color)
  // Neither keys nor chrome ever take the readouts' green or the accent
  for (const [s, d] of Object.entries(rules)) if (/utility-key|queue-key|sleep-key|chapters-key|chrome-key/.test(s)) assert.doesNotMatch(JSON.stringify(d), /--color-accent|--color-success/, s)
  for (const [s, d] of Object.entries(rules)) if (/chrome-key/.test(s)) assert.doesNotMatch(JSON.stringify(d), /track-cursor/, s)
  // Durations stay dynamic (the jump settings), never a fixed "10s"
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  assert.match(template, /class="jump-label [^"]*">\{\{ jumpBackwardsLabel \}\}</)
  assert.match(template, /class="jump-label [^"]*">\{\{ jumpForwardLabel \}\}</)
  assert.doesNotMatch(template, />\s*10s\s*</)
  // The queue badge sits inside its key's corner
  assert.deepEqual({ ...P.QUEUE_BADGE }, { bottom: '3px', right: '3px', 'box-shadow': '0 0 0 1px rgb(var(--color-edge-dark))' })
})

test('Control deck readouts: speed, the running sleep timer and the playback method are recessed green displays', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  for (const s of ['.fullscreen #playerContent .speed-readout', '.fullscreen #playerContent .sleep-display']) assert.deepEqual(rules[`${root} ${s}`], { ...P.READOUT_BOX }, s)
  for (const d of [P.READOUT_BOX, P.PLAYBACK_METHOD_READOUT]) {
    assert.equal(d['background-color'], 'rgb(var(--color-recessed))')
    assert.ok(d['box-shadow'].startsWith(P.RECESSED_WELL))
    assert.equal(d['background-image'], undefined, 'no raised sheen')
    assert.doesNotMatch(d['box-shadow'], /edge-light\) \/ 0\.6|0 0 0 2px|track-cursor/)
  }
  // Readouts are the utility keys' height and at least their width; their width follows the value
  assert.equal(P.READOUT_BOX.height, `${P.DECK.utility.height}px`)
  assert.equal(P.READOUT_BOX['min-width'], `${P.DECK.utility.width}px`)
  assert.equal(P.READOUT_BOX.width, 'auto')
  assert.deepEqual(rules[`${root} #playerContent .speed-readout`], { color: 'rgb(var(--color-accent))' })
  assert.deepEqual(rules[`${root} #playerContent .sleep-readout`], { color: 'rgb(var(--color-accent))' })
  assert.equal(P.PLAYBACK_METHOD_READOUT.color, 'rgb(var(--color-accent))')
  assert.ok(!Object.keys(rules).some((s) => /speed-readout|sleep-display|playback-method/.test(s) && /player-key|utility-key|chrome-key/.test(s)))
})

test('Control deck contrast: amber transport and utility legends and readouts >= 7:1, chrome legends >= 4.5:1, socket legend dimmed', () => {
  const P = presets.PRIMITIVES
  const t = llama().tokens
  const edge = presets.equipmentDerivedDeclarations(t)['--color-edge-light'].split(' ').map(Number)
  const over = (base, top, a) => base.map((c, i) => c + (top[i] - c) * a)
  const alphaOf = (v) => Number(v.match(/\/ (0\.\d+)\)/)[1])
  const faceOn = (deck, fill, sheen = 0.2) => over(over(deck, t['surface.recessed'], alphaOf(fill)), edge, sheen)
  for (const [label, face] of [
    ['transport', faceOn(t['surface.content'], P.TRANSPORT_KEY['background-color'])],
    ['transport pressed', faceOn(t['surface.content'], P.TRANSPORT_KEY_PRESSED['background-color'], 0)],
    ['mini', faceOn(t['surface.base'], P.TRANSPORT_KEY_MINI['background-color'])],
    ['mini pressed', faceOn(t['surface.base'], P.TRANSPORT_KEY_PRESSED_MINI['background-color'], 0)]
  ]) {
    assert.ok(contrast(t['progress.played'], face) >= 7, `${label}: ${contrast(t['progress.played'], face).toFixed(2)}`)
  }
  for (const deck of [t['surface.content'], t['surface.base']]) {
    const face = faceOn(deck, P.UTILITY_KEY['background-color'])
    // The amber legend sits mid-key, where the face's sheen has faded (0.2 at the top edge, 0 at 45%): >= 7:1 there, and
    // >= 4.5:1 even against the full sheen at the top edge (the utility face is a touch lighter than the transport face)
    assert.ok(contrast(t['progress.played'], faceOn(deck, P.UTILITY_KEY['background-color'], 0.1)) >= 7, 'utility amber at the legend')
    assert.ok(contrast(t['progress.played'], face) >= 4.5, `utility amber at the top edge ${contrast(t['progress.played'], face).toFixed(2)}`)
    assert.ok(contrast(t['progress.played'], faceOn(deck, P.UTILITY_KEY_PRESSED['background-color'], 0)) >= 7, 'utility amber pressed')
    assert.ok(contrast(over(face, t['text.primary'], 0.8), face) >= 4.5, 'chrome legend')
  }
  assert.ok(contrast(t['accent.primary'], t['surface.recessed']) >= 7, 'readout green')
  const socket = faceOn(t['surface.content'], P.KEY_SOCKET['background-color'], 0)
  assert.ok(contrast(over(socket, t['text.primary'], alphaOf(P.KEY_SOCKET_LEGEND.color)), socket) < 3, 'unavailable legend clearly dimmer')
})

test('Control deck is LLAMA-only in compiled CSS, and Dark, Black and Light get nothing', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const root = "html[data-theme='llama']"
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    for (const selector of m[1].split(',')) {
      if (/utility-key|utility-row|queue-key|bookmark-key|sleep-key|sleep-display|chapters-key|player-key|chrome-key|playback-method|#playerContent \.speed-readout/.test(selector)) assert.ok(selector.trim().startsWith(`${root} `), selector.trim())
    }
  }
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, selector)
    return css.slice(i, css.indexOf('}', i))
  }
  assert.match(block(`${root} .fullscreen #playerControls .player-key`), /width: 60px;\s*height: 60px;/)
  assert.match(block(`${root} #playerContent .utility-key`), /width: 54px;\s*height: 52px;/)
  assert.match(block(`${root} #streamContainer:not(.fullscreen) #playerControls .player-key`), /width: 34px;\s*height: 34px;/)
  assert.ok(!/html\[data-theme='llama'\][^{]*::(before|after)/.test(css), 'no LLAMA pseudo-element faces')
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})

test('Control deck leaves the Phase 4H primary key frozen', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  assert.deepEqual(rules[`${root} #playerControls .play-btn`], { ...P.PRIMARY_KEY })
  assert.deepEqual(rules[`${root} #playerControls .play-btn:active`], { ...P.PRIMARY_KEY_PRESSED })
  assert.deepEqual(rules[`${root} .fullscreen #playerControls .play-btn .material-symbols`], { 'font-size': '2.8rem' })
  assert.deepEqual(rules[`${root} #streamContainer:not(.fullscreen) #playerControls .play-btn .material-symbols`], { 'font-size': '1.875rem' })
})

// --- Phase 7B: LLAMA mini-player Candidate B (condensed type, recessed readout strip, artwork mount; no geometry) ---

const MINI = '#streamContainer:not(.fullscreen)'
const MINI_7B = {
  [`${MINI} .title-author-texts .title-text`]: 'MINI_TITLE_TYPE',
  [`${MINI} .title-author-texts .author-text`]: 'MINI_AUTHOR_TYPE',
  [`${MINI} #playerTrack p.font-mono`]: 'MINI_TIME_TYPE',
  [`${MINI} #playerTrack`]: 'MINI_READOUT_STRIP',
  [`${MINI} .cover-wrapper`]: 'MINI_ARTWORK_MOUNT'
}

test('Phase 7B mini rules are exactly the frozen Candidate B primitives, collapsed player only', () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  for (const [suffix, name] of Object.entries(MINI_7B)) {
    assert.ok(Object.isFrozen(P[name]), name)
    assert.deepEqual(rules[`${root} ${suffix}`], { ...P[name] }, suffix)
    for (const value of Object.values(P[name])) assert.match(value, SAFE_VALUE, `${name}: ${value}`)
  }
  // None of them can reach the full player
  for (const suffix of Object.keys(MINI_7B)) assert.ok(suffix.startsWith(`${MINI} `) && !suffix.includes('.fullscreen '), suffix)
})

test('Phase 7B mini type: condensed neutral metadata, condensed tabular times on the unchanged line box', async () => {
  const P = presets.PRIMITIVES
  const player = await read('../components/app/AudioPlayer.vue')
  // The same system condensed face the full-player faceplate uses; no font asset, no @font-face
  assert.equal(P.CONDENSED_FACE, 'sans-serif-condensed, sans-serif')
  assert.match(player, /\.faceplate-type \.title-author-texts \.title-text \{\s*font-family: sans-serif-condensed, sans-serif;/)
  for (const set of [P.MINI_TITLE_TYPE, P.MINI_AUTHOR_TYPE, P.MINI_TIME_TYPE]) {
    assert.equal(set['font-family'], P.CONDENSED_FACE)
    assert.equal(set.color, undefined, 'type only: metadata stays neutral and the times keep the readout green')
  }
  assert.deepEqual({ ...P.MINI_TITLE_TYPE }, { 'font-family': P.CONDENSED_FACE, 'letter-spacing': '0.01em' })
  assert.deepEqual({ ...P.MINI_AUTHOR_TYPE }, { 'font-family': P.CONDENSED_FACE, 'letter-spacing': '0.02em' })
  assert.equal(P.MINI_TIME_TYPE['font-variant-numeric'], 'tabular-nums')
  // 14px times on the line box the 12.8px times had at the inherited 1.5 line height: 19.2px, and 24.96px at font scale
  // 1.3, so the time row and the rail under it keep their bounds
  const size = parseFloat(P.MINI_TIME_TYPE['font-size']) * 16
  const line = Number(P.MINI_TIME_TYPE['line-height'])
  assert.equal(size, 14)
  for (const scale of [1, 1.3]) assert.ok(Math.abs(size * scale * line - 0.8 * 16 * scale * 1.5) < 0.001, `line box at ${scale}`)
  // The times keep the phosphor readout color
  const root = engine.themeSelector('llama')
  assert.deepEqual(presets.presentationRules([llama()])[`${root} #playerTrack p.font-mono`], { color: 'rgb(var(--color-accent))' })
})

test('Phase 7B: the seek-row times are sized by the stylesheet (same 0.8rem everywhere), so the theme can set their type', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const start = player.indexOf('<div id="playerTrack"')
  const track = player.slice(start, player.indexOf('<div class="relative">', start))
  assert.match(track, /<p class="track-time font-mono text-fg" ref="currentTimestamp">0:00<\/p>/)
  assert.match(track, /<p class="track-time font-mono text-fg">\{\{ timeRemainingPretty \}\}<\/p>/)
  assert.doesNotMatch(track, /style="font-size/)
  assert.match(player, /#playerTrack \.track-time \{\s*font-size: 0\.8rem;\s*\}/)
  // The full player's faceplate times still win there (!important), and the book rail's times are untouched
  assert.match(player, /\.faceplate-type #playerTrack p\.font-mono \{[^}]*font-size: var\(--faceplate-times\) !important;/)
  assert.equal((player.match(/<p class="font-mono text-fg" style="font-size: 0\.8rem">/g) || []).length, 2, 'total-track times unchanged')
})

test('Phase 7B readout strip and artwork mount are paint only and add no hit area or size', () => {
  const P = presets.PRIMITIVES
  assert.deepEqual(Object.keys(P.MINI_READOUT_STRIP).sort(), ['background-color', 'background-image', 'box-shadow'])
  assert.equal(P.MINI_READOUT_STRIP['background-color'], 'rgb(var(--color-recessed))')
  // Top-edge shading only (the seam line it replaces, then a fade)
  assert.match(P.MINI_READOUT_STRIP['background-image'], /^linear-gradient\(180deg, rgb\(var\(--color-edge-dark\)\) 0, rgb\(var\(--color-edge-dark\)\) 1px, /)
  // Two offset copies of the row's own box, below it: the face carried 6px under the rail, then a 1px lit line. No inset,
  // blur or spread, so the strip is the row's own width and never changes its box
  assert.deepEqual(P.MINI_READOUT_STRIP['box-shadow'].split(/, (?=\d)/), ['0 6px 0 0 rgb(var(--color-recessed))', '0 7px 0 0 rgb(var(--color-edge-light) / 0.22)'])
  // Artwork: the shared frame plus one soft drop; no bezel or ring
  assert.equal(P.MINI_ARTWORK_MOUNT['box-shadow'], `${P.ARTWORK_FRAME}, 0 2px 4px 2px rgb(0 0 0 / 0.45)`)
  assert.deepEqual(Object.keys(P.MINI_ARTWORK_MOUNT), ['box-shadow'])
  for (const set of [P.MINI_READOUT_STRIP, P.MINI_ARTWORK_MOUNT]) for (const property of Object.keys(set)) assert.match(property, PAINT_ONLY, property)
})

test('Phase 7B rejects Candidate C: no mini plate, well, bay or decorative element; the 120px panel geometry is unchanged', async () => {
  const P = presets.PRIMITIVES
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  for (const [selector, declarations] of Object.entries(rules)) {
    if (!selector.includes(':not(.fullscreen)')) continue
    assert.doesNotMatch(selector, /plate|well|bay|console/, selector)
    assert.notDeepEqual(declarations, { ...P.ARTWORK_BAY.regular }, selector)
    assert.notDeepEqual(declarations, { ...P.METADATA_READOUT }, selector)
  }
  assert.equal(rules[`${root} ${MINI} .title-author-texts`], undefined, 'no metadata well')
  const player = await read('../components/app/AudioPlayer.vue')
  // Still only the three Phase 6B full-player plates, each shown by the layout projection (full screen only)
  assert.deepEqual(
    [...player.matchAll(/class="player-plate ([a-z-]+)"/g)].map((m) => m[1]),
    ['player-plate-top', 'player-plate-console', 'player-plate-seek']
  )
  // The collapsed player's geometry: the 120px panel, the 46px artwork, and the anchors of the metadata, keys and seek row
  assert.match(player, /\.playerContainer \{\s*height: 120px;\s*\}/)
  assert.match(player, /--cover-image-width-collapsed: 46px;\s*--cover-image-height-collapsed: 46px;/)
  assert.match(player, /\.cover-wrapper \{\s*bottom: 68px;\s*left: 24px;/)
  assert.match(player, /width: var\(--title-author-width-collapsed\);\s*bottom: 76px;/)
  assert.match(player, /#playerControls \{[^}]*width: 128px;\s*padding-right: 24px;\s*bottom: 70px;/)
  assert.match(player, /#playerTrack \{[^}]*bottom: 35px;/)
})

test('Phase 7B rules compile through Tailwind under the LLAMA root only; Dark, Black and Light get nothing', async () => {
  const postcss = require('postcss')
  const tailwind = require('tailwindcss')
  const config = require('../tailwind.config.js')
  const source = await read('../assets/tailwind.css')
  const content = config.content.map((glob) => new URL(`../${glob}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const { css } = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
  const root = "html[data-theme='llama']"
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    for (const selector of m[1].split(',')) if (selector.includes('#streamContainer:not(.fullscreen)')) assert.ok(selector.trim().startsWith(`${root} `), selector.trim())
  }
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, selector)
    return css.slice(i, css.indexOf('}', i))
  }
  assert.match(block(`${root} ${MINI} #playerTrack p.font-mono`), /font-family: sans-serif-condensed, sans-serif;\s*font-size: 0\.875rem;\s*line-height: 1\.3714286;\s*font-variant-numeric: tabular-nums;\s*letter-spacing: 0\.02em;/)
  assert.match(block(`${root} ${MINI} #playerTrack`), /box-shadow: 0 6px 0 0 rgb\(var\(--color-recessed\)\), 0 7px 0 0 rgb\(var\(--color-edge-light\) \/ 0\.22\);/)
  assert.ok(!/@font-face[^}]*condensed/.test(css), 'no font asset')
  for (const id of ['dark', 'black', 'light']) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {}, id)
})
