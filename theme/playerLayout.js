/**
 * Presentation projection for the full player's layout (Phase 6B, the LLAMA "B+" faceplate).
 *
 * The equipment finish (`presentation.finish: 'equipment'`, LLAMA) presents the portrait full player as one
 * faceplate of stacked modules: a top chrome plate, a mounted artwork bay, the metadata readout, a seek/time
 * module and one console plate around the transport and utility banks. Every other theme keeps the existing
 * layout exactly: `standard` returns the previous artwork width and no hooks.
 *
 * Paths:
 * - 'standard'  non-equipment themes: the previous cover width, no classes, no variables (a strict no-op).
 * - 'faceplate' equipment, portrait, one rail (Chapter Track off, the default): the B+ geometry below. The
 *               artwork takes the height the modules leave, capped at the previous width allowance minus the bay.
 * - 'compat'    equipment, portrait, two rails (Chapter Track on with Total Track): the previous geometry with the
 *               B+ presentation only, because the second rail would otherwise cost the artwork 21-35% of its area.
 *               Also used where the faceplate would shrink the artwork below MIN_ARTWORK_RATIO of its previous width.
 * - 'landscape' equipment, landscape: the previous two-column geometry with the B+ presentation only.
 * With two rails, both previous-geometry paths present the chapter and book rails as one dual-track instrument
 * ('faceplate-dual'); with one rail they keep the console plate around the whole previous deck ('faceplate-flat').
 *
 * Every number lives here; the player turns the result into CSS variables and hook classes on #streamContainer,
 * and its own stylesheet consumes them (the LLAMA recipe in theme/presets.js only paints the plates and bezel).
 * Values are fixed repository constants, never theme-supplied. CommonJS so node tests can load it.
 */

// Module budgets (px), each sized for font scale 1.3. `regular` is used while the artwork stays width-limited;
// `compact` (smaller seams, bay and band, 22px times) where the regular budget would make it height-limited
const TIERS = Object.freeze({
  regular: Object.freeze({ plateBottom: 72, seam: 10, bezel: 7, band: 76, deck: 247, times: 24 }),
  compact: Object.freeze({ plateBottom: 70, seam: 6, bezel: 5, band: 72, deck: 239, times: 22 })
})
const FACEPLATE = Object.freeze({
  plateTop: 12, // the top chrome plate starts 12px down; the chrome keys sit at 20-64px
  bezelRing: 2, // dark ring outside the artwork bezel
  readoutPlate: 4, // the Phase 4E bezel plate drawn around the metadata well
  console: 161, // the console plate: the bottom 161px of the deck (the unchanged transport and utility banks)
  consoleInset: 6, // the console plate's bottom edge above the deck bottom (and its side inset)
  bayAllowance: 8, // the bay's extra side room beyond the previous artwork side allowance
  flatTimes: 16, // timestamps where the deck keeps its previous 200px (compat, landscape): larger would push the
  //               unchanged seek hit target onto the transport keys at font scale 1.3
  compatPlateClearance: 6, // compat shows the top plate only with this much room above the artwork frame
  legacyDeck: 200, // the full player's previous deck height (compat and landscape keep it)
  // Chapter + book progress (two rails) on the previous-geometry paths: one dual-track instrument directly above the
  // console. Offsets are measured up from the deck bottom. `console` puts the console plate's top edge where it centers
  // the transport bank as it already sits (the divider at 73px plus 7.5px, the 65.5px key envelope and 7.5px: keys do
  // not move); above it a seam, the plate, then two equal sections (chapter below, book above), each sized for font
  // scale 1.3 (16px times + 2px + a 6px rail)
  dual: Object.freeze({ console: 153.5, seam: 6, plate: 6, section: 30 })
})
// Below this fraction of its previous width the faceplate is not worth the artwork: use the compat geometry. 0.93
// keeps the cost within about 13.5% of the artwork's area, which covers the approved 412x734 cost (about 12%)
const MIN_ARTWORK_RATIO = 0.93

/** The previous fullscreen cover width (moved here unchanged from AudioPlayer.vue). */
function legacyCoverWidth({ width, height, aspectRatio }) {
  if (width < height) {
    // Portrait
    let sideSpace = 20
    if (aspectRatio === 1.6) sideSpace += (width - sideSpace) * 0.375

    const availableHeight = height - 400
    let coverWidth = width - sideSpace
    const totalHeight = coverWidth * aspectRatio
    if (totalHeight > availableHeight) {
      coverWidth = availableHeight / aspectRatio
    }
    return coverWidth
  }
  // Landscape
  const heightScale = (height - 200) / 651
  if (aspectRatio === 1) {
    return 260 * heightScale
  }
  return 190 * heightScale
}

function isEquipment(theme) {
  return !!(theme && theme.tokens && theme.tokens['presentation.finish'] === 'equipment')
}

const px = (n) => `${Math.round(n * 100) / 100}px`

