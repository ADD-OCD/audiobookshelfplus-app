/**
 * Fixed presentation recipes selected by the validated `presentation.finish` token.
 *
 * - 'standard' produces no rules at all, so Dark/Black/Light CSS is exactly the token variables.
 * - 'equipment' is a repository-owned recipe (bevels, recessed wells, ...). Its selectors, property
 *   names and structure live here, in code. Theme data only chooses the recipe and supplies validated
 *   colors: rules reference token variables, and the derived edge colors below are computed from
 *   validated channels with fixed blend factors that theme data cannot influence.
 *
 * Selectors are built only from validated built-in theme ids (engine.themeSelector).
 * CommonJS on purpose: used by tailwind.config.js at build time.
 */
const engine = require('./engine')
const playerLayout = require('./playerLayout')

const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]
// Fixed, repository-owned blend factors (not theme data)
const EDGE_LIGHT_TOWARD_WHITE = 0.45
const EDGE_DARK_TOWARD_BLACK = 0.6

const mix = (from, to, t) => from.map((channel, i) => Math.round(channel + (to[i] - channel) * t))
const channels = (c) => `${c[0]} ${c[1]} ${c[2]}`

/** Colors the equipment recipe derives from validated theme tokens. */
function equipmentDerivedDeclarations(tokens) {
  return {
    // Lighter top/left bevel edge, from the raised surface
    '--color-edge-light': channels(mix(tokens['surface.raised'], WHITE, EDGE_LIGHT_TOWARD_WHITE)),
    // Darker bottom/right bevel edge, from the base surface
    '--color-edge-dark': channels(mix(tokens['surface.base'], BLACK, EDGE_DARK_TOWARD_BLACK))
  }
}

/**
 * The equipment recipe: [selector suffix relative to the theme root, declarations].
 * An empty suffix targets the theme root itself. Values may only reference CSS variables emitted by
 * the token layer or by equipmentDerivedDeclarations.
 */
// --- Shared equipment primitives ---
// Paint-only building blocks (no border widths, padding, transforms or layout properties). One light source:
// light upper/left edges, dark lower/right edges, drop shadows falling down. Later gates compose rules from
// these instead of adding one-off values. All are fixed repository values; theme data cannot supply any.

// Radius scale: squared, restrained geometry. Every key, the primary Play/Pause key included, uses `key`.
const RADIUS = Object.freeze({
  frame: '2px', // artwork frames and fine detail
  key: '4px', // wells, panels and equipment keys
  none: '0px' // square inner corners where two wells join into one (the dual-track display)
})

// Edge treatments
const RAISED_BEVEL = 'inset 1px 1px 0 rgb(var(--color-edge-light) / 0.55), inset -1px -1px 0 rgb(var(--color-edge-dark))'
const PRESSED_BEVEL = 'inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.35)'
const RECESSED_WELL = 'inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.25), inset 0 2px 6px rgb(0 0 0 / 0.45)'
const STEEL_SHEEN = 'linear-gradient(180deg, rgb(var(--color-edge-light) / 0.18) 0%, rgb(var(--color-edge-light) / 0) 55%, rgb(0 0 0 / 0.18) 100%)'
const CHASSIS_SHEEN = 'linear-gradient(180deg, rgb(var(--color-edge-light) / 0.1) 0%, rgb(var(--color-edge-light) / 0) 40%, rgb(0 0 0 / 0.2) 100%)'
const ARTWORK_FRAME = '0 0 0 1px rgb(var(--color-edge-dark)), 0 0 0 2px rgb(var(--color-edge-light) / 0.45)'
// A seam cut into the bottom of an element: dark inset line with a faint light return line below it.
// Drawn inside the element's own box (inset), so row dimensions never change.
const ENGRAVED_SEPARATOR = 'inset 0 -1px 0 rgb(var(--color-edge-light) / 0.12), inset 0 -2px 0 rgb(var(--color-edge-dark))'
// The same seam cut into the top of an element (dark line on top, faint light return under it)
const ENGRAVED_SEPARATOR_TOP = 'inset 0 1px 0 rgb(var(--color-edge-dark)), inset 0 2px 0 rgb(var(--color-edge-light) / 0.12)'
// Recessed display face as a background layer: dark upper lip with an inner shade falling down and a faint
// light lower lip. Unlike an inset box-shadow it follows background-clip, so it fits a content-box well
const RECESSED_FACE = 'linear-gradient(180deg, rgb(var(--color-edge-dark)) 0, rgb(var(--color-edge-dark)) 1px, rgb(0 0 0 / 0.4) 1px, rgb(0 0 0 / 0) 6px, rgb(0 0 0 / 0) calc(100% - 1px), rgb(var(--color-edge-light) / 0.22) calc(100% - 1px))'

// Elevation: the only drop shadows the recipe uses (each value matches what existing rules already used)
const ELEVATION = Object.freeze({
  raised: '0 2px 3px rgb(0 0 0 / 0.45)', // subtle raised surface: buttons
  panel: '3px 3px 6px rgb(0 0 0 / 0.5)', // equipment panel / framed object: cards, artwork
  overlay: '0 6px 16px rgb(0 0 0 / 0.55)' // prominent frame floating above the chassis: dialogs, menus
})

// Control states as complete declaration sets, for rules to reuse as-is
// Subtle key cap for an existing bare-glyph control: a bevelled steel face on the control's own box (no fill
// change, no size change); pressed inverts the bevel
const KEY_CAP = Object.freeze({ 'border-radius': RADIUS.key, 'background-image': STEEL_SHEEN, 'box-shadow': RAISED_BEVEL })
const KEY_CAP_PRESSED = Object.freeze({ 'background-image': 'none', 'box-shadow': PRESSED_BEVEL })
// Player key: the player's own transport and secondary keys (never the shared KEY_CAP surfaces). The face is darker
// than the deck it sits in: a translucent fill of the recessed token, so it follows the deck's own gradient instead
// of a fixed color. It is lit from the upper left by a soft sheen and edged in two steps: a lit/dark inner bevel with
// a faint second highlight line, and a dark outer ring (the channel the key sits in) with a short drop shadow. Every
// layer is background or shadow paint on the key's existing box, so size, position and hit area cannot change.
// Pressed: the sheen and drop shadow go, the ring stays, and the face is cut in (inverted bevel plus an inner shade).
// Phase 4B painted these sets on each key's own box; since Phase 4J the keys are fixed-size faces (below) built from the
// same sheen, bevel and ring layers, so no rule applies PLAYER_KEY itself any more: it stays the family's reference finish
const PLAYER_KEY_FACE = 'rgb(var(--color-recessed) / 0.5)'
// The collapsed player's deck is already close to the recessed color, so its face goes deeper to keep the same step
const PLAYER_KEY_FACE_MINI = 'rgb(var(--color-recessed) / 0.85)'
const PLAYER_KEY_SHEEN = 'linear-gradient(180deg, rgb(var(--color-edge-light) / 0.2) 0%, rgb(var(--color-edge-light) / 0) 45%, rgb(0 0 0 / 0.22) 100%)'
const PLAYER_KEY_RING = '0 0 0 1px rgb(var(--color-edge-dark))'
const PLAYER_KEY = Object.freeze({
  'border-radius': RADIUS.key,
  'background-color': PLAYER_KEY_FACE,
  'background-image': PLAYER_KEY_SHEEN,
  'box-shadow': `inset 1px 1px 0 rgb(var(--color-edge-light) / 0.6), inset 2px 2px 0 rgb(var(--color-edge-light) / 0.12), inset -1px -1px 0 rgb(var(--color-edge-dark)), ${PLAYER_KEY_RING}, 0 2px 3px rgb(0 0 0 / 0.5)`
})
const PLAYER_KEY_PRESSED = Object.freeze({
  'background-image': 'none',
  'box-shadow': `inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.3), inset 0 3px 6px rgb(0 0 0 / 0.55), ${PLAYER_KEY_RING}`
})
// Primary Play/Pause key (Phase 4H): the same dark equipment key as the player keys, made primary by its size and
// central position (the player's own 65px / 40px box), a stronger bezel and a deeper drop, not by a lighter face. The
// player sets the button's fill inline (surface.raised), so the darker face is a translucent recessed layer over that
// fill under the player-key sheen; the collapsed player's deck is already dark, so its face goes deeper. Bezel: the
// player key's lit/dark inner bevel with its faint second highlight, a 1px dark channel, a lit return ring outside it
// and a 0 3px 5px drop (player keys: 0 2px 3px). Squared on the key radius. Paint only, on the existing box.
// Pressed: sheen and drop shadow go, the face deepens, the bevel inverts with an inner shade; channel and ring stay
const PRIMARY_KEY_FACE = 'linear-gradient(rgb(var(--color-recessed) / 0.72), rgb(var(--color-recessed) / 0.72))'
const PRIMARY_KEY_FACE_MINI = 'linear-gradient(rgb(var(--color-recessed) / 0.85), rgb(var(--color-recessed) / 0.85))'
const PRIMARY_KEY_RING = `${PLAYER_KEY_RING}, 0 0 0 2px rgb(var(--color-edge-light) / 0.3)`
const PRIMARY_KEY = Object.freeze({
  'border-radius': RADIUS.key,
  'background-image': `${PLAYER_KEY_SHEEN}, ${PRIMARY_KEY_FACE}`,
  'box-shadow': `inset 1px 1px 0 rgb(var(--color-edge-light) / 0.6), inset 2px 2px 0 rgb(var(--color-edge-light) / 0.12), inset -1px -1px 0 rgb(var(--color-edge-dark)), ${PRIMARY_KEY_RING}, 0 3px 5px rgb(0 0 0 / 0.55)`
})
const PRIMARY_KEY_MINI = Object.freeze({ 'background-image': `${PLAYER_KEY_SHEEN}, ${PRIMARY_KEY_FACE_MINI}` })
const PRIMARY_KEY_PRESSED = Object.freeze({
  'background-image': 'linear-gradient(rgb(var(--color-recessed) / 0.86), rgb(var(--color-recessed) / 0.86))',
  'box-shadow': `inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.3), inset 0 3px 6px rgb(0 0 0 / 0.6), ${PRIMARY_KEY_RING}`
})
const PRIMARY_KEY_PRESSED_MINI = Object.freeze({ 'background-image': 'linear-gradient(rgb(var(--color-recessed) / 0.94), rgb(var(--color-recessed) / 0.94))' })
// Its legend (Play, Pause, the seek-pending glyph and the loading spinner alike) is the playback amber, solid and large:
// 2.8rem in the full player (from 2.1rem) and 1.875rem collapsed (from 1.5rem, the jump glyphs' size). The glyph size is
// the recipe's second authorized geometry (Phase 4H): it sizes the glyph inside the unchanged 65px / 40px box only
const PRIMARY_GLYPH_SIZE = Object.freeze({ full: Object.freeze({ 'font-size': '2.8rem' }), mini: Object.freeze({ 'font-size': '1.875rem' }) })
// Control legend: the played-progress amber, the illuminated legend of the deck's physical keys (transport and utility).
// LLAMA's equipment rule: amber = an illuminated physical-control legend, green = a readout or live display
const PLAYBACK_LEGEND = Object.freeze({ color: 'rgb(var(--color-track-cursor))' })
// Heavier playback glyphs. The bundled icon font has only a FILL axis (no weight axis, and FILL leaves these stroke
// glyphs unchanged), so the transport glyphs get a hairline stroke in their own color. It adds ink, never layout, and
// the utility keys stay at the font's regular weight, which keeps the transport legends the heavier tier
const PLAYBACK_GLYPH_WEIGHT = Object.freeze({ '-webkit-text-stroke': '0.5px currentColor' })

