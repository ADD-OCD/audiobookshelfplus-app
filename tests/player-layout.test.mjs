// Phase 6B: the full player's layout projection (theme/playerLayout.js), the LLAMA "B+" faceplate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const engine = require('../theme/engine.js')
const presets = require('../theme/presets.js')
const layout = require('../theme/playerLayout.js')
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))

const llama = () => engine.getTheme('llama')
const LEGACY_THEMES = ['dark', 'black', 'light']
// Viewports from the acceptance matrix (CSS px) and a few beyond it
const PORTRAIT = [
  [412, 842],
  [412, 799],
  [412, 734],
  [412, 933],
  [762, 986],
  [360, 640],
  [393, 852],
  [430, 932],
  [800, 1280]
]
const LANDSCAPE = [
  [915, 364],
  [842, 412],
  [1280, 800]
]
const ASPECTS = [1, 1.6]

// The previous AudioPlayer.vue fullscreenBookCoverWidth, copied verbatim, as the independent reference
function previousCoverWidth(windowWidth, windowHeight, bookCoverAspectRatio) {
  if (windowWidth < windowHeight) {
    let sideSpace = 20
    if (bookCoverAspectRatio === 1.6) sideSpace += (windowWidth - sideSpace) * 0.375
    const availableHeight = windowHeight - 400
    let width = windowWidth - sideSpace
    const totalHeight = width * bookCoverAspectRatio
    if (totalHeight > availableHeight) {
      width = availableHeight / bookCoverAspectRatio
    }
    return width
  } else {
    const heightScale = (windowHeight - 200) / 651
    if (bookCoverAspectRatio === 1) {
      return 260 * heightScale
    }
    return 190 * heightScale
  }
}

const at = (theme, [width, height], aspectRatio = 1, twoRail = false) => layout.fullscreenLayout(theme, { width, height, aspectRatio, twoRail })

test('Legacy themes: the projection is a strict no-op (previous artwork width, no classes, no variables, no plates)', () => {
  for (const id of LEGACY_THEMES) {
    for (const vp of [...PORTRAIT, ...LANDSCAPE]) {
      for (const ar of ASPECTS) {
        for (const twoRail of [false, true]) {
          const r = at(engine.getTheme(id), vp, ar, twoRail)
          assert.equal(r.path, 'standard')
          assert.equal(r.coverWidth, previousCoverWidth(vp[0], vp[1], ar), `${id} ${vp} ${ar}`)
          assert.deepEqual(r.classes, [])
          assert.deepEqual(r.vars, {})
          assert.deepEqual(r.plates, { top: false, console: false, seek: false })
        }
      }
    }
  }
  // A missing/unknown theme is treated the same way
  assert.equal(layout.fullscreenLayout(null, { width: 412, height: 842, aspectRatio: 1, twoRail: false }).path, 'standard')
})

test('legacyCoverWidth is the previous formula, unchanged', () => {
  for (const vp of [...PORTRAIT, ...LANDSCAPE]) for (const ar of ASPECTS) assert.equal(layout.legacyCoverWidth({ width: vp[0], height: vp[1], aspectRatio: ar }), previousCoverWidth(vp[0], vp[1], ar))
})

test('Normal single-rail LLAMA portrait selects the full faceplate (B+) geometry', () => {
  const r = at(llama(), [412, 842])
  assert.equal(r.path, 'faceplate')
  assert.deepEqual(r.classes, ['faceplate-type', 'faceplate', 'faceplate-top-plate'])
  assert.deepEqual(r.plates, { top: true, console: true, seek: true })
  // The approved prototype at 412x842: 384px artwork from 93px, readout band 76px, deck 247px, 24px times
  assert.equal(r.coverWidth, 384)
  assert.equal(r.vars['--faceplate-cover-top'], '93.33px')
  assert.equal(r.vars['--faceplate-band'], '76px')
  assert.equal(r.vars['--faceplate-deck'], '247px')
  assert.equal(r.vars['--faceplate-console-top'], '86px')
  assert.equal(r.vars['--faceplate-times'], '24px')
  assert.equal(r.vars['--faceplate-plate-height'], '60px')
  for (const value of Object.values(r.vars)) assert.match(value, /^\d+(\.\d+)?px$/)
})

