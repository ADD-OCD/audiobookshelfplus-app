// Playback speeds the app offers have at most two decimals (the presets 0.5-3x and the 0.1 stepper). Native code reports
// the player's speed as a 32-bit float, so 1.4x arrives as 1.399999976158142 once widened to a double. Every speed that
// enters the UI from native is normalized here, so the value the player keeps (and shows) is the speed the user chose.

// A finite, positive speed rounded to two decimals; null for anything else (missing, NaN, zero, negative)
export function normalizePlaybackRate(value) {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0) return null
  return Math.round(rate * 100) / 100
}

// The concise label shown for a speed: "1x", "1.25x", "1.4x", "2x"
export function formatPlaybackRate(value) {
  const rate = normalizePlaybackRate(value)
  return `${rate === null ? 1 : rate}x`
}
