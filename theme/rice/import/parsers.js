/**
 * Strict palette parsers for RICE "Import theme colors" (docs/rice-customization.md, "Supported formats").
 *
 * Four grammars, each accepting only literal colors: generated pywal/pywal16 JSON, Kitty color assignments,
 * Base16/Base24 schemes in two explicit scalar YAML shapes, and plain #RRGGBB lists. Files are data: nothing is
 * evaluated, included, interpolated, templated, dereferenced or fetched. Malformed or unsupported input fails with a
 * reason; there is no partial recovery. Each parser returns a PaletteCandidate:
 *   { format, slots: [rgb...] (source order), roles: { background, foreground, accent, progress, raised, hover, muted }
 *     (suggestions; null when unknown), needsRoles, name, author, variant, warnings }
 */
const { parseHex, contrast, isDark } = require('../color')
const { parseStrictJson } = require('../strictJson')

const MAX_BYTES = 64 * 1024
const MAX_LINES = 2048
const MAX_LINE_BYTES = 512
const MAX_SLOTS = 24

class PaletteError extends Error {
  constructor(code, line) {
    super(line ? `${code} (line ${line})` : code)
    this.name = 'PaletteError'
    this.code = code
    this.line = line || null
  }
}

/** Shared text checks: size, line count/length, no NUL, optional BOM. Returns lines without line endings. */
function textLines(text) {
  if (typeof text !== 'string') throw new PaletteError('not-text')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.length > MAX_BYTES || Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new PaletteError('too-large')
  if (text.includes('\u0000')) throw new PaletteError('binary')
  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_LINES) throw new PaletteError('too-many-lines')
  lines.forEach((line, i) => {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw new PaletteError('line-too-long', i + 1)
  })
  return lines
}

const Buffer = globalThis.Buffer || { byteLength: (s) => new TextEncoder().encode(s).length }

const hexOrFail = (value, line) => {
  const color = parseHex(value)
  if (!color) throw new PaletteError('bad-color', line)
  return color
}

const candidate = (format, slots, roles, extra = {}) => ({ format, slots, roles: { background: null, foreground: null, accent: null, progress: null, raised: null, hover: null, muted: null, ...roles }, needsRoles: false, name: null, author: null, variant: null, warnings: [], ...extra })

// --- hex-list-v1 ---

function parseHexList(text) {
  const lines = textLines(text)
  const slots = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    if (!/^#[0-9a-fA-F]{6}$/.test(line)) throw new PaletteError('not-a-hex-list', i + 1)
    slots.push(hexOrFail(line, i + 1))
  })
  if (slots.length < 2) throw new PaletteError('too-few-colors')
  if (slots.length > MAX_SLOTS) throw new PaletteError('too-many-colors')
  // No universal order: the user confirms background, text and accent
  return candidate('hex-list-v1', slots, {}, { needsRoles: true })
}

// --- kitty-colors-v1 ---

const KITTY_KEYS = new Set(['background', 'foreground', 'cursor', 'cursor_text_color', 'selection_background', 'selection_foreground', 'url_color', 'active_tab_foreground', 'active_tab_background', 'inactive_tab_foreground', 'inactive_tab_background', 'tab_bar_background', 'active_border_color', 'inactive_border_color', 'bell_border_color', ...Array.from({ length: 24 }, (_, i) => `color${i}`)])
const KITTY_REJECT = /^(include|globinclude|envinclude|geninclude|map|font_family|bold_font|italic_font|bold_italic_font|font_size|font_features|symbol_map|narrow_symbols|kitten|shell|env)\b/

function parseKitty(text) {
  const lines = textLines(text)
  const values = {}
  let name = null
  let author = null
  lines.forEach((raw, i) => {
    const line = raw.trim()
    const n = i + 1
    if (line === '') return
    if (line.startsWith('#')) {
      // Plain metadata comments (never instructions)
      const meta = /^##?\s*(name|author)\s*:\s*(.{1,80})$/i.exec(line)
      if (meta && meta[1].toLowerCase() === 'name' && !name) name = meta[2].trim()
      if (meta && meta[1].toLowerCase() === 'author' && !author) author = meta[2].trim()
      return
    }
    if (KITTY_REJECT.test(line)) throw new PaletteError('unsupported-directive', n)
    const match = /^([a-z0-9_]+)[ \t]+(\S+)$/.exec(line)
    if (!match) throw new PaletteError('bad-line', n)
    const [, key, value] = match
    if (!KITTY_KEYS.has(key)) throw new PaletteError('unsupported-key', n)
    if (Object.prototype.hasOwnProperty.call(values, key)) throw new PaletteError('duplicate-key', n)
    values[key] = hexOrFail(value, n) // non-literal values (e.g. "background", "none") fail here
  })
  if (!values.background || !values.foreground) throw new PaletteError('missing-background-or-foreground')
  const slots = ['background', 'foreground', ...Array.from({ length: 24 }, (_, i) => `color${i}`)].filter((k) => values[k]).map((k) => values[k])
  const hover = values.selection_background && contrast(values.foreground, values.selection_background) >= 4.5 ? values.selection_background : null
  return candidate('kitty-colors-v1', slots.slice(0, MAX_SLOTS), { background: values.background, foreground: values.foreground, accent: values.color4 || values.color6 || null, hover }, { name, author })
}

