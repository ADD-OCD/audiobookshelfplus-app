// The platform text scale (Android's font size setting). The WebView enlarges rendered text by it, while CSS lengths in px,
// em and rem keep their size, so space reserved for text in lengths must be multiplied by it. Measured from a 16px probe
// (its computed font size over 16); 1 when it cannot be measured.
export function textScale(doc = typeof document !== 'undefined' ? document : null, computed = typeof getComputedStyle !== 'undefined' ? getComputedStyle : null) {
  if (!doc || !doc.body || !computed) return 1
  const probe = doc.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:16px'
  probe.textContent = 'x'
  doc.body.appendChild(probe)
  const value = parseFloat(computed(probe).fontSize) / 16
  probe.remove()
  return Number.isFinite(value) && value > 0 ? value : 1
}
