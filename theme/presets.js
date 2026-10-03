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
  key: '4px' // wells, panels and equipment keys
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
// Pressed: the sheen and drop shadow go, the ring stays, and the face is cut in (inverted bevel plus an inner shade)
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
// Playback legend: the played-progress amber, for transport keys whose meaning is playback (jumps and chapter steps)
const PLAYBACK_LEGEND = Object.freeze({ color: 'rgb(var(--color-track-cursor))' })
// Heavier playback glyphs. The bundled icon font has only a FILL axis (no weight axis, and FILL leaves these stroke
// glyphs unchanged), so the transport glyphs get a hairline stroke in their own color. It adds ink, never layout, and
// the utility keys stay at the font's regular weight, which keeps the transport legends the heavier tier
const PLAYBACK_GLYPH_WEIGHT = Object.freeze({ '-webkit-text-stroke': '0.5px currentColor' })
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
  METADATA_READOUT,
  METADATA_READOUT_LAYOUT,
  METADATA_READOUT_ABOVE_TOTAL_TRACK,
  METADATA_READOUT_COMPACT,
  METADATA_READOUT_LANDSCAPE
})

const EQUIPMENT_RULES = [
  // Navigation chrome: bevelled chassis strips
  ['#appbar', { 'background-image': CHASSIS_SHEEN, 'box-shadow': `${RAISED_BEVEL}, 0 1px 0 rgb(var(--color-edge-dark))` }],
  ['#bookshelf-navbar', { 'background-image': STEEL_SHEEN, 'box-shadow': RAISED_BEVEL }],
  // Selected navigation tab reads as a pressed key (inset) with an accent underline, not color alone
  // (BookshelfNavBar binds bg-primary on the active tab; runtime-only router classes would be pruned by Tailwind)
  ['#bookshelf-navbar a.bg-primary', { 'background-image': 'none', 'box-shadow': `${PRESSED_BEVEL}, inset 0 -2px 0 rgb(var(--color-accent))` }],

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
  // Panel seam between the primary transport row and the secondary control row
  ['.fullscreen #playerControls', { 'box-shadow': ENGRAVED_SEPARATOR }],
  // Mini-player: seam across the panel above the seek region
  ['#streamContainer:not(.fullscreen) #playerTrack', { 'box-shadow': ENGRAVED_SEPARATOR_TOP }],
  // Physical keys: the transport and secondary controls marked with the player-key hook get a dark-faced player
  // key on their own box (pressed cuts it in). A control that is currently unavailable (key-disabled) has no cap at
  // all, so it reads flat/unavailable by shape, not only by its dimmed glyph. Readouts (speed, sleep countdown)
  // and the round play button are not player keys
  ['#playerContent .player-key:not(.key-disabled)', PLAYER_KEY],
  ['#playerContent .player-key:not(.key-disabled):active', PLAYER_KEY_PRESSED],
  ['#streamContainer:not(.fullscreen) #playerContent .player-key:not(.key-disabled)', { 'background-color': PLAYER_KEY_FACE_MINI }],
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