// --- pywal-json-v1 ---

const PYWAL_COLOR_KEYS = Array.from({ length: 16 }, (_, i) => `color${i}`)

function parsePywal(text) {
  textLines(text)
  let doc
  try {
    doc = parseStrictJson(text, { maxBytes: MAX_BYTES, maxDepth: 6, maxMembers: 256, maxString: 256, maxArray: 64 })
  } catch (e) {
    throw new PaletteError('bad-json')
  }
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!plain(doc)) throw new PaletteError('bad-json')
  for (const key of Object.keys(doc)) if (!['special', 'colors', 'wallpaper', 'alpha', 'checksum'].includes(key)) throw new PaletteError('unsupported-key')
  // Metadata is discarded and never dereferenced (a wallpaper path is not opened)
  for (const key of ['wallpaper', 'alpha', 'checksum']) if (key in doc && !(typeof doc[key] === 'string' || typeof doc[key] === 'number')) throw new PaletteError('bad-metadata')
  const { special, colors } = doc
  if (!plain(special) || !plain(colors)) throw new PaletteError('missing-section')
  for (const key of Object.keys(special)) if (!['background', 'foreground', 'cursor'].includes(key)) throw new PaletteError('unsupported-key')
  if (Object.keys(colors).length !== 16 || !PYWAL_COLOR_KEYS.every((k) => k in colors)) throw new PaletteError('need-16-colors')
  const background = hexOrFail(special.background)
  const foreground = hexOrFail(special.foreground)
  if ('cursor' in special) hexOrFail(special.cursor)
  const slots = PYWAL_COLOR_KEYS.map((k) => hexOrFail(colors[k]))
  return candidate('pywal-json-v1', [background, foreground, ...slots].slice(0, MAX_SLOTS), { background, foreground, accent: slots[4] })
}

// --- base-palette-v1 (Base16/Base24 scalar subset) ---

const BASE_SLOTS = Array.from({ length: 24 }, (_, i) => 'base' + i.toString(16).toUpperCase().padStart(2, '0'))
const LEGACY_META = new Set(['scheme', 'author'])
const CURRENT_META = new Set(['system', 'name', 'author', 'variant', 'slug', 'description'])

