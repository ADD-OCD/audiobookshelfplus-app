import Vue from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import themeEngine from '@/theme/engine'
import { AbsDatabase } from '@/plugins/capacitor/AbsDatabase'

/**
 * The single place the app applies a theme (see docs/theme-architecture.md).
 *
 * Built-in theme CSS is generated at build time, so applying a theme only sets <html data-theme> to a
 * validated built-in id and applies the system-bar token. Persistence stays on the existing
 * Preferences key `theme` ('dark' | 'black' | 'light'); unknown stored values resolve to the default.
 * RICE customization (plugins/rice.client.js, theme/rice/) attaches here: while a RICE appearance is active, `theme`
 * returns its validated theme object and `id` its approved base; with RICE off nothing below changes.
 */
export class ThemeService {
  constructor({ localStore, root, platform, statusBar, widgets }) {
    this.localStore = localStore
    this.root = root
    this.platform = platform
    this.statusBar = statusBar
    this.widgets = widgets
    this.state = Vue.observable({ id: themeEngine.DEFAULT_THEME_ID, resolved: null })
    this.rice = null
    this.ready = Promise.resolve()
  }

  get id() {
    return this.state.id
  }

  get theme() {
    return this.state.resolved || themeEngine.getTheme(this.state.id)
  }

  /** RICE controller (theme/rice/controller.js); once its store exists, built-in choices go through it too. */
  attachRice(rice) {
    this.rice = rice
  }

  get themes() {
    return themeEngine.THEMES
  }

  /** Applies a built-in theme without persisting it. Returns the id actually applied. */
  apply(requestedId) {
    const theme = themeEngine.getTheme(requestedId)
    this.root.dataset.theme = theme.id
    this.state.id = theme.id
    this.applySystemBars(theme)
    return theme.id
  }

  applySystemBars(theme) {
    if (this.platform === 'web' || !this.statusBar) return
    // Capacitor's Style.Dark = light icons for a dark bar background
    const style = theme.tokens['system.bar-icons'] === 'dark' ? Style.Light : Style.Dark
    this.statusBar.setStyle({ style }).catch((error) => console.error('[ThemeService] Failed to set status bar style', error))
  }

  /** Applies and persists a user selection. */
  async select(requestedId) {
    if (this.rice && this.rice.persisted) {
      await this.rice.selectBuiltin(requestedId)
      return this.state.id
    }
    const id = this.apply(requestedId)
    await this.localStore.setTheme(id)
    if (this.rice) this.rice.noteBuiltin(id)
    this.refreshWidgets()
    return id
  }

  /**
   * Tells the native home-screen widget the saved theme changed so it redraws. Nothing is passed: the
   * widget re-reads the saved built-in id itself and maps it through its own allow-list.
   */
  refreshWidgets() {
    if (this.platform === 'web' || !this.widgets) return
    Promise.resolve()
      .then(() => this.widgets.refreshWidgets())
      .catch((error) => console.error('[ThemeService] Failed to refresh widgets', error))
  }

  /** Applies the persisted selection (or the default). */
  async restore() {
    const stored = await this.localStore.getTheme()
    return this.apply(stored)
  }
}

export default ({ app }, inject) => {
  const service = new ThemeService({ localStore: app.$localStore, root: document.documentElement, platform: Capacitor.getPlatform(), statusBar: StatusBar, widgets: AbsDatabase })
  // Default theme immediately (matches the previous unconditional dark status-bar style at startup),
  // then the saved selection once Preferences has answered.
  service.apply(themeEngine.DEFAULT_THEME_ID)
  service.ready = service.restore().catch((error) => console.error('[ThemeService] Failed to restore theme', error))
  inject('theme', service)
}