// --- Control deck (Phase 4J, recomposed in the Phase 4 finishing pass) ---
// Every secondary key's own box is its hardware: a fixed CSS px size, never content- or font-driven (the system font scale
// zooms legends, not px lengths), with the face painted on the element itself, so the visible key and its touch region are
// the same box at every font scale. (Phase 4J first drew enlarged faces as a ::before around glyph-sized boxes; the
// finishing pass replaced that with real boxes: no pseudo-element hit area, no stacking context, and a deck whose geometry
// no longer grows with the font scale.) The full player's five transport keys are packed and centered as one bank with
// one gap; the primary keeps its 65px box and sits a few px higher than the secondary keys' center line.
const DECK = Object.freeze({
  transport: Object.freeze({ width: 60, height: 60, gap: 8 }),
  primaryLift: 3,
  utility: Object.freeze({ width: 54, height: 52 }),
  // The seam between the transport and utility sections. The player puts the transport row's bottom edge (the seam) 78px
  // above the deck's bottom; the seam drops a few px inside the deck (the row grows by a bottom padding as its offset
  // shrinks by the same amount), so the bank keeps its place, its drop shadows clear the seam, and the deck keeps its height
  seam: Object.freeze({ base: 78, drop: 5 }),
  jumpGlyph: '2rem',
  mini: Object.freeze({ width: 34, height: 34 }),
  // Top chrome (collapse, cast, overflow): three utility-family keys on one line, 20px from the top
  chrome: Object.freeze({ width: 44, height: 44, top: 20 })
})
const keyBox = ({ width, height }) => Object.freeze({ width: `${width}px`, height: `${height}px`, flex: 'none', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'border-radius': RADIUS.key })
const KEY_BOX = Object.freeze({ transport: keyBox(DECK.transport), utility: keyBox(DECK.utility), mini: keyBox(DECK.mini) })
const TRANSPORT_BANK = Object.freeze({ 'justify-content': 'center', gap: `${DECK.transport.gap}px` })
const PRIMARY_IN_BANK = Object.freeze({ margin: '0', top: `-${DECK.primaryLift}px` })
const TRANSPORT_SECTION = Object.freeze({ bottom: `${DECK.seam.base - DECK.seam.drop}px`, 'padding-bottom': `${DECK.seam.drop}px` })
// The utility keys sit centered in the section under the seam (the odd px above them): no padding, the row's own offset
const UTILITY_SECTION_DEPTH = DECK.seam.base - DECK.seam.drop
const UTILITY_ROW = Object.freeze({ bottom: `${Math.floor((UTILITY_SECTION_DEPTH - DECK.utility.height) / 2)}px`, 'padding-top': '0px', 'padding-bottom': '0px' })
// Face finish, the Phase 4H primary key's family: the same dark recessed face, sheen and inner bevel (lit edge, faint second
// highlight, dark edge) and the same pressed model (sheen and drop go, the face deepens, the bevel inverts with an inner
// shade, the channel stays). Secondary transport is one step below the primary: a weaker lit return ring (0.18, primary
// 0.3) and a shorter drop (0 2px 4px, primary 0 3px 5px), on a smaller face
const KEY_FACE_BEVEL = 'inset 1px 1px 0 rgb(var(--color-edge-light) / 0.6), inset 2px 2px 0 rgb(var(--color-edge-light) / 0.12), inset -1px -1px 0 rgb(var(--color-edge-dark))'
const keyPressedBevel = (shade) => `inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.3), inset 0 3px 6px rgb(0 0 0 / ${shade})`
const TRANSPORT_KEY_RING = `${PLAYER_KEY_RING}, 0 0 0 2px rgb(var(--color-edge-light) / 0.18)`
const TRANSPORT_KEY = Object.freeze({
  'background-color': 'rgb(var(--color-recessed) / 0.66)',
  'background-image': PLAYER_KEY_SHEEN,
  'box-shadow': `${KEY_FACE_BEVEL}, ${TRANSPORT_KEY_RING}, 0 2px 4px rgb(0 0 0 / 0.5)`
})
const TRANSPORT_KEY_PRESSED = Object.freeze({ 'background-color': 'rgb(var(--color-recessed) / 0.84)', 'background-image': 'none', 'box-shadow': `${keyPressedBevel(0.6)}, ${TRANSPORT_KEY_RING}` })
// Collapsed player: its deck is already close to the recessed color, so the face goes deeper (as the primary's does)
const TRANSPORT_KEY_MINI = Object.freeze({ ...TRANSPORT_KEY, 'background-color': PLAYER_KEY_FACE_MINI })
const TRANSPORT_KEY_PRESSED_MINI = Object.freeze({ ...TRANSPORT_KEY_PRESSED, 'background-color': 'rgb(var(--color-recessed) / 0.94)' })
// Unavailable key: a sunken socket in the same place, unavailable by shape and luminance rather than color. A flat, darker
// face cut into the deck (dark inner edge, inner shade, a faint lit lip below), no raised bevel, ring or drop, and a
// strongly dimmed legend
const KEY_SOCKET = Object.freeze({
  'background-color': 'rgb(var(--color-recessed) / 0.4)',
  'background-image': 'none',
  'box-shadow': 'inset 0 0 0 1px rgb(var(--color-edge-dark)), inset 0 2px 4px rgb(0 0 0 / 0.5), 0 1px 0 rgb(var(--color-edge-light) / 0.14)'
})
const KEY_SOCKET_LEGEND = Object.freeze({ color: 'rgb(var(--color-fg) / 0.22)' })
// Utility keys (queue, bookmark, sleep, chapters): the same face family with a restrained bezel, the inner bevel and the dark
// channel only (no lit return) and the player keys' short drop, on a smaller face in the row below. Their legends are the
// deck's illuminated amber, like the transport keys' (the tiers differ by size, bezel and row, and the transport glyphs are
// heavier), at the font's regular weight; never the success green, which is the readouts'
const UTILITY_KEY = Object.freeze({
  'background-color': 'rgb(var(--color-recessed) / 0.6)',
  'background-image': PLAYER_KEY_SHEEN,
  'box-shadow': `${KEY_FACE_BEVEL}, ${PLAYER_KEY_RING}, 0 2px 3px rgb(0 0 0 / 0.5)`
})
const UTILITY_KEY_PRESSED = Object.freeze({ 'background-color': 'rgb(var(--color-recessed) / 0.8)', 'background-image': 'none', 'box-shadow': `${keyPressedBevel(0.55)}, ${PLAYER_KEY_RING}` })
const UTILITY_LEGEND = Object.freeze({ ...PLAYBACK_LEGEND })
// The top chrome (navigation and menus, not deck controls) keeps a neutral legend, the primary text at 0.8
const CHROME_LEGEND = Object.freeze({ color: 'rgb(var(--color-fg) / 0.8)' })
// Top player chrome: collapse, cast and the overflow menu are neutral utility-family keys of one fixed size, aligned on one
// line (their containers sit 16px and 24px down, so each key is shifted onto the line by a margin), with a 2rem glyph that
// stays inside the key at font scale 1.3. The click stays on the same element, now the whole key: collapse goes from its
// 48px glyph box to the 44px key, cast and overflow grow from 30px (39px at 1.3). Cast keeps its slot (64px from the right
// edge), 4px from the overflow key, so the landscape metadata readout still ends before it (Phase 4E-R2: 111px from the
// right edge, plate 4px, cast face 108px). The playback method (Direct/Local/Transcode) is a small recessed green display
// centered on the same line
const CHROME_KEY = Object.freeze({ ...keyBox(DECK.chrome), ...UTILITY_KEY, ...CHROME_LEGEND, 'font-size': '2rem' })
const CHROME_KEY_LINE = Object.freeze({ collapse: Object.freeze({ 'margin-top': `${DECK.chrome.top - 16}px` }), right: Object.freeze({ 'margin-top': `${DECK.chrome.top - 24}px` }) })
const PLAYBACK_METHOD_READOUT = Object.freeze({
  width: 'fit-content',
  padding: '4px 10px',
  top: `${DECK.chrome.top + DECK.chrome.height / 2 - 11.5}px`,
  'border-radius': RADIUS.key,
  'background-color': 'rgb(var(--color-recessed))',
  'box-shadow': `${RECESSED_WELL}, 0 0 0 1px rgb(var(--color-edge-dark)), 0 1px 0 1px rgb(var(--color-edge-light) / 0.2)`,
  color: 'rgb(var(--color-accent))'
})
// The queue key's "Q" badge sits in the key's lower-right corner, 3px inside it (it used to hang off the glyph box's
// corner), with a thin dark ring that seats it on the face. Same 14px badge
const QUEUE_BADGE = Object.freeze({ bottom: '3px', right: '3px', 'box-shadow': '0 0 0 1px rgb(var(--color-edge-dark))' })
// Readouts in the secondary row (speed, running sleep countdown): information, not keys. Each is a recessed display on its
// own box, the utility keys' height (never a raised face, never amber), with the phosphor green text inside. Its width
// follows its value (and the font scale) from a utility key's width up, and it keeps its own click
const READOUT_BOX = Object.freeze({
  display: 'inline-flex',
  'align-items': 'center',
  'justify-content': 'center',
  height: `${DECK.utility.height}px`,
  'min-width': `${DECK.utility.width}px`,
  width: 'auto',
  padding: '0 10px',
  'line-height': '1',
  'border-radius': RADIUS.key,
  'background-color': 'rgb(var(--color-recessed))',
  'box-shadow': `${RECESSED_WELL}, 0 0 0 1px rgb(var(--color-edge-dark)), 0 1px 0 1px rgb(var(--color-edge-light) / 0.2)`
})
// Transport legends, sized for the 60px keys. The jump arrow is 2rem (from 1.875rem) and sits 2px lower so the arrow and its
// bold dynamic duration are centered as one legend (a transform, so nothing moves): at font scale 1.3 the legend is
// 31.6x51.8 and 4.1px from the top and bottom of the key, at 1.0 24.4x40. The chapter steps' glyph is 2.25rem (from 2rem):
// safe now that the key's box is fixed (the glyph box no longer sizes the key). The collapsed jumps' arrow is drawn at a
// fixed 0.78 scale, 1px lower, so it stays inside its 34x34 key at font scale 1.3 (the WebView's text zoom multiplies
// every computed font size, so a legend cannot be capped by font size)
const JUMP_GLYPH = Object.freeze({ 'font-size': DECK.jumpGlyph, transform: 'translateY(2px)' })
const JUMP_DURATION = Object.freeze({ 'font-weight': '700' })
const CHAPTER_GLYPH = Object.freeze({ 'font-size': '2.25rem' })
const MINI_JUMP_GLYPH = Object.freeze({ transform: 'translateY(1px) scale(0.78)' })
// Selected equipment key: pressed in (inset bevel and inner shade, so it reads as a different physical state,
// not just a color) with an accent ring inside the edge
const SELECTED_KEY = Object.freeze({
  'background-image': 'none',
  'box-shadow': `inset 0 0 0 1px rgb(var(--color-accent) / 0.9), ${PRESSED_BEVEL}, inset 0 2px 5px rgb(0 0 0 / 0.45)`
})

