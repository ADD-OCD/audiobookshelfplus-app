/**
 * Color math for RICE (docs/rice-customization.md): hex parsing, WCAG contrast and linear-RGB blends.
 * Colors are [r, g, b] integer channels 0-255. CommonJS so Node tests and the app share it.
 */
const HEX_PATTERN = /^#([0-9a-fA-F]{6})$/

const isChannel = (n) => Number.isInteger(n) && n >= 0 && n <= 255
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every(isChannel)

/** '#RRGGBB' -> [r, g, b], or null. Only the six-digit form is accepted. */
function parseHex(text) {
  if (typeof text !== 'string') return null
  const match = HEX_PATTERN.exec(text)
  if (!match) return null
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (c) =>
  '#' +
  c
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

const toLinear = (channel) => {
  const s = channel / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const fromLinear = (l) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, Math.round(s * 255)))
}

/** WCAG 2.2 relative luminance (unrounded). */
function luminance(c) {
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2])
}

/** WCAG contrast ratio, unrounded. */
function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Blend `from` toward `to` by `t` (0..1) in linear RGB, rounded consistently. */
function blend(from, to, t) {
  return from.map((ch, i) => fromLinear(toLinear(ch) + (toLinear(to[i]) - toLinear(ch)) * t))
}

/** A color scheme decision: dark when the color is darker than mid-gray's luminance. */
const isDark = (c) => luminance(c) < 0.18

module.exports = { parseHex, toHex, isRgb, isChannel, luminance, contrast, blend, isDark }
