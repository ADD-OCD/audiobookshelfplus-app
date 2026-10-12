/**
 * RICE runtime stylesheet (docs/rice-customization.md, "Runtime").
 *
 * A validated snapshot becomes CSS text here and nowhere else. Color values go through the built-in engine's
 * serializer (theme/engine.js themeDeclarations), presentation options select fixed recipes in this file, and every
 * selector and property name is a constant. No snapshot field can reach a selector, a property name, a URL or a font
 * family string.
 *
 * Committed appearance: one <style id="abs-rice-style"> plus html[data-rice="active"]; html[data-theme] stays the
 * approved base (dark, black, light or llama) so the base's own rules and recipes keep applying underneath. Returning
 * to a built-in removes the node and the marker completely.
 */
const engine = require('../engine')
const { equipmentDerivedDeclarations } = require('../presets')
const { validateSnapshot, DEFAULT_APPEARANCE } = require('./schema')

const STYLE_ID = 'abs-rice-style'
const PREVIEW_STYLE_ID = 'abs-rice-preview-style'
const COMMITTED_ROOT = "html[data-theme][data-rice='active']"

// Fixed font stacks. 'AbsRice*' aliases are declared in assets/rice-fonts.css and used only under the RICE marker.
// The app's own body stack (tailwind.config.js fontFamily.sans), stated explicitly inside the preview
const APP_SANS = "'Source Sans Pro', ui-sans-serif, system-ui, sans-serif"
const SYSTEM_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif"
const FONT_STACKS = Object.freeze({
  interface: { 'source-sans': `'AbsRiceSourceSans', ${SYSTEM_SANS}` },
  display: { 'system-mono': "ui-monospace, 'Roboto Mono', 'Droid Sans Mono', monospace", 'ubuntu-mono': "'AbsRiceUbuntuMono', ui-monospace, monospace" }
})

// Tailwind text sizes the scale option multiplies (icons are excluded below)
const TEXT_SIZES = Object.freeze({ 'text-xxs': 0.625, 'text-xs': 0.75, 'text-sm': 0.875, 'text-base': 1, 'text-lg': 1.125, 'text-xl': 1.25, 'text-2xl': 1.5 })
const NOT_ICON = ':not(.material-symbols):not(.material-icons):not(.abs-icons)'
const ROUNDED = ['.rounded-sm', '.rounded', '.rounded-md', '.rounded-lg', '.rounded-xl']

// Fixed effect recipes (PRESET-SCHEMA presentation bounds: at most two shadow layers, blur <= 8px, alpha <= 0.20)
const APP_BUTTON_SHADOW = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' // Tailwind shadow-md, the buttons' own shadow
const SOFT_SHADOW = '0 1px 2px rgb(0 0 0 / 0.2), 0 4px 8px rgb(0 0 0 / 0.16)'
const BEVEL = 'inset 0 1px 0 rgb(255 255 255 / 0.12), inset 0 -1px 0 rgb(0 0 0 / 0.2)'

const declarationsText = (declarations) =>
  Object.entries(declarations)
    .map(([p, v]) => `${p}: ${v};`)
    .join(' ')

/** Color declarations for a snapshot: the engine's token variables (+ LLAMA's derived equipment variables). */
function colorDeclarations(snapshot) {
  const declarations = engine.themeDeclarations(snapshot.tokens)
  if (snapshot.baseId === 'llama') Object.assign(declarations, equipmentDerivedDeclarations(snapshot.tokens))
  declarations['color-scheme'] = snapshot.colorScheme
  return declarations
}

/**
 * Rules for the presentation options that differ from the defaults (defaults render exactly like the base).
 * Committed rules skip the Appearance page's preview (`:not(.rice-preview *)`), and the preview states its font and
 * weight explicitly, so a draft is never shown with the applied appearance's shapes or type.
 */