// Current playback entry in a list (Up Next, bookmarks): a 2px amber edge along the left inside the row, the
// same played-progress amber and width as Chapters' current-chapter marker, without adding an element
const CURRENT_MARKER = 'inset 2px 0 0 rgb(var(--color-track-cursor))'
// Slot and thumb edges, the same values as the player's seek channel and seek thumb
const INSET_SLOT = 'inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.3)'
const THUMB_EDGE = '0 0 0 1px rgb(var(--color-edge-dark)), 0 1px 2px rgb(0 0 0 / 0.6)'

// Full-player metadata readout (Phase 4E): the title/author block becomes a recessed display mounted in a bezel plate
// on the chassis. The well is the shared recessed well; the plate (deck color, lit upper-left lip, dark lower-right
// lip, soft drop) is drawn with outer shadows, so it sits around the box and adds no layout. The seek well has no
// plate, which keeps the two displays related but distinct. Text colors are not touched: title and author stay neutral
const METADATA_READOUT = Object.freeze({
  'background-color': 'rgb(var(--color-recessed))',
  'border-radius': RADIUS.key,
  'box-shadow': `${RECESSED_WELL}, 0 0 0 1px rgb(var(--color-edge-dark)), 0 0 0 3px rgb(var(--color-bg)), -1px -1px 0 3px rgb(var(--color-edge-light) / 0.35), 1px 1px 0 3px rgb(var(--color-edge-dark)), 0 3px 8px 3px rgb(0 0 0 / 0.4)`
})
// The one authorized geometry in the recipe (Phase 4E, LLAMA full player only): the readout spans the seek wells'
// column (24px gutters), gets an inner inset, and sits 22px lower in the free band above the deck so that it can grow
// without reaching the artwork. Bottom-anchored like the original block (the same property, so the expand/collapse
// transition is kept). Its floor keeps the plate clear of the 200px deck (plate 4px + 6px of chassis): portrait never
// reaches it (the band leaves at least 28px), but in landscape the block sits beside the artwork right on the deck and
// would otherwise cover the seek timestamps. With the total-track display shown, the readout also stays clear of it
const READOUT_ANCHOR = 'calc(50% - var(--cover-image-height) / 2 + 28px)'
const METADATA_READOUT_LAYOUT = Object.freeze({
  left: '24px',
  width: 'calc(100% - 48px)',
  padding: '6px 12px',
  bottom: `max(${READOUT_ANCHOR}, 210px)`
})
// Clearance over the total-track display on screens too short for the anchor alone: its 215px offset plus its height at
// the default font scale (a 19.2px timestamp line and the 4px channel), plus 10px (the plate's 4px and 6px of chassis).
// A px value: the system font scale zooms text in the WebView but not rem/em lengths, so CSS cannot follow the line's
// growth; on the 842px-tall reference screen the anchor already clears it at font scale 1.3
const METADATA_READOUT_ABOVE_TOTAL_TRACK = Object.freeze({ bottom: `max(${READOUT_ANCHOR}, 249px)` })
// Short portrait screens with the total-track display (Phase 4E-R1). Below about 792px the artwork is height-limited, so
// its bottom (and its 2px frame) sits a fixed 320px above the viewport bottom, and the total-track display's top is at
// 244px at font scale 1.3: a 76px band that cannot hold the readout plus its plate (the overlap appears below ~825px).
// There the readout keeps its well, column and side plate but loses the plate's vertical extent: a 1px seam all round,
// the plate and its lips as side rails only, and the vertical inset replaced by a fixed band height with the text
// centered in it. The band height leaves 3px of chassis under the artwork frame (320 - 2 - 3 - 1 - 247 = 67px; capped
// at 70px between 792 and 824px), and its bottom sits 2px plus the seam above the total-track display at font scale
// 1.3. Text larger than the band grows the box upward rather than being clipped. Font scale is not visible to CSS, so
// font scale 1.0 gets the same band, with more room around the text
const METADATA_READOUT_COMPACT_QUERY = '(orientation: portrait) and (max-height: 824px)'
const METADATA_READOUT_COMPACT = Object.freeze({
  'box-shadow': `${RECESSED_WELL}, 0 0 0 1px rgb(var(--color-edge-dark)), -4px 0 0 0 rgb(var(--color-bg)), 4px 0 0 0 rgb(var(--color-bg)), -5px 0 0 0 rgb(var(--color-edge-light) / 0.35), 5px 0 0 0 rgb(var(--color-edge-dark)), 0 2px 4px rgb(0 0 0 / 0.4)`,
  display: 'flex',
  'flex-direction': 'column',
  'justify-content': 'center',
  padding: '0 12px',
  bottom: '247px',
  'min-height': 'min(calc(50% - var(--cover-image-height) / 2 - 133px), 70px)'
})
// Landscape with the total-track display (Phase 4E-R2). The block sits in the right half (the player's own landscape
// rule: left 50%, width 50%, both !important), between the top-bar controls and the total-track display. At font scale
// 1.3 the band under the cast and overflow controls (63px down) and above the total-track display (120px down) is 57px,
// less than the text alone (62px), so the readout cannot go below them; it stays where the 249px floor puts it and ends
// before them instead. max-width still limits the !important width: the cast control's 64px right offset plus its width
// at font scale 1.3 (39px), the 4px plate and 4px of chassis leave the readout 111px short of the right edge, and a 24px
// margin aligns its left edge with the seek well (50% - 24px - 111px). Vertical placement and paint are unchanged
const METADATA_READOUT_LANDSCAPE_QUERY = '(orientation: landscape)'
const METADATA_READOUT_LANDSCAPE = Object.freeze({ 'margin-left': '24px', 'max-width': 'calc(50% - 135px)' })