// Vertical budget above and below the artwork for a tier
function budget(tier) {
  const bay = tier.bezel + FACEPLATE.bezelRing
  return {
    above: tier.plateBottom + tier.seam + bay,
    below: tier.deck + tier.seam + FACEPLATE.readoutPlate + tier.band + FACEPLATE.readoutPlate + tier.seam + bay
  }
}

// Faceplate artwork for one tier: the width-capped bay, or the height the modules leave
function faceplateCover(tier, { width, height, aspectRatio }) {
  const legacy = legacyCoverWidth({ width, height: Number.MAX_SAFE_INTEGER, aspectRatio }) // width allowance only
  const cap = legacy - FACEPLATE.bayAllowance
  const { above, below } = budget(tier)
  const free = height - above - below
  const coverWidth = Math.min(cap, free / aspectRatio)
  return { coverWidth, free, above, heightLimited: cap * aspectRatio > free }
}

/**
 * @param {{ tokens: object }|null} theme a validated theme (engine.getTheme)
 * @param {{ width: number, height: number, aspectRatio: number, twoRail: boolean }} viewport the player's viewport
 *        and whether the Chapter Track + Total Track pair renders the second rail
 * @returns {{ path: string, coverWidth: number, classes: string[], vars: object, plates: { top: boolean, console: boolean, seek: boolean } }}
 */
function fullscreenLayout(theme, { width, height, aspectRatio, twoRail }) {
  const legacy = legacyCoverWidth({ width, height, aspectRatio })
  const none = { top: false, console: false, seek: false }
  if (!isEquipment(theme)) return { path: 'standard', coverWidth: legacy, classes: [], vars: {}, plates: none }

  // Previous geometry with the B+ presentation. With two rails (dual) the chapter and book rails become one dual-track
  // instrument above the console; otherwise the console plate wraps the whole previous deck (flat)
  const D = FACEPLATE.dual
  const dualVars = () => ({
    '--faceplate-console-top': px(FACEPLATE.legacyDeck - D.console),
    '--faceplate-dual-section': px(D.section),
    '--faceplate-dual-main-bottom': px(D.console + D.seam + D.plate),
    '--faceplate-dual-book-bottom': px(D.console + D.seam + D.plate + D.section)
  })
  const flat = (path, topPlate, dual) => ({
    path,
    coverWidth: legacy,
    classes: ['faceplate-type', dual ? 'faceplate-dual' : 'faceplate-flat', ...(topPlate ? ['faceplate-top-plate'] : [])],
    vars: { '--faceplate-times': px(FACEPLATE.flatTimes), '--faceplate-plate-height': px(TIERS.regular.plateBottom - FACEPLATE.plateTop), ...(dual ? dualVars() : {}) },
    plates: { top: topPlate, console: true, seek: dual }
  })
  if (width >= height) return flat('landscape', false, twoRail)

  // Previous portrait geometry: the artwork's top edge (its 2px frame included) decides whether the top plate fits
  const compat = (dual) => {
    const legacyTop = height / 2 - 120 - (legacy * aspectRatio) / 2 - 2
    return flat('compat', legacyTop - TIERS.regular.plateBottom >= FACEPLATE.compatPlateClearance, dual)
  }
  if (twoRail) return compat(true)

  let tier = TIERS.regular
  let cover = faceplateCover(tier, { width, height, aspectRatio })
  if (cover.heightLimited) {
    tier = TIERS.compact
    cover = faceplateCover(tier, { width, height, aspectRatio })
  }
  if (cover.coverWidth < legacy * MIN_ARTWORK_RATIO) return compat(false)

  // Room left over when the artwork is width-limited becomes three equal seams (above the bay, between the bay and
  // the readout, between the readout and the seek module) rather than one dead band
  const slack = Math.max(0, (cover.free - cover.coverWidth * aspectRatio) / 3)
  const coverTop = cover.above + slack
  const readoutBottom = tier.deck + tier.seam + FACEPLATE.readoutPlate + slack
  return {
    path: 'faceplate',
    coverWidth: cover.coverWidth,
    classes: ['faceplate-type', 'faceplate', 'faceplate-top-plate', ...(tier === TIERS.compact ? ['faceplate-compact'] : [])],
    vars: {
      '--faceplate-cover-top': px(coverTop),
      '--faceplate-readout-bottom': px(readoutBottom),
      '--faceplate-band': px(tier.band),
      '--faceplate-deck': px(tier.deck),
      '--faceplate-console-top': px(tier.deck - FACEPLATE.console),
      '--faceplate-times': px(tier.times),
      '--faceplate-plate-height': px(tier.plateBottom - FACEPLATE.plateTop)
    },
    plates: { top: true, console: true, seek: true }
  }
}

module.exports = { fullscreenLayout, legacyCoverWidth, budget, TIERS, FACEPLATE, MIN_ARTWORK_RATIO }
