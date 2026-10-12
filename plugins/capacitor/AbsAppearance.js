import { registerPlugin, WebPlugin } from '@capacitor/core'

// RICE device appearance (android/.../plugins/AbsAppearance.kt). The browser fallback (development only) follows the
// system light/dark preference and has no platform palette, like Android 11 and older.
class AbsAppearanceWeb extends WebPlugin {
  constructor() {
    super()
    this.sequence = 0
    this.query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
    if (this.query && this.query.addEventListener) this.query.addEventListener('change', () => this.notifyListeners('deviceAppearanceChanged', this.snapshot()))
  }

  snapshot() {
    return { apiLevel: 0, paletteAvailable: false, night: !!(this.query && this.query.matches), contrast: null, fontScale: 1, sessionId: 'web', sequence: ++this.sequence, paletteRevision: 'none', tones: null }
  }

  async getDeviceAppearance() {
    return this.snapshot()
  }

  async applyNativeAppearance() {}
}

const AbsAppearance = registerPlugin('AbsAppearance', { web: () => new AbsAppearanceWeb() })

export { AbsAppearance }