// Phase 6B faceplate paint. The geometry (module budgets, artwork size, the plates' boxes) is theme/playerLayout.js and
// the player's own stylesheet; the recipe only paints the hook classes and plates the layout projection adds.
// A module plate is raised hardware the readouts and keys sit in: the deck color with the chassis sheen, the raised
// bevel, a dark seam around it and the panel drop
const FACEPLATE_PLATE = Object.freeze({
  'background-color': 'rgb(var(--color-bg))',
  'background-image': CHASSIS_SHEEN,
  'border-radius': RADIUS.key,
  'box-shadow': `${RAISED_BEVEL}, 0 0 0 1px rgb(var(--color-edge-dark)), 0 3px 8px rgb(0 0 0 / 0.45)`
})
// The top chrome plate carries navigation, not equipment: a quieter lit edge
const FACEPLATE_TOP_PLATE = Object.freeze({
  'box-shadow': 'inset 1px 1px 0 rgb(var(--color-edge-light) / 0.4), inset -1px -1px 0 rgb(var(--color-edge-dark)), 0 0 0 1px rgb(var(--color-edge-dark)), 0 3px 8px rgb(0 0 0 / 0.45)'
})
// Artwork bay: a bezel drawn outside the artwork with spread shadows only (no layout, no crop): a dark seam at the art,
// the deck-colored bezel with a lit upper-left lip and a dark lower-right lip, a dark outer ring and a soft drop. Its
// width is the layout tier's (playerLayout.TIERS), which also reserves the room for it
const artworkBay = (n) =>
  Object.freeze({
    'box-shadow': `0 0 0 1px rgb(var(--color-edge-dark)), 0 0 0 ${n}px rgb(var(--color-bg)), -1px -1px 0 ${n}px rgb(var(--color-edge-light) / 0.45), 1px 1px 0 ${n}px rgb(var(--color-edge-dark)), 0 0 0 ${n + playerLayout.FACEPLATE.bezelRing}px rgb(var(--color-edge-dark) / 0.9), 0 4px 10px ${n}px rgb(0 0 0 / 0.45)`
  })
const ARTWORK_BAY = Object.freeze({ regular: artworkBay(playerLayout.TIERS.regular.bezel), compact: artworkBay(playerLayout.TIERS.compact.bezel) })
// The deck becomes chassis behind its console plate: no panel paint of its own
const FACEPLATE_DECK = Object.freeze({ 'background-color': 'rgb(var(--color-primary))', 'background-image': 'none', 'box-shadow': 'none' })
// Console banks centered in their framed sections (Phase 6B S26 correction). The console plate's top edge is
// playerLayout.FACEPLATE.console above the deck bottom and its bottom edge FACEPLATE.consoleInset above it; the engraved
// divider stays where the deck puts it (the transport section's bottom, DECK.seam). The rows had kept the offsets they
// had in the full-height panel, so both sat low inside the plate. Now each bank box is exactly its section, with its row
// centered: the transport row by its key envelope (from the lifted primary's top to the secondary keys' bottom: the 65px
// primary box, lifted DECK.primaryLift, and the 60px keys centered in it), the utility row by its keys. Key boxes, their
// horizontal layout and the divider are unchanged
const FACEPLATE_DIVIDER = DECK.seam.base - DECK.seam.drop
const PRIMARY_KEY_BOX = 65 // the full player's Play/Pause box (AudioPlayer.vue, unchanged)
const FACEPLATE_TRANSPORT_BANK = Object.freeze({
  height: `${playerLayout.FACEPLATE.console - FACEPLATE_DIVIDER}px`,
  'padding-top': `${DECK.primaryLift + (PRIMARY_KEY_BOX - DECK.transport.height) / 2}px`,
  'padding-bottom': '0px',
  display: 'flex',
  'flex-direction': 'column',
  'justify-content': 'center'
})
// Chapter + book progress (two rails): the two rows are one recessed well split by an engraved seam. The upper (book)
// section carries the well's top lip and the seam's dark line at its bottom; the lower (chapter) section carries the
// seam's faint light line at its top and the well's bottom lip. The seam uses ENGRAVED_SEPARATOR's two colors, and the
// lips RECESSED_FACE's, so the pair reads as one display with an internal division. Paint only (background layers on the
// content box, as RECESSED_FACE)
const DUAL_TRACK_UPPER = Object.freeze({
  'background-image': 'linear-gradient(180deg, rgb(var(--color-edge-dark)) 0, rgb(var(--color-edge-dark)) 1px, rgb(0 0 0 / 0.4) 1px, rgb(0 0 0 / 0) 6px, rgb(0 0 0 / 0) calc(100% - 1px), rgb(var(--color-edge-dark)) calc(100% - 1px))',
  'border-radius': RADIUS.key,
  'border-bottom-left-radius': RADIUS.none,
  'border-bottom-right-radius': RADIUS.none
})
const DUAL_TRACK_LOWER = Object.freeze({
  'background-image': 'linear-gradient(180deg, rgb(var(--color-edge-light) / 0.12) 0, rgb(var(--color-edge-light) / 0.12) 1px, rgb(0 0 0 / 0) 1px, rgb(0 0 0 / 0) calc(100% - 1px), rgb(var(--color-edge-light) / 0.22) calc(100% - 1px))',
  'border-radius': RADIUS.key,
  'border-top-left-radius': RADIUS.none,
  'border-top-right-radius': RADIUS.none
})
const FACEPLATE_UTILITY_BANK = Object.freeze({
  bottom: `${playerLayout.FACEPLATE.consoleInset}px`,
  height: `${FACEPLATE_DIVIDER - playerLayout.FACEPLATE.consoleInset}px`,
  display: 'flex',
  'flex-direction': 'column',
  'justify-content': 'center'
})

// Collapsed mini-player (Phase 7B, Candidate B): the full player's type and readout language at the mini's fixed 120px,
// with no geometry. Metadata and times take the condensed system face (no font asset) the faceplate uses; the metadata
// stays neutral. The times grow to 14px on the same line box (14px x 1.3714286 = the previous 12.8px x 1.5 = 19.2px, and
// 24.96px at font scale 1.3), so the time row, rail and every offset keep their bounds
const CONDENSED_FACE = 'sans-serif-condensed, sans-serif'
const MINI_TITLE_TYPE = Object.freeze({ 'font-family': CONDENSED_FACE, 'letter-spacing': '0.01em' })
const MINI_AUTHOR_TYPE = Object.freeze({ 'font-family': CONDENSED_FACE, 'letter-spacing': '0.02em' })
const MINI_TIME_TYPE = Object.freeze({ 'font-family': CONDENSED_FACE, 'font-size': '0.875rem', 'line-height': '1.3714286', 'font-variant-numeric': 'tabular-nums', 'letter-spacing': '0.02em' })
// The times and rail as one recessed readout strip across the panel: the seek row's own box gets the recessed face with
// a shaded top edge (in place of the engraved seam, at the same line), and two offset shadows of that box carry the face
// 6px below the rail and end it with a lit line. Shadows are paint outside the box, so nothing moves and nothing gains a
// hit area. Full width, so it has no side edges or corners to meet the artwork, which at font scale 1.3 sits only ~2px
// above the row: an inset well there would land on the artwork
const MINI_READOUT_STRIP = Object.freeze({
  'background-color': 'rgb(var(--color-recessed))',
  'background-image': 'linear-gradient(180deg, rgb(var(--color-edge-dark)) 0, rgb(var(--color-edge-dark)) 1px, rgb(0 0 0 / 0.4) 1px, rgb(0 0 0 / 0) 6px)',
  'box-shadow': '0 6px 0 0 rgb(var(--color-recessed)), 0 7px 0 0 rgb(var(--color-edge-light) / 0.22)'
})
// The mini artwork keeps its frame and gains a soft mount shadow: no bezel, ring or size change
const MINI_ARTWORK_MOUNT = Object.freeze({ 'box-shadow': `${ARTWORK_FRAME}, 0 2px 4px 2px rgb(0 0 0 / 0.45)` })

// Browsing chrome (Phase 8B, Candidate B of the Phase 8A audit): the content environment around the frozen players takes
// their language in restrained form. Paint and type only; every box keeps its geometry.
// Navigation strip: the content chassis (base surface, chassis sheen, faint lit top lip, dark seam below) instead of the
// brighter steel strip, so the app bar, navigation and content read as one chassis
const BROWSE_NAV_CHASSIS = Object.freeze({
  'background-color': 'rgb(var(--color-bg))',
  'background-image': CHASSIS_SHEEN,
  'box-shadow': 'inset 0 1px 0 rgb(var(--color-edge-light) / 0.18), inset 0 -1px 0 rgb(var(--color-edge-dark))'
})
// Selected tab: a recessed dark key (the players' key language) pressed into the strip; it keeps the accent underline
// and its text label (unselected tabs show an icon), so the state never reads by color alone
const BROWSE_NAV_SELECTED = Object.freeze({
  'background-color': 'rgb(var(--color-recessed))',
  'background-image': RECESSED_FACE,
  'box-shadow': `${PRESSED_BEVEL}, inset 0 -2px 0 rgb(var(--color-accent))`
})
// Section labels (shelf headings, search result groups): the condensed system face, neutral, same size and weight
const SECTION_LABEL_TYPE = Object.freeze({ 'font-family': CONDENSED_FACE, 'letter-spacing': '0.03em' })
// Shelf heading rule: an engraved line (dark seam over a faint lit return) painted by the heading band's own background,
// 6px above the band's bottom edge (so 6px above the artwork) and inset 20px, the band's own text inset
const SHELF_HEADING_RULE = Object.freeze({
  'background-image': `linear-gradient(rgb(var(--color-edge-dark)), rgb(var(--color-edge-dark))), linear-gradient(rgb(var(--color-edge-light) / 0.14), rgb(var(--color-edge-light) / 0.14))`,
  'background-size': 'calc(100% - 40px) 1px, calc(100% - 40px) 1px',
  'background-position': '20px calc(100% - 6px), 20px calc(100% - 5px)',
  'background-repeat': 'no-repeat'
})
// Toolbar item count: condensed with tabular figures, neutral (a count is not a live readout)
const COUNT_TYPE = Object.freeze({ 'font-family': CONDENSED_FACE, 'letter-spacing': '0.02em', 'font-variant-numeric': 'tabular-nums' })
// List-row play button: the mini-player's key face (dark, sheened, squared, ring and drop) on the button's own box, with
// the playback amber legend
const LIST_PLAY_KEY = Object.freeze({ ...TRANSPORT_KEY_MINI, 'border-radius': RADIUS.key })
const LIST_PLAY_LEGEND = PLAYBACK_LEGEND