test('Compact tier where the regular budget would make the artwork height-limited; artwork cost stays as approved', () => {
  const expected = [
    // viewport, artwork (approved prototype), previous artwork
    [[412, 799], 378, 392],
    [[412, 734], 313, 334],
    [[762, 986], 565, 586]
  ]
  for (const [vp, art, previous] of expected) {
    const r = at(llama(), vp)
    assert.equal(r.path, 'faceplate', String(vp))
    assert.ok(r.classes.includes('faceplate-compact'), String(vp))
    assert.equal(Math.round(r.coverWidth), art, String(vp))
    assert.equal(r.vars['--faceplate-times'], '22px')
    assert.equal(r.vars['--faceplate-band'], '72px')
    assert.equal(Math.round(previousCoverWidth(vp[0], vp[1], 1)), previous)
    // Approved costs: about 7% (799, wide) and 12% (734) of the artwork's area
    const loss = 1 - (r.coverWidth / previousCoverWidth(vp[0], vp[1], 1)) ** 2
    assert.ok(loss <= 0.13, `${vp}: ${loss}`)
  }
  // Standard and tall stay on the regular tier
  for (const vp of [
    [412, 842],
    [412, 933]
  ])
    assert.ok(!at(llama(), vp).classes.includes('faceplate-compact'), String(vp))
})

test('The tier switch follows the artwork, not a device height: both tiers give the full width at the boundary', () => {
  const { TIERS } = layout
  const b = layout.budget(TIERS.regular)
  const boundary = b.above + b.below + (412 - 20 - layout.FACEPLATE.bayAllowance)
  assert.equal(at(llama(), [412, boundary]).classes.includes('faceplate-compact'), false)
  const below = at(llama(), [412, boundary - 1])
  assert.ok(below.classes.includes('faceplate-compact'))
  // No artwork jump across the switch: the compact budget still affords the full width there
  assert.equal(below.coverWidth, 412 - 20 - layout.FACEPLATE.bayAllowance)
})

test('Tall screens share the extra room between three seams instead of one dead band', () => {
  const r = at(llama(), [412, 933])
  const { TIERS, FACEPLATE } = layout
  const b = layout.budget(TIERS.regular)
  const slack = (933 - b.above - b.below - r.coverWidth) / 3
  assert.ok(slack > 20)
  assert.equal(r.vars['--faceplate-cover-top'], `${Math.round((b.above + slack) * 100) / 100}px`)
  assert.equal(r.vars['--faceplate-readout-bottom'], `${Math.round((TIERS.regular.deck + TIERS.regular.seam + FACEPLATE.readoutPlate + slack) * 100) / 100}px`)
  assert.equal(r.coverWidth, 384)
})

test('Chapter Track + Total Track (two rails) selects the compatibility path: previous artwork geometry, B+ presentation', () => {
  for (const vp of PORTRAIT) {
    for (const ar of ASPECTS) {
      const r = at(llama(), vp, ar, true)
      assert.equal(r.path, 'compat', String(vp))
      assert.equal(r.coverWidth, previousCoverWidth(vp[0], vp[1], ar))
      assert.ok(r.classes.includes('faceplate-type') && r.classes.includes('faceplate-flat'))
      assert.ok(!r.classes.includes('faceplate') && !r.classes.includes('faceplate-compact'))
      assert.equal(r.plates.console, true)
      assert.equal(r.plates.seek, false)
      assert.equal(r.vars['--faceplate-times'], '16px')
      assert.equal(r.vars['--faceplate-cover-top'], undefined)
    }
  }
  // The top plate only where it clears the artwork's frame
  assert.equal(at(llama(), [412, 842], 1, true).plates.top, true)
  assert.equal(at(llama(), [412, 734], 1, true).plates.top, true)
})

test('Landscape keeps the previous two-column geometry with the safe presentation only (no top plate, no bay)', () => {
  for (const vp of LANDSCAPE) {
    for (const twoRail of [false, true]) {
      const r = at(llama(), vp, 1, twoRail)
      assert.equal(r.path, 'landscape')
      assert.equal(r.coverWidth, previousCoverWidth(vp[0], vp[1], 1))
      assert.deepEqual(r.classes, ['faceplate-type', 'faceplate-flat'])
      assert.deepEqual(r.plates, { top: false, console: true, seek: false })
      assert.equal(r.vars['--faceplate-times'], '16px')
    }
  }
})