/** One scalar: "quoted" or 'quoted' or a plain word; an inline comment may follow after whitespace. */
function scalar(rest, n) {
  let match = /^"([^"\\]{0,200})"(?:[ \t]+#.*)?$/.exec(rest) || /^'([^']{0,200})'(?:[ \t]+#.*)?$/.exec(rest)
  if (match) return { value: match[1], quoted: true }
  if (/^[&*!|>%@`{[]/.test(rest) || rest.startsWith('<<')) throw new PaletteError('unsupported-yaml', n)
  match = /^([^#"'\s][^#]*?)(?:[ \t]+#.*)?$/.exec(rest)
  if (!match) throw new PaletteError('bad-value', n)
  return { value: match[1].trim(), quoted: false }
}

function baseColor({ value, quoted }, n) {
  if (/^[0-9a-fA-F]{6}$/.test(value)) return hexOrFail('#' + value, n) // kept as text: never parsed as a number
  if (quoted && /^#[0-9a-fA-F]{6}$/.test(value)) return hexOrFail(value, n)
  throw new PaletteError('bad-color', n)
}

function parseBasePalette(text) {
  const lines = textLines(text)
  const top = {}
  const palette = {}
  let inPalette = false
  let indent = null
  lines.forEach((raw, i) => {
    const n = i + 1
    if (/^\s*(#.*)?$/.test(raw)) return
    if (i === 0 && raw.trim() === '---') return
    if (raw.includes('\t')) throw new PaletteError('tab-indent', n)
    const lead = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (/^(---|\.\.\.|%)/.test(line) || line.startsWith('- ')) throw new PaletteError('unsupported-yaml', n)
    const match = /^([A-Za-z0-9_]+):(?:[ \t]+(.*))?$/.exec(line)
    if (!match) throw new PaletteError('bad-line', n)
    const [, key, rest] = match
    if (lead > 0) {
      if (!inPalette) throw new PaletteError('unexpected-indent', n)
      if (indent === null) indent = lead
      if (lead !== indent) throw new PaletteError('bad-indent', n)
      if (!BASE_SLOTS.includes(key) || rest === undefined) throw new PaletteError('unsupported-key', n)
      if (key in palette) throw new PaletteError('duplicate-key', n)
      palette[key] = baseColor(scalar(rest, n), n)
      return
    }
    inPalette = false
    if (key in top) throw new PaletteError('duplicate-key', n)
    if (key === 'palette') {
      if (rest !== undefined && rest.trim() !== '' && !rest.trim().startsWith('#')) throw new PaletteError('unsupported-yaml', n)
      top.palette = true
      inPalette = true
      return
    }
    if (rest === undefined) throw new PaletteError('bad-line', n)
    top[key] = scalar(rest, n)
  })

  let slots
  let meta
  if (top.palette) {
    for (const key of Object.keys(top)) if (key !== 'palette' && !CURRENT_META.has(key)) throw new PaletteError('unsupported-key')
    const system = top.system && top.system.value
    if (system !== 'base16' && system !== 'base24') throw new PaletteError('unsupported-system')
    const expected = system === 'base16' ? 16 : 24
    if (Object.keys(palette).length !== expected || !BASE_SLOTS.slice(0, expected).every((k) => k in palette)) throw new PaletteError('wrong-slot-count')
    slots = BASE_SLOTS.slice(0, expected).map((k) => palette[k])
    const variant = top.variant ? top.variant.value : null
    if (variant !== null && variant !== 'dark' && variant !== 'light') throw new PaletteError('bad-variant')
    meta = { name: top.name ? top.name.value : null, author: top.author ? top.author.value : null, variant }
  } else {
    for (const key of Object.keys(top)) if (!LEGACY_META.has(key) && !BASE_SLOTS.slice(0, 16).includes(key)) throw new PaletteError('unsupported-key')
    if (!BASE_SLOTS.slice(0, 16).every((k) => k in top)) throw new PaletteError('wrong-slot-count')
    slots = BASE_SLOTS.slice(0, 16).map((k) => baseColor(top[k]))
    meta = { name: top.scheme ? top.scheme.value : null, author: top.author ? top.author.value : null, variant: null }
  }
  const s = (i) => slots[i]
  return candidate('base-palette-v1', slots, { background: s(0), raised: s(1), hover: s(2), muted: s(4), foreground: s(5), progress: s(10), accent: s(13) }, meta)
}

const PARSERS = Object.freeze({ 'pywal-json-v1': parsePywal, 'kitty-colors-v1': parseKitty, 'base-palette-v1': parseBasePalette, 'hex-list-v1': parseHexList })

/** Picks a grammar from the content's shape (never from the file name alone) and parses with it. */
function detectAndParse(text) {
  const lines = textLines(text)
  const nonBlank = lines.map((l) => l.trim()).filter(Boolean)
  const content = nonBlank.filter((l) => !l.startsWith('#'))
  const first = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart()
  if (first.startsWith('{')) return parsePywal(text)
  if (nonBlank.length && nonBlank.every((l) => /^#[0-9a-fA-F]{6}$/.test(l))) return parseHexList(text)
  if (content.some((l) => /^(palette|base00|scheme|system)\s*:/.test(l))) return parseBasePalette(text)
  if (content.some((l) => /^(background|foreground|color\d{1,2})[ \t]+#[0-9a-fA-F]{6}$/.test(l))) return parseKitty(text)
  throw new PaletteError('unsupported-format')
}

/** Dark or light reading for a candidate: explicit variant, else the background's luminance. */
const candidateScheme = (c) => c.variant || (c.roles.background ? (isDark(c.roles.background) ? 'dark' : 'light') : null)

module.exports = { parseHexList, parseKitty, parsePywal, parseBasePalette, detectAndParse, candidateScheme, PARSERS, PaletteError, MAX_BYTES }