const PRIMITIVES = Object.freeze({
  RADIUS,
  ELEVATION,
  RAISED_BEVEL,
  PRESSED_BEVEL,
  RECESSED_WELL,
  STEEL_SHEEN,
  CHASSIS_SHEEN,
  ARTWORK_FRAME,
  ENGRAVED_SEPARATOR,
  ENGRAVED_SEPARATOR_TOP,
  RECESSED_FACE,
  KEY_CAP,
  KEY_CAP_PRESSED,
  SELECTED_KEY,
  PLAYER_KEY,
  PLAYER_KEY_PRESSED,
  PRIMARY_KEY,
  PRIMARY_KEY_MINI,
  PRIMARY_KEY_PRESSED,
  PRIMARY_KEY_PRESSED_MINI,
  PRIMARY_GLYPH_SIZE,
  PLAYER_KEY_FACE_MINI,
  PLAYBACK_LEGEND,
  PLAYBACK_GLYPH_WEIGHT,
  DECK,
  KEY_BOX,
  TRANSPORT_BANK,
  PRIMARY_IN_BANK,
  UTILITY_ROW,
  TRANSPORT_SECTION,
  CHROME_KEY,
  CHROME_KEY_LINE,
  PLAYBACK_METHOD_READOUT,
  TRANSPORT_KEY,
  TRANSPORT_KEY_PRESSED,
  KEY_SOCKET,
  KEY_SOCKET_LEGEND,
  JUMP_GLYPH,
  JUMP_DURATION,
  UTILITY_KEY,
  UTILITY_KEY_PRESSED,
  UTILITY_LEGEND,
  CHROME_LEGEND,
  QUEUE_BADGE,
  READOUT_BOX,
  CHAPTER_GLYPH,
  TRANSPORT_KEY_MINI,
  TRANSPORT_KEY_PRESSED_MINI,
  MINI_JUMP_GLYPH,
  METADATA_READOUT,
  METADATA_READOUT_LAYOUT,
  METADATA_READOUT_ABOVE_TOTAL_TRACK,
  METADATA_READOUT_COMPACT,
  METADATA_READOUT_LANDSCAPE,
  FACEPLATE_PLATE,
  FACEPLATE_TOP_PLATE,
  ARTWORK_BAY,
  FACEPLATE_DECK,
  FACEPLATE_DIVIDER,
  PRIMARY_KEY_BOX,
  FACEPLATE_TRANSPORT_BANK,
  FACEPLATE_UTILITY_BANK,
  DUAL_TRACK_UPPER,
  DUAL_TRACK_LOWER,
  CONDENSED_FACE,
  MINI_TITLE_TYPE,
  MINI_AUTHOR_TYPE,
  MINI_TIME_TYPE,
  MINI_READOUT_STRIP,
  MINI_ARTWORK_MOUNT,
  BROWSE_NAV_CHASSIS,
  BROWSE_NAV_SELECTED,
  SECTION_LABEL_TYPE,
  SHELF_HEADING_RULE,
  COUNT_TYPE,
  LIST_PLAY_KEY,
  LIST_PLAY_LEGEND
})