test('Artwork never exceeds its bay and never falls below the floor: past it the compatibility geometry is used', () => {
  for (const vp of PORTRAIT) {
    for (const ar of ASPECTS) {
      const r = at(llama(), vp, ar)
      const previous = previousCoverWidth(vp[0], vp[1], ar)
      if (r.path === 'faceplate') {
        assert.ok(r.coverWidth <= layout.legacyCoverWidth({ width: vp[0], height: 1e9, aspectRatio: ar }) - layout.FACEPLATE.bayAllowance + 1e-9, String(vp))
        assert.ok(r.coverWidth >= previous * layout.MIN_ARTWORK_RATIO, String(vp))
      } else assert.equal(r.coverWidth, previous)
    }
  }
  // A 640px-tall phone cannot afford the faceplate without giving up too much artwork
  assert.equal(at(llama(), [360, 640]).path, 'compat')
})

test('Budgets hold their content at font scale 1.3 (band, seek module above the console)', () => {
  const { TIERS, FACEPLATE } = layout
  const zoom = 1.3
  for (const [name, tier] of Object.entries(TIERS)) {
    // Title (20.8px at most, line-height 1.25) + author (16px, line-height 1.2) + 6px top/bottom padding, zoomed
    const metadata = 20.8 * zoom * 1.25 + 16 * zoom * 1.2 + 12
    assert.ok(metadata <= tier.band, `${name} band ${tier.band} < ${metadata}`)
    // Seek module: deck padding 8 + well top 4 + row padding 5 + times line + 2 + 6px channel + 8 below + 6px plate
    const seek = 8 + 4 + 5 + tier.times * zoom * 1.15 + 2 + 6 + 8 + 6
    assert.ok(seek + 6 <= tier.deck - FACEPLATE.console, `${name}: seek module ${seek} + 6px seam over the console`)
  }
})

test('No-crop guarantee: the cover component, the bay and the CSS all take the layout width; min-width cannot hold it wider', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  // The component's width prop and the --cover-image-* variables both come from fullscreenBookCoverWidth = layout width
  assert.match(player, /:width="bookCoverWidth"/)
  assert.match(player, /if \(this\.showFullscreen\) return this\.fullscreenBookCoverWidth/)
  assert.match(player, /fullscreenBookCoverWidth\(\) \{\s*return this\.fullscreenLayout\.coverWidth\s*\}/)
  assert.match(player, /setProperty\('--cover-image-width', this\.fullscreenBookCoverWidth \+ 'px'\)/)
  // A theme switch or Chapter Track change re-sizes the cover
  assert.match(player, /fullscreenBookCoverWidth\(\) \{\s*this\.updateScreenSize\(\)\s*\}/)
  // The explicit guard: under the faceplate, the cover component fills the bay and its min-width cannot exceed it
  const guard = player.match(/#streamContainer\.fullscreen\.faceplate \.cover-wrapper > div > div \{([^}]*)\}/)
  assert.ok(guard, 'cover guard rule')
  for (const decl of ['width: 100% !important', 'height: 100% !important', 'min-width: 0 !important', 'max-width: 100% !important']) assert.ok(guard[1].includes(decl), decl)
})

