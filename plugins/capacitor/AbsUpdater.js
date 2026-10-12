import { registerPlugin, WebPlugin } from '@capacitor/core'

// Settings → Updates. The native side (android/.../updater) fixes the release source, verifies downloads and opens
// Android's installer; this web fallback (browser development) reports the updater as unavailable.
class AbsUpdaterWeb extends WebPlugin {
  async getState() {
    return { state: 'UNSUPPORTED', installedVersion: null, installedVersionCode: 0, downloadsEnabled: false }
  }

  async checkForUpdates() {
    return { accepted: false }
  }

  async downloadUpdate() {
    return { accepted: false }
  }

  async cancelDownload() {
    return { accepted: false }
  }

  async installUpdate() {
    return { result: 'unsupported' }
  }

  async reopenInstaller() {
    return { opened: false }
  }

  async openInstallPermissionSettings() {
    return { opened: false }
  }

  async openReleaseNotes() {
    return { opened: false }
  }
}

const AbsUpdater = registerPlugin('AbsUpdater', {
  web: () => new AbsUpdaterWeb()
})

export { AbsUpdater }