const EQUIPMENT_RULES = [
  // Navigation chrome: bevelled chassis strips
  ['#appbar', { 'background-image': CHASSIS_SHEEN, 'box-shadow': `${RAISED_BEVEL}, 0 1px 0 rgb(var(--color-edge-dark))` }],
  // Navigation strip: the content chassis (Phase 8B; it was a steel strip, the brightest surface in the top chrome)
  ['#bookshelf-navbar', BROWSE_NAV_CHASSIS],
  // Selected navigation tab: a recessed dark key pressed into the strip (Phase 8B), keeping its accent underline and its
  // text label, so the state never reads by color alone
  // (BookshelfNavBar binds bg-primary on the active tab; runtime-only router classes would be pruned by Tailwind)
  ['#bookshelf-navbar a.bg-primary', BROWSE_NAV_SELECTED],

  // Buttons: steel sheen over the existing (semantic) button color, raised; pressed = inset
  ['.btn:not(:disabled)', { 'background-image': STEEL_SHEEN, 'box-shadow': `${RAISED_BEVEL}, ${ELEVATION.raised}` }],
  ['.btn:not(:disabled):active', KEY_CAP_PRESSED],
  // Only the bordered icon buttons (IconBtn/ReadIconBtn add `border` unless borderless) are steel keys;
  // borderless icon buttons are intentionally bare glyphs and stay that way
  ['.icon-btn.border:not(:disabled)', { 'background-image': STEEL_SHEEN, 'box-shadow': RAISED_BEVEL }],
  ['.icon-btn.border:not(:disabled):active', KEY_CAP_PRESSED],
  // Destructive key glyph: LLAMA's near-white text on the sheened error fill is 2.80:1; pure white keeps the
  // icon above the 3:1 non-text minimum (Gate H, measured 3.2:1)
  ['.icon-btn.border.bg-error:not(:disabled) > .material-symbols', { color: 'rgb(255 255 255)' }],

  // Text fields and selects: recessed display wells
  ['input:not([type=range]):not([type=checkbox]):not([type=radio])', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': RECESSED_WELL }],
  ['textarea', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': RECESSED_WELL }],

  // Dialog / menu panels: raised chassis
  ['.modal .rounded-lg.bg-primary', { 'background-image': CHASSIS_SHEEN, 'box-shadow': `${RAISED_BEVEL}, ${ELEVATION.overlay}` }],
  // Up Next list: a recessed playlist well inside the chassis
  ['.modal .queue-panel.rounded-lg.bg-primary', { 'background-color': 'rgb(var(--color-recessed))', 'background-image': 'none', 'box-shadow': `${RECESSED_WELL}, ${ELEVATION.overlay}` }],
  // Chapters list: the same recessed well under a blue-gray chassis header strip (ChaptersModal hook class)
  ['.modal .chapters-panel.bg-secondary', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': `${RECESSED_WELL}, ${ELEVATION.overlay}` }],
  ['.modal .chapters-panel > .sticky.bg-secondary', { 'background-image': CHASSIS_SHEEN, 'box-shadow': `${RAISED_BEVEL}, 0 1px 0 rgb(var(--color-edge-dark))` }],
  ['.modal .chapters-panel > .sticky.bg-secondary.shadow-md', { 'box-shadow': `${RAISED_BEVEL}, 0 1px 0 rgb(var(--color-edge-dark)), 0 4px 8px rgb(0 0 0 / 0.5)` }],
  ['.modal .chapters-panel > .sticky p.text-fg-muted', { color: 'rgb(var(--color-fg) / 0.85)' }],
  // Current chapter: a lit row on the dark well (the amber marker stays)
  ['.modal .chapters-panel li.bg-primary', { 'background-color': 'rgb(var(--color-bg))' }],
  // Current-chapter marker: the same played-progress amber as the seek bar (same element, size and position)
  ['.modal .chapters-panel li > .bg-yellow-400', { 'background-color': 'rgb(var(--color-track-cursor))' }],

  // --- Player-adjacent overlays (Gate C): Up Next, playback speed, sleep timer, bookmarks ---
  // Hierarchy: raised chassis panel (the existing dialog rule) > recessed list well > engraved row seams >
  // current/selected state. Rows stay flat display entries, never a stack of keys.
  // Up Next: the Now Playing block is the lit current entry, matching Chapters' current row (lit + amber
  // left marker), pressed in so it reads by shape as well as color; its divider becomes an engraved seam
  ['.modal .queue-panel .queue-current', { 'background-color': 'rgb(var(--color-bg))', 'border-color': 'rgb(var(--color-edge-dark))', 'box-shadow': `${CURRENT_MARKER}, ${PRESSED_BEVEL}, inset 0 -1px 0 rgb(var(--color-edge-light) / 0.12)` }],
  ['.modal .queue-panel .queue-row:not(:last-child)', { 'box-shadow': ENGRAVED_SEPARATOR }],
  // Speed and sleep option lists: a recessed well inside the chassis panel, seamed rows, and the selected
  // speed as a selected equipment key (pressed in, accent ring) on a lit row instead of a flat wash
  ['.modal .playback-option-panel ul[role=listbox]', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': RECESSED_WELL }],
  ['.modal .playback-option-panel li[role=option]:not(:last-child)', { 'box-shadow': ENGRAVED_SEPARATOR }],
  ['.modal .playback-option-panel li[role=option].option-selected', { 'background-color': 'rgb(var(--color-bg))', ...SELECTED_KEY }],
  // Speed stepper strip: a raised chassis strip under the well; its steppers are equipment keys
  ['.modal .playback-option-panel .option-panel-footer', { 'background-image': CHASSIS_SHEEN, 'border-color': 'rgb(var(--color-edge-dark))', 'box-shadow': RAISED_BEVEL }],
  ['.modal .playback-option-panel .icon-num-btn:not(:disabled)', KEY_CAP],
  ['.modal .playback-option-panel .icon-num-btn:not(:disabled):active', KEY_CAP_PRESSED],
  // Live readouts in these overlays: the current speed and the running sleep countdown
  ['.modal .speed-readout', { color: 'rgb(var(--color-accent))' }],
  ['.modal .sleep-readout', { color: 'rgb(var(--color-accent))' }],
  // Bookmarks: recessed list with seamed rows; the bookmark at the current position is a lit, pressed entry
  // with the amber position marker, and its icon is amber (current position), not success green
  ['.modal .bookmarks-list', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': RECESSED_WELL }],
  ['.modal .bookmark-row:not(:last-child)', { 'box-shadow': ENGRAVED_SEPARATOR }],
  ['.modal .bookmark-row.bookmark-current', { 'background-color': 'rgb(var(--color-bg))', 'box-shadow': `${CURRENT_MARKER}, ${PRESSED_BEVEL}` }],
  ['.modal .bookmark-current .bookmark-icon', { color: 'rgb(var(--color-track-cursor))' }],

  // Side drawer: chassis edge facing the page
  ['.layout-wrapper .w-64.bg-bg', { 'background-image': CHASSIS_SHEEN, 'box-shadow': 'inset 1px 0 0 rgb(var(--color-edge-light) / 0.45), -2px 0 8px rgb(0 0 0 / 0.5)' }],

  // Artwork: thin outer frame (outside the image, so the artwork stays fully visible and unresized).
  // Card artwork is marked by the `card-artwork` hook: the grid card itself (it is the cover) and, in list
  // rows, only the cover box, never the whole row
  ['.cover-wrapper', { 'box-shadow': ARTWORK_FRAME, 'border-radius': RADIUS.frame }],
  ['.card-artwork', { 'box-shadow': `${ARTWORK_FRAME}, ${ELEVATION.panel}` }],

  // Player artwork uses the squared frame radius above (mini 3px, fullscreen 16px before); same box, crop and
  // aspect ratio. Fullscreen artwork sits mounted on the chassis like card artwork
  ['.fullscreen .cover-wrapper', { 'box-shadow': `${ARTWORK_FRAME}, ${ELEVATION.panel}` }],
  // Fullscreen transport deck: the existing bottom player panel becomes a raised chassis panel (sheen, light
  // top edge, dark seam above it against the artwork zone). Same box; the controls inside are untouched
  ['.fullscreen #playerContent', { 'background-color': 'rgb(var(--color-bg))', 'background-image': CHASSIS_SHEEN, 'box-shadow': `${RAISED_BEVEL}, 0 -1px 0 rgb(var(--color-edge-dark))` }],
  // Phase 6B faceplate (theme/playerLayout.js): the decorative plates, the artwork bay and the deck as chassis. These
  // selectors only match the hook classes and plate elements the layout projection adds to the full player
  ['.player-plate', FACEPLATE_PLATE],
  ['.player-plate-top', FACEPLATE_TOP_PLATE],
  ['#streamContainer.faceplate .cover-wrapper', ARTWORK_BAY.regular],
  ['#streamContainer.faceplate-compact .cover-wrapper', ARTWORK_BAY.compact],
  ['#streamContainer.faceplate #playerContent', FACEPLATE_DECK],
  ['#streamContainer.faceplate-flat #playerContent', FACEPLATE_DECK],
  // ...and each console bank centered in its section. The utility section (divider to plate bottom) is the same on every
  // plate path; the transport has its own section only on the faceplate (on the previous-geometry paths the console plate
  // runs up around the seek row, so the transport keeps its place)
  ['#streamContainer.fullscreen.faceplate #playerControls', FACEPLATE_TRANSPORT_BANK],
  ['#streamContainer.fullscreen.faceplate #playerContent .utility-row', FACEPLATE_UTILITY_BANK],
  ['#streamContainer.fullscreen.faceplate-flat #playerContent .utility-row', FACEPLATE_UTILITY_BANK],
  // Chapter + book progress (two rails): one dual-track instrument above the console (theme/playerLayout.js places it);
  // the deck is chassis, the two rows one recessed well with an engraved seam, the utility bank centered as above
  ['#streamContainer.faceplate-dual #playerContent', FACEPLATE_DECK],
  ['#streamContainer.faceplate-dual .total-track', DUAL_TRACK_UPPER],
  ['#streamContainer.faceplate-dual #playerTrack', DUAL_TRACK_LOWER],
  ['#streamContainer.fullscreen.faceplate-dual #playerContent .utility-row', FACEPLATE_UTILITY_BANK],
  // Panel seam between the primary transport row and the secondary control row
  ['.fullscreen #playerControls', { 'box-shadow': ENGRAVED_SEPARATOR }],
  // Mini-player: the seek region is a recessed readout strip across the panel (Phase 7B; it replaces the engraved seam
  // that was drawn at its top edge)
  ['#streamContainer:not(.fullscreen) #playerTrack', MINI_READOUT_STRIP],
  // Control deck (Phase 4J, recomposed in the finishing pass): every secondary key's own fixed box is its face, painted
  // in the primary key's family; pressed cuts it in, an unavailable key is a sunken socket with a strongly dimmed legend.
  // Full-player transport: chapter start/end and both jumps, packed with the primary into one centered bank
  // The transport section reaches a few px further down (the seam under it drops; the bank stays where it is)
  ['#streamContainer.fullscreen #playerControls', TRANSPORT_SECTION],
  ['.fullscreen #playerControls > div', TRANSPORT_BANK],
  ['.fullscreen #playerControls .play-btn', PRIMARY_IN_BANK],
  ['.fullscreen #playerControls .player-key', { ...KEY_BOX.transport, ...TRANSPORT_KEY }],
  ['.fullscreen #playerControls .player-key:not(.key-disabled):active', TRANSPORT_KEY_PRESSED],
  ['.fullscreen #playerControls .player-key.key-disabled', { ...KEY_SOCKET, ...KEY_SOCKET_LEGEND }],
  ['.fullscreen #playerControls .jump-icon > .material-symbols', JUMP_GLYPH],
  ['.fullscreen #playerControls .jump-label', JUMP_DURATION],
  ['.fullscreen #playerControls .next-icon', CHAPTER_GLYPH],
  // Collapsed player transport: both jumps, deeper face on the darker deck
  ['#streamContainer:not(.fullscreen) #playerControls .player-key', { ...KEY_BOX.mini, ...TRANSPORT_KEY_MINI }],
  ['#streamContainer:not(.fullscreen) #playerControls .player-key:not(.key-disabled):active', TRANSPORT_KEY_PRESSED_MINI],
  ['#streamContainer:not(.fullscreen) #playerControls .player-key.key-disabled', { ...KEY_SOCKET, ...KEY_SOCKET_LEGEND }],
  ['#streamContainer:not(.fullscreen) #playerControls .jump-icon > .material-symbols', MINI_JUMP_GLYPH],
  // Utility keys: restrained bezel, one neutral legend; chapters without chapters is a socket
  ['#playerContent .utility-key', { ...KEY_BOX.utility, ...UTILITY_KEY }],
  ['#playerContent .utility-key:not(.key-disabled):active', UTILITY_KEY_PRESSED],
  ['#playerContent .utility-key.key-disabled', { ...KEY_SOCKET, ...KEY_SOCKET_LEGEND }],
  ['#playerContent .utility-key:not(.key-disabled)', UTILITY_LEGEND],
  ['#playerContent .utility-key:not(.key-disabled) > .material-symbols', UTILITY_LEGEND],
  ['#playerContent .utility-key:not(.key-disabled) > svg', UTILITY_LEGEND],
  ['#playerContent .queue-key > span.absolute', QUEUE_BADGE],
  // Readouts: speed and the running sleep countdown are recessed green displays, not keys
  ['.fullscreen #playerContent .utility-row', UTILITY_ROW],
  ['.fullscreen #playerContent .speed-readout', READOUT_BOX],
  ['.fullscreen #playerContent .sleep-display', READOUT_BOX],
  // Top chrome (finishing pass): collapse, cast and overflow are utility-family keys on one line; the playback method is a
  // recessed green display between them
  ['#streamContainer.fullscreen .chrome-key', CHROME_KEY],
  ['#streamContainer.fullscreen .chrome-key:active', UTILITY_KEY_PRESSED],
  ['#streamContainer.fullscreen .collapse-key', CHROME_KEY_LINE.collapse],
  ['#streamContainer.fullscreen .cast-key', CHROME_KEY_LINE.right],
  ['#streamContainer.fullscreen .menu-key', CHROME_KEY_LINE.right],
  ['#streamContainer.fullscreen .playback-method', PLAYBACK_METHOD_READOUT],
  // Playback legends: only the transport keys (both jumps, chapter start/end) take the amber; the utility keys
  // (queue, bookmark, sleep, chapters) keep their neutral glyphs. An unavailable key is excluded and keeps its dimmed glyph
  ['#playerContent .jump-icon:not(.key-disabled)', PLAYBACK_LEGEND],
  ['#playerContent .jump-icon:not(.key-disabled) > .material-symbols', PLAYBACK_GLYPH_WEIGHT],
  ['#playerContent .next-icon:not(.key-disabled)', { ...PLAYBACK_LEGEND, ...PLAYBACK_GLYPH_WEIGHT }],
  // Live sleep countdown is a readout: phosphor green like the other readouts (state.success keeps meaning
  // finished/complete everywhere else)
  ['#playerContent .sleep-readout', { color: 'rgb(var(--color-accent))' }],

  // Player: recessed display behind the fullscreen seek/readout rows (content box only: padding stays chassis)
  ['.fullscreen #playerTrack', { 'background-color': 'rgb(var(--color-recessed))', 'background-image': RECESSED_FACE, 'background-clip': 'content-box', 'border-radius': RADIUS.key }],
  ['.fullscreen .total-track', { 'background-color': 'rgb(var(--color-recessed))', 'background-image': RECESSED_FACE, 'background-clip': 'content-box', 'border-radius': RADIUS.key }],
  // Seek channels read as inset slots; the played portion stays the amber token even after the player's
  // seek code swaps in its settled-state class (bg-gray-200)
  ['#playerTrack div.relative.rounded-full', { 'box-shadow': 'inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.3)' }],
  ['.total-track div.relative.rounded-full', { 'box-shadow': 'inset 1px 1px 0 rgb(var(--color-edge-dark)), inset -1px -1px 0 rgb(var(--color-edge-light) / 0.3)' }],
  ['#playerTrack .bg-track-cursor.bg-gray-200', { 'background-color': 'rgb(var(--color-track-cursor))' }],
  // Pending seek (the seek code's bg-yellow-300 state until playback confirms the position): the same amber,
  // broken into segments, so it reads as not-yet-settled by pattern rather than by a near-identical yellow
  ['#playerTrack .bg-track-cursor.bg-yellow-300', { 'background-color': 'transparent', 'background-image': 'repeating-linear-gradient(90deg, rgb(var(--color-track-cursor)) 0 4px, rgb(var(--color-track-cursor) / 0.3) 4px 7px)' }],
  // ...but a drag started before that seek settles (seek-dragging hook) keeps the line solid under the finger
  ['#playerTrack .seek-dragging > .bg-track-cursor.bg-yellow-300', { 'background-color': 'rgb(var(--color-track-cursor))', 'background-image': 'none' }],
  ['#playerTrack .pointer-events-auto > .bg-track-cursor', { 'box-shadow': '0 0 0 1px rgb(var(--color-edge-dark)), 0 1px 2px rgb(0 0 0 / 0.6)' }],
  // Phosphor-green readouts: timestamps, playback speed and the playback-method label (titles stay neutral)
  ['#playerTrack p.font-mono', { color: 'rgb(var(--color-accent))' }],
  ['.total-track p.font-mono', { color: 'rgb(var(--color-accent))' }],
  ['#playerContent .speed-readout', { color: 'rgb(var(--color-accent))' }],
  ['#streamContainer p.tracking-widest', { color: 'rgb(var(--color-accent) / 0.85)' }],
  // Full-player metadata readout (title/chapter and author): recessed display in a bezel plate, plus its authorized
  // metadata-only layout. The collapsed player's block (no .fullscreen) is untouched
  ['.fullscreen .title-author-texts', { ...METADATA_READOUT, ...METADATA_READOUT_LAYOUT }],
  ['.fullscreen .total-track ~ .title-author-texts', METADATA_READOUT_ABOVE_TOTAL_TRACK],
  // Transport: the primary Play/Pause key (Phase 4H), squared dark key with the primary bezel; pressed cuts it in.
  // Its glyph, seek-pending glyph and loading spinner share the playback amber; the glyph is sized up in its box
  ['#playerControls .play-btn', PRIMARY_KEY],
  ['#playerControls .play-btn:active', PRIMARY_KEY_PRESSED],
  ['#streamContainer:not(.fullscreen) #playerControls .play-btn', PRIMARY_KEY_MINI],
  ['#streamContainer:not(.fullscreen) #playerControls .play-btn:active', PRIMARY_KEY_PRESSED_MINI],
  ['#playerControls .play-btn .material-symbols', PLAYBACK_LEGEND],
  ['#playerControls .play-btn .la-ball-spin-clockwise', PLAYBACK_LEGEND],
  ['.fullscreen #playerControls .play-btn .material-symbols', PRIMARY_GLYPH_SIZE.full],
  ['#streamContainer:not(.fullscreen) #playerControls .play-btn .material-symbols', PRIMARY_GLYPH_SIZE.mini],
  // Collapsed mini-player: chassis top edge (same footprint)
  ['#streamContainer:not(.fullscreen) #playerContent', { 'box-shadow': 'inset 0 1px 0 rgb(var(--color-edge-light) / 0.45), 0 -8px 8px rgb(0 0 0 / 0.33)' }],
  // Collapsed mini-player (Phase 7B, Candidate B): condensed neutral metadata, condensed tabular times on their unchanged
  // line box, and the artwork mounted with a soft shadow. Type and paint only; the 120px panel and every box keep their
  // geometry. None of these match the full player (.fullscreen)
  ['#streamContainer:not(.fullscreen) .title-author-texts .title-text', MINI_TITLE_TYPE],
  ['#streamContainer:not(.fullscreen) .title-author-texts .author-text', MINI_AUTHOR_TYPE],
  ['#streamContainer:not(.fullscreen) #playerTrack p.font-mono', MINI_TIME_TYPE],
  ['#streamContainer:not(.fullscreen) .cover-wrapper', MINI_ARTWORK_MOUNT],

  // Bookshelf view: the wood material becomes graphite/blue-gray equipment (same boxes, labels and layout)
  ['.bookshelfRow', { 'background-image': 'linear-gradient(180deg, rgb(var(--color-primary)) 0%, rgb(var(--color-bg)) 100%)' }],
  ['.bookshelfDivider', { 'background-color': 'rgb(var(--color-secondary))', 'background-image': STEEL_SHEEN, 'box-shadow': `${RAISED_BEVEL}, 2px 10px 8px rgb(0 0 0 / 0.5)` }],
  ['.shinyBlack', { 'background-color': 'rgb(var(--color-recessed))', 'background-image': 'none', 'border-color': 'rgb(var(--color-border))', color: 'rgb(var(--color-fg))' }],
  ['.altBookshelfLabel', { 'background-color': 'rgb(var(--color-recessed))', 'background-image': 'none', 'border-color': 'rgb(var(--color-border))', color: 'rgb(var(--color-fg))' }],

  // --- Browsing and detail surfaces (Gate D) ---
  // Content stays dominant: artwork is mounted, information sits in recessed displays, tappable section
  // headers are raised strips, and only real controls become keys. Card artwork for every entity type uses
  // the card-artwork hook above (series/collection/playlist covers, author portraits, group-table row covers)
  // on its artwork box only, never a card root or row.
  // Home sections: an engraved seam closes each shelf (drawn under the shelf content, so the standard
  // shelf's own divider covers it and it only shows in the alternative view)
  ['.shelf-section', { 'box-shadow': ENGRAVED_SEPARATOR }],
  // Bookshelf toolbar: a chassis strip under the navigation bar, seamed off from the content below
  ['.browse-toolbar', { 'background-image': CHASSIS_SHEEN, 'box-shadow': ENGRAVED_SEPARATOR }],
  // Active-filter indicator: an active state, so the accent (success green only means completion)
  ['.browse-toolbar .filter-indicator', { 'background-color': 'rgb(var(--color-accent))', 'border-color': 'rgb(var(--color-edge-dark))' }],
  // Library selector (app bar): a physical key; pressed inverts it
  ['.library-selector', KEY_CAP],
  ['.library-selector:active', KEY_CAP_PRESSED],
  // Browsing labels and the list-row play key (Phase 8B, Candidate B). Section labels are condensed and neutral; the shelf
  // heading band paints an engraved rule clear of the artwork; the toolbar count is condensed with tabular figures; the
  // list-row play button wears the mini-player's key face and amber legend. Type and paint only: cards, titles, authors,
  // navigation labels and the library selector are deliberately unchanged
  ['.shelf-heading', SECTION_LABEL_TYPE],
  ['.shelf-heading-band', SHELF_HEADING_RULE],
  ['.search-section-label', SECTION_LABEL_TYPE],
  ['.toolbar-count', COUNT_TYPE],
  ['.list-play-key', LIST_PLAY_KEY],
  ['.list-play-key > .material-symbols', LIST_PLAY_LEGEND],
  // Library list: recessed well, seamed rows; the current library is a selected key (pressed, accent ring) on
  // a lit row, and its marker uses the accent instead of warning orange (selection is not a warning)
  ['.modal .library-option-panel ul[role=listbox]', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': RECESSED_WELL }],
  ['.modal .library-option-panel li[role=option]:not(:last-child)', { 'box-shadow': ENGRAVED_SEPARATOR }],
  ['.modal .library-option-panel li[role=option].option-selected', { 'background-color': 'rgb(var(--color-bg))', ...SELECTED_KEY }],
  ['.modal .library-option-panel .option-marker', { 'background-color': 'rgb(var(--color-accent))' }],
  // Detail artwork (item, collection and playlist pages): the same mounted frame as card artwork
  ['.detail-artwork', { 'border-radius': RADIUS.frame, 'box-shadow': `${ARTWORK_FRAME}, ${ELEVATION.panel}` }],
  // Item progress: a recessed information display (text and values unchanged)
  ['.detail-progress', { 'background-color': 'rgb(var(--color-recessed))', 'border-radius': RADIUS.key, 'box-shadow': RECESSED_WELL }],
  // Tappable section headers (chapters/tracks/ebook files, collection/playlist items): raised chassis strips
  ['.section-bar', { 'background-image': CHASSIS_SHEEN, 'box-shadow': RAISED_BEVEL }],
  // Their count badge and the total-duration value are small recessed readouts
  ['.section-bar .section-count', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': RECESSED_WELL, color: 'rgb(var(--color-accent))' }],
  ['.section-bar .section-readout', { color: 'rgb(var(--color-accent))' }],
  // Detail tables (assets/app.css tracksTable): a recessed display with a dark zebra instead of bright strips
  ['.tracksTable tr', { 'background-color': 'rgb(var(--color-recessed))' }],
  ['.tracksTable tr:nth-child(even)', { 'background-color': 'rgb(var(--color-primary))' }],
  // Group detail items (collection/playlist): a recessed well; collection rows are seamed display entries
  ['.group-items', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': RECESSED_WELL }],
  ['.group-items .group-row:not(:last-child)', { 'box-shadow': ENGRAVED_SEPARATOR }],
  // Row play buttons are real controls: equipment keys (glyph color and size unchanged)
  ['.row-play-btn', KEY_CAP],
  ['.row-play-btn:active', KEY_CAP_PRESSED],

  // --- Forms, shared dialogs and interactive controls (Gate E) ---
  // Segmented toggles (ui/ToggleBtns, existing toggle-btn / selected hooks): raised steel segments; the
  // selected choice is a selected key (pressed in, accent ring) on its existing lit fill, so it reads by shape
  // and not color alone; pressing any segment inverts its bevel. Segment shapes and borders are unchanged
  ['.toggle-btn', { 'background-image': STEEL_SHEEN, 'box-shadow': RAISED_BEVEL }],
  ['.toggle-btn.selected', SELECTED_KEY],
  ['.toggle-btn:active', KEY_CAP_PRESSED],
  // Unselected segment labels keep a readability margin on the steel face (the component dims them to fg/0.5,
  // 3.3:1 under the sheen); selection still reads by the pressed bevel, accent ring and lit fill
  ['.toggle-btn:not(.selected)', { color: 'rgb(var(--color-fg) / 0.78)' }],
  // Range input (ui/RangeInput, range-input hook): a recessed slot like the seek channels, with a steel thumb
  // rather than the playback amber (a setting is not playback progress); focus keeps its outline, in the accent
  ['.range-input input[type=range]::-webkit-slider-runnable-track', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': INSET_SLOT }],
  ['.range-input input[type=range]::-webkit-slider-thumb', { 'background-color': 'rgb(var(--color-edge-light))', 'background-image': STEEL_SHEEN, 'box-shadow': THUMB_EDGE }],
  ['.range-input input[type=range]:focus::-webkit-slider-thumb', { 'border-color': 'rgb(var(--color-edge-dark))', 'outline-color': 'rgb(var(--color-accent))' }],
  // Checkbox (ui/Checkbox): an empty recessed well; checked = lit, pressed in, accent edge and accent check
  // (checked is not success); disabled = flat, dark edge and muted check, so it never reads as active.
  // The native input stays (invisible, as before); its keyboard focus now shows on the box
  ['.checkbox-box', { 'background-color': 'rgb(var(--color-recessed))', 'border-color': 'rgb(var(--color-border))', 'box-shadow': RECESSED_WELL }],
  ['.checkbox-box.checkbox-checked', { 'background-color': 'rgb(var(--color-bg))', 'border-color': 'rgb(var(--color-accent))', 'box-shadow': PRESSED_BEVEL }],
  ['.checkbox-box .checkbox-mark', { color: 'rgb(var(--color-accent))' }],
  ['.checkbox-box.checkbox-disabled', { 'background-color': 'rgb(var(--color-primary))', 'border-color': 'rgb(var(--color-edge-dark))', 'box-shadow': 'none' }],
  ['.checkbox-box.checkbox-disabled .checkbox-mark', { color: 'rgb(var(--color-fg-muted))' }],
  ['.checkbox-box:has(input:focus-visible)', { outline: '2px solid rgb(var(--color-accent))', 'outline-offset': '2px' }],
  // Dropdown (ui/Dropdown): the trigger is a key (a disabled trigger stays flat); its open list is a recessed
  // module floating above the page with seamed options (it has no selected state of its own)
  ['.dropdown-button:not(:disabled)', KEY_CAP],
  ['.dropdown-button:not(:disabled):active', KEY_CAP_PRESSED],
  ['.dropdown-menu', { 'background-color': 'rgb(var(--color-recessed))', 'box-shadow': `${RECESSED_WELL}, ${ELEVATION.overlay}` }],
  ['.dropdown-menu li:not(:last-child)', { 'box-shadow': ENGRAVED_SEPARATOR }],
  // Shared Dialog (menus and option lists everywhere): the chassis panel (dialog rule above) holds a recessed
  // list with seamed rows; a selected option is a selected key on a lit row instead of a success-green wash.
  // Panel radius, size, position, animation and dismissal are unchanged
  ['.modal .dialog-panel ul[role=listbox]', { 'background-color': 'rgb(var(--color-recessed))', 'border-radius': RADIUS.key, 'box-shadow': RECESSED_WELL }],
  ['.modal .dialog-panel ul[role=listbox] > li:not(:last-child)', { 'box-shadow': ENGRAVED_SEPARATOR }],
  ['.modal .dialog-panel ul[role=listbox] > li.option-selected', { 'background-color': 'rgb(var(--color-bg))', ...SELECTED_KEY }],
  // Playlists modal row: membership is a state, so its marker uses the accent (the row's Add/Remove buttons
  // and the cover's card-artwork frame come from the existing rules)
  ['.membership-marker', { 'background-color': 'rgb(var(--color-accent))' }],

  // Toggle switch (ui/ToggleSwitch): recessed slot with a steel thumb; state still reads from thumb position
  ['.w-10.rounded-full.border-gray-400', { 'border-color': 'rgb(var(--color-border))', 'box-shadow': 'inset 1px 1px 0 rgb(var(--color-edge-dark)), inset 0 1px 3px rgb(0 0 0 / 0.5)' }],
  ['.w-10.rounded-full.border-gray-400.bg-primary', { 'background-color': 'rgb(var(--color-recessed))' }],
  ['.w-10.rounded-full.border-gray-400 > span.bg-white', { 'background-color': 'rgb(var(--color-edge-light))', 'background-image': STEEL_SHEEN, 'border-color': 'rgb(var(--color-edge-dark))' }],
  // Disabled thumb (bg-gray-300) must read dimmer than the enabled steel thumb, not brighter
  ['.w-10.rounded-full.border-gray-400 > span.bg-gray-300', { 'background-color': 'rgb(var(--color-bg-hover))', 'border-color': 'rgb(var(--color-edge-dark))' }],

  // Unfinished playback progress on book/series/list cards, playlist rows and the item cover uses the amber
  // played-progress token; finished (bg-success) and other yellow uses (badges, chapter marker) are untouched
  ['.absolute.bottom-0.left-0.z-10.bg-yellow-400', { 'background-color': 'rgb(var(--color-track-cursor))' }],

  // Contrast safety margin for the two tightest measured roles (LLAMA only, existing values, no geometry):
  // small uppercase muted section headers and inactive navigation icons use primary text at reduced alpha
  ['#content p.uppercase.text-fg-muted', { color: 'rgb(var(--color-fg) / 0.78)' }],
  ['#bookshelf-navbar a.text-fg-muted', { color: 'rgb(var(--color-fg) / 0.8)' }],

  // Visible focus for keyboard/switch access
  [':focus-visible', { outline: '2px solid rgb(var(--color-accent))', 'outline-offset': '2px' }]
]

const RECIPES = {
  standard: () => ({}),
  equipment: (theme) => {
    const root = engine.themeSelector(theme.id)
    const rules = { [root]: equipmentDerivedDeclarations(theme.tokens) }
    for (const [suffix, declarations] of EQUIPMENT_RULES) {
      const selector = suffix ? `${root} ${suffix}` : root
      rules[selector] = { ...(rules[selector] || {}), ...declarations }
    }
    return rules
  }
}

/** Fixed presentation rules for the given validated themes ({ selector: declarations }). */
function presentationRules(themes) {
  const rules = {}
  for (const theme of themes) {
    const recipe = RECIPES[theme.tokens['presentation.finish']]
    if (!recipe) continue // unreachable for validated themes; never guess
    for (const [selector, declarations] of Object.entries(recipe(theme))) {
      rules[selector] = { ...(rules[selector] || {}), ...declarations }
    }
  }
  return rules
}

const builtinPresentationRules = () => presentationRules(engine.THEMES)

// Equipment rules that apply only under a fixed media query: [query, selector suffix, declarations]. Kept apart from
// EQUIPMENT_RULES so every unconditional rule stays a flat selector map; the entries are the readout's short-screen and
// landscape variants with the total-track display
const EQUIPMENT_MEDIA_RULES = [
  [METADATA_READOUT_COMPACT_QUERY, '.fullscreen .total-track ~ .title-author-texts', METADATA_READOUT_COMPACT],
  [METADATA_READOUT_LANDSCAPE_QUERY, '.fullscreen .total-track ~ .title-author-texts', METADATA_READOUT_LANDSCAPE]
]

/** Fixed media-conditional presentation rules for the given validated themes ({ query: { selector: declarations } }). */
function presentationMediaRules(themes) {
  const rules = {}
  for (const theme of themes) {
    if (theme.tokens['presentation.finish'] !== 'equipment') continue
    const root = engine.themeSelector(theme.id)
    for (const [query, suffix, declarations] of EQUIPMENT_MEDIA_RULES) {
      const media = `@media ${query}`
      rules[media] = { ...(rules[media] || {}), [`${root} ${suffix}`]: { ...declarations } }
    }
  }
  return rules
}

const builtinPresentationMediaRules = () => presentationMediaRules(engine.THEMES)

module.exports = { presentationRules, builtinPresentationRules, presentationMediaRules, builtinPresentationMediaRules, equipmentDerivedDeclarations, EQUIPMENT_RULES, EQUIPMENT_MEDIA_RULES, PRIMITIVES }