test('Faceplate stylesheet: geometry only behind the hook classes, and never on the controls, seek target or mini-player', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const style = player.slice(player.indexOf('<style>'))
  const block = style.slice(style.indexOf('/*\n * Faceplate layout'))
  assert.ok(block.length > 100)
  const rules = [...block.matchAll(/([^{}]+)\{[^}]*\}/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim())
  for (const selector of rules) {
    for (const s of selector.split(',').map((x) => x.trim())) {
      assert.match(s, /^(\.player-plate|\.faceplate-|#streamContainer\.fullscreen\.faceplate )/, s)
      // Controls, keys, the seek channel and its touch target are frozen
      assert.doesNotMatch(s, /playerControls|play-btn|player-key|utility|trackCursor|chrome-key|\.relative \.|rounded-full/, s)
    }
  }
  // The seek row keeps its horizontal geometry (px-6): only its top padding changes
  assert.doesNotMatch(block, /#playerTrack \{[^}]*padding-(left|right)/)
  // The mini-player keeps its 120px deck; the faceplate deck height needs the fullscreen hook
  assert.match(style, /\.playerContainer \{\s*height: 120px;/)
  assert.match(block, /#streamContainer\.fullscreen\.faceplate \.playerContainer \{\s*height: var\(--faceplate-deck\);/)
})

test('Plates are decorative: aria-hidden, rendered only from the layout projection, never touch targets', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  const plates = [...template.matchAll(/<div [^>]*class="player-plate ([^"]+)"[^>]*\/>/g)]
  assert.deepEqual(plates.map((m) => m[1]).sort(), ['player-plate-console', 'player-plate-seek', 'player-plate-top'])
  for (const [tag, cls] of plates) {
    assert.match(tag, /aria-hidden="true"/)
    assert.match(tag, new RegExp(`v-if="faceplateHooks\\.plates\\.${cls.replace('player-plate-', '')}"`))
    assert.doesNotMatch(tag, /@click|@touch/)
  }
  assert.match(player, /\.player-plate \{\s*position: absolute;\s*pointer-events: none;/)
  // The hooks reach #streamContainer only through the projection
  assert.match(template, /id="streamContainer"[^>]*:class="\[\{ fullscreen: showFullscreen[^"]*\}, faceplateHooks\.classes\]" :style="faceplateHooks\.vars"/)
})

test('faceplateHooks: nothing while collapsed (mini-player) or for legacy themes; the projection while full screen', async () => {
  const source = await read('../components/app/AudioPlayer.vue')
  const script = source
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.component =')
  const sandbox = { coverPresentation: {}, playerLayout: layout, Capacitor: {}, AbsAudioPlayer: {}, Dialog: {}, getAverageColorFromCoverUrl: async () => null, WrappingMarquee: function () {}, jumpLabelMixin: {}, console }
  vm.runInNewContext(script, sandbox)
  const c = sandbox.component.computed
  const ctx = { themeId: 'llama', showFullscreen: true, windowWidth: 412, windowHeight: 842, playerSettings: { useChapterTrack: false, useTotalTrack: true }, $store: { getters: { 'libraries/getBookCoverAspectRatio': 1 } } }
  Object.defineProperty(ctx, '$theme', { get: () => ({ theme: engine.getTheme(ctx.themeId) }) })
  for (const name of ['presentationTheme', 'bookCoverAspectRatio', 'fullscreenLayout', 'fullscreenBookCoverWidth']) Object.defineProperty(ctx, name, { get: () => c[name].call(ctx) })
  assert.deepEqual([...c.faceplateHooks.call(ctx).classes], ['faceplate-type', 'faceplate', 'faceplate-top-plate'])
  ctx.playerSettings.useChapterTrack = true
  assert.equal(ctx.fullscreenLayout.path, 'compat')
  ctx.showFullscreen = false
  assert.deepEqual(JSON.parse(JSON.stringify(c.faceplateHooks.call(ctx))), { classes: [], vars: {}, plates: { top: false, console: false, seek: false } })
  ctx.showFullscreen = true
  for (const id of LEGACY_THEMES) {
    ctx.themeId = id
    assert.deepEqual(JSON.parse(JSON.stringify(c.faceplateHooks.call(ctx))), { classes: [], vars: {}, plates: { top: false, console: false, seek: false } })
    assert.equal(ctx.fullscreenBookCoverWidth, previousCoverWidth(412, 842, 1))
  }
})

test('Console banks are vertically centered in their framed sections (transport by its key envelope, utility by its row)', async () => {
  const P = presets.PRIMITIVES
  const { FACEPLATE } = layout
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const px = (v) => parseFloat(v)
  const transport = rules[`${root} #streamContainer.fullscreen.faceplate #playerControls`]
  const utility = rules[`${root} #streamContainer.fullscreen.faceplate #playerContent .utility-row`]
  assert.deepEqual(transport, { ...P.FACEPLATE_TRANSPORT_BANK })
  assert.deepEqual(utility, { ...P.FACEPLATE_UTILITY_BANK })
  // Offsets measured up from the deck bottom. The divider is where the deck already puts it (DECK.seam, unchanged)
  const divider = P.DECK.seam.base - P.DECK.seam.drop
  assert.equal(P.FACEPLATE_DIVIDER, divider)
  const plateTop = FACEPLATE.console
  const plateBottom = FACEPLATE.consoleInset
  // Transport: the bank box is the section [divider, plateTop]; its 65px row is centered in the box below its top padding
  assert.equal(px(transport.height), plateTop - divider)
  assert.equal(transport.display, 'flex')
  assert.equal(transport['flex-direction'], 'column')
  assert.equal(transport['justify-content'], 'center')
  const row = P.PRIMARY_KEY_BOX
  const pad = px(transport['padding-top'])
  const rowTop = plateTop - pad - (plateTop - divider - pad - row) / 2 // distance of the row box's top above the deck bottom
  // Envelope: the lifted primary's top to the secondary keys' bottom (60px keys centered in the 65px row)
  const envelopeTop = rowTop + P.DECK.primaryLift
  const envelopeBottom = rowTop - row + (row - P.DECK.transport.height) / 2
  const transportTopClear = plateTop - envelopeTop
  const transportBottomClear = envelopeBottom - divider
  assert.ok(Math.abs(transportTopClear - transportBottomClear) < 0.01, `transport clearances ${transportTopClear}/${transportBottomClear}`)
  assert.ok(transportTopClear >= 8, 'the bank keeps breathing room')
  // Utility: the bank box is the section [plateBottom, divider]; its keys (and the 52px readouts) are centered in it
  assert.equal(px(utility.bottom), plateBottom)
  assert.equal(px(utility.height), divider - plateBottom)
  assert.equal(utility['justify-content'], 'center')
  const utilityClear = (divider - plateBottom - P.DECK.utility.height) / 2
  assert.ok(utilityClear >= 6, `utility clearance ${utilityClear}`)
  // The constants describe the real elements: the player's primary box, and the console plate's inset in its stylesheet
  const player = await read('../components/app/AudioPlayer.vue')
  assert.match(player, new RegExp(`\\.fullscreen #playerControls \\.play-btn \\{\\s*height: ${row}px;\\s*width: ${row}px;`))
  const plate = player.match(/\.player-plate-console \{([^}]*)\}/)[1]
  assert.match(plate, new RegExp(`bottom: ${plateBottom}px;`))
  assert.match(plate, /top: var\(--faceplate-console-top\);/)
  assert.equal(at(llama(), [412, 842]).vars['--faceplate-console-top'], `${layout.TIERS.regular.deck - plateTop}px`)
  // The utility section is the same on the previous-geometry plate paths (compat, landscape: plate bottom inset, same
  // divider), so the same centered bank applies there; the transport section exists only on the faceplate
  assert.deepEqual(rules[`${root} #streamContainer.fullscreen.faceplate-flat #playerContent .utility-row`], { ...P.FACEPLATE_UTILITY_BANK })
  assert.equal(rules[`${root} #streamContainer.fullscreen.faceplate-flat #playerControls`], undefined)
  const flatPlate = player.match(/\.faceplate-flat \.player-plate-console \{([^}]*)\}/)[1]
  assert.doesNotMatch(flatPlate, /bottom/, 'flat console plate keeps the same bottom inset')
  const banks = Object.keys(rules).filter((s) => /#playerControls$|\.utility-row$/.test(s) && /faceplate/.test(s))
  assert.deepEqual(banks.map((s) => s.slice(root.length + 1)).sort(), ['#streamContainer.fullscreen.faceplate #playerContent .utility-row', '#streamContainer.fullscreen.faceplate #playerControls', '#streamContainer.fullscreen.faceplate-flat #playerContent .utility-row'])
  // Legacy themes get none of it
  for (const id of LEGACY_THEMES) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {})
})