function appearanceRules(appearance, root, preview = false) {
  const a = appearance
  const rules = []
  const scope = (selector) =>
    selector
      .split(', ')
      .map((s) => (preview ? `${root} ${s}` : `${root} ${s}:not(.rice-preview):not(.rice-preview *)`))
      .join(', ')
  if (a.interfaceFont !== DEFAULT_APPEARANCE.interfaceFont) rules.push([root, { 'font-family': FONT_STACKS.interface[a.interfaceFont] }])
  else if (preview) rules.push([root, { 'font-family': APP_SANS }])
  if (a.weight !== DEFAULT_APPEARANCE.weight || preview) rules.push([root, { 'font-weight': String(a.weight) }])
  if (a.displayFont !== DEFAULT_APPEARANCE.displayFont) rules.push([scope('.font-mono'), { 'font-family': FONT_STACKS.display[a.displayFont] }])
  if (a.textScale !== DEFAULT_APPEARANCE.textScale) {
    for (const [cls, rem] of Object.entries(TEXT_SIZES)) rules.push([scope(`.${cls}${NOT_ICON}`), { 'font-size': `${+(rem * a.textScale).toFixed(4)}rem` }])
  }
  if (a.radius !== DEFAULT_APPEARANCE.radius) rules.push([scope(ROUNDED.join(', ')), { 'border-radius': `${a.radius}px` }])
  if (a.frame !== DEFAULT_APPEARANCE.frame) rules.push([scope('.card-frame'), { 'box-shadow': `inset 0 0 0 ${Math.max(1, a.borderWidth)}px rgb(var(--color-border))` }])
  const layers = []
  if (a.borderWidth !== DEFAULT_APPEARANCE.borderWidth) layers.push(`inset 0 0 0 ${a.borderWidth}px rgb(var(--color-border))`)
  if (a.finish !== DEFAULT_APPEARANCE.finish) layers.push(BEVEL)
  if (a.shadow !== DEFAULT_APPEARANCE.shadow) layers.push(SOFT_SHADOW)
  else if (layers.length) layers.push(APP_BUTTON_SHADOW)
  if (layers.length) rules.push([scope('.btn'), { 'box-shadow': layers.join(', ') }])
  return rules
}

/**
 * CSS text for a snapshot under `root` (the committed html selector, or a preview container selector).
 * Throws on an invalid snapshot: nothing unvalidated is ever serialized.
 */
function buildRiceCss(snapshot, root = COMMITTED_ROOT) {
  const check = validateSnapshot(snapshot)
  if (!check.ok) throw new Error('Invalid RICE snapshot')
  const rules = [[root, colorDeclarations(snapshot)], ...appearanceRules(snapshot.appearance, root, root !== COMMITTED_ROOT)]
  return rules.map(([selector, declarations]) => `${selector} { ${declarationsText(declarations)} }`).join('\n')
}

/** Applies a snapshot to the document (idempotent: no DOM write when the CSS is unchanged). */
function applyRice(doc, snapshot) {
  const root = doc.documentElement
  const css = buildRiceCss(snapshot)
  let node = doc.getElementById(STYLE_ID)
  if (!node) {
    node = doc.createElement('style')
    node.id = STYLE_ID
    doc.head.appendChild(node)
  }
  if (node.textContent !== css) node.textContent = css
  if (root.dataset.theme !== snapshot.baseId) root.dataset.theme = snapshot.baseId
  if (root.dataset.rice !== 'active') root.dataset.rice = 'active'
  return css
}

/** Removes every RICE trace from the document: the style node and the marker. */
function clearRice(doc) {
  const node = doc.getElementById(STYLE_ID)
  if (node && node.parentNode) node.parentNode.removeChild(node)
  delete doc.documentElement.dataset.rice
}

/** Preview stylesheet scoped to one container (the Appearance page's preview); never touches html. */
function applyPreview(doc, snapshot, containerSelector) {
  let node = doc.getElementById(PREVIEW_STYLE_ID)
  if (!snapshot) {
    if (node && node.parentNode) node.parentNode.removeChild(node)
    return
  }
  const css = buildRiceCss(snapshot, containerSelector)
  if (!node) {
    node = doc.createElement('style')
    node.id = PREVIEW_STYLE_ID
    doc.head.appendChild(node)
  }
  if (node.textContent !== css) node.textContent = css
}

module.exports = { buildRiceCss, applyRice, clearRice, applyPreview, colorDeclarations, STYLE_ID, PREVIEW_STYLE_ID, COMMITTED_ROOT, FONT_STACKS }
