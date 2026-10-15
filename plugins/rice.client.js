import Vue from 'vue'
import { Preferences } from '@capacitor/preferences'
import { RiceController } from '@/theme/rice/controller'
import { PresetStore } from '@/theme/rice/store'
import { AbsAppearance } from '@/plugins/capacitor/AbsAppearance'

/**
 * Attaches RICE customization (docs/rice-customization.md) to the existing $theme service. Runs after
 * plugins/theme.client.js: the built-in selection is restored first, then the committed RICE store (if the user ever
 * used RICE) takes over. Preference errors propagate to the store, which never reports a failed save as saved.
 */
export default ({ app }) => {
  const service = app.$theme
  const prefs = {
    get: async (key) => (await Preferences.get({ key })).value,
    set: (key, value) => Preferences.set({ key, value })
  }
  const rice = new RiceController({ service, store: new PresetStore(prefs), doc: document, appearance: AbsAppearance, observable: Vue.observable })
  service.attachRice(rice)
  service.ready = service.ready
    .then(() => rice.init())
    .then(() => rice.subscribe())
    .catch((error) => console.error('[RICE] Failed to restore appearance', error && error.code ? error.code : error))
}