test('Recipe paint for the faceplate: LLAMA only, paint only, bay widths from the layout tiers', () => {
  const root = engine.themeSelector('llama')
  const rules = presets.presentationRules([llama()])
  const P = presets.PRIMITIVES
  assert.deepEqual(rules[`${root} .player-plate`], { ...P.FACEPLATE_PLATE })
  assert.deepEqual(rules[`${root} .player-plate-top`], { ...P.FACEPLATE_TOP_PLATE })
  assert.deepEqual(rules[`${root} #streamContainer.faceplate .cover-wrapper`], { ...P.ARTWORK_BAY.regular })
  assert.deepEqual(rules[`${root} #streamContainer.faceplate-compact .cover-wrapper`], { ...P.ARTWORK_BAY.compact })
  assert.deepEqual(rules[`${root} #streamContainer.faceplate #playerContent`], { ...P.FACEPLATE_DECK })
  assert.deepEqual(rules[`${root} #streamContainer.faceplate-flat #playerContent`], { ...P.FACEPLATE_DECK })
  assert.ok(P.ARTWORK_BAY.regular['box-shadow'].includes(`0 0 0 ${layout.TIERS.regular.bezel}px rgb(var(--color-bg))`))
  assert.ok(P.ARTWORK_BAY.compact['box-shadow'].includes(`0 0 0 ${layout.TIERS.compact.bezel}px rgb(var(--color-bg))`))
  // Legacy themes get no faceplate rules at all (the standard finish produces none)
  for (const id of LEGACY_THEMES) assert.deepEqual(presets.presentationRules([engine.getTheme(id)]), {})
  // Metadata stays neutral: nothing in the faceplate paint colors the title or author
  for (const [selector, d] of Object.entries(rules)) if (/faceplate|player-plate/.test(selector)) assert.equal(d.color, undefined, selector)
})
