// The collapsed player's projected plate height for script consumers (the EPUB rendition size): AudioPlayer.vue publishes
// it on the root element as --mini-player-height (theme/playerLayout.js miniLayout). 120px, the previous plate, when unset
export function miniPlayerHeight(root = typeof document !== 'undefined' ? document.documentElement : null) {
  const value = root && root.style ? parseFloat(root.style.getPropertyValue('--mini-player-height')) : NaN
  return Number.isFinite(value) && value > 0 ? value : 120
}
