<template>
  <!-- Settings → Appearance: RICE customization (docs/rice-customization.md). Off = the built-in themes exactly as
       before. On = starter themes, device colors, personal presets and palette import. Enabling changes nothing until
       an appearance is chosen. -->
  <div class="w-full h-full px-4 py-8 overflow-y-auto">
    <template v-if="editing">
      <p class="uppercase text-xs font-semibold text-fg-muted mb-3">{{ editing.presetId ? $strings.HeaderRiceEditPreset : $strings.HeaderRiceNewPreset }}</p>
      <appearance-preset-editor :start="editing" @close="editing = null" />
    </template>

    <template v-else-if="importing">
      <p class="uppercase text-xs font-semibold text-fg-muted mb-3">{{ $strings.HeaderRiceImport }}</p>
      <appearance-theme-importer @edit="startEditing" @cancel="importing = false" />
    </template>

    <template v-else>
      <div class="flex items-center py-3">
        <div class="w-10 flex justify-center" @click.stop="toggleRice">
          <ui-toggle-switch :value="riceEnabled" class="pointer-events-none" />
        </div>
        <button class="pl-4 text-left" role="switch" :aria-checked="String(riceEnabled)" :disabled="busy" @click="toggleRice">
          <span class="block">{{ $strings.LabelRiceEnable }}</span>
          <span class="block text-sm text-fg-muted">{{ $strings.MessageRiceEnableHelp }}</span>
        </button>
      </div>
      <p class="text-sm text-fg-muted pb-2">{{ $strings.LabelRiceCurrent }}: {{ currentLabel }}</p>
      <p v-if="rice.recovery" class="text-sm text-warning pb-2" role="alert">{{ $strings.MessageRiceRecovered }}</p>
      <p v-if="rice.error === 'device-unavailable'" class="text-sm text-fg-muted pb-2">{{ $strings.MessageRiceDeviceUnavailable }}</p>
      <p v-if="error" class="text-sm text-error pb-2" role="alert">{{ error }}</p>

      <template v-if="!riceEnabled">
        <p class="text-sm text-fg-muted">{{ $strings.MessageRiceOffHelp }}</p>
      </template>

      <template v-else>
        <button v-if="canUseRemembered" class="w-full text-left py-3 flex items-center" @click="run(() => controller.useRemembered())"><span class="material-symbols mr-3" aria-hidden="true">history</span>{{ $strings.ButtonRiceUseLast }}</button>

        <p class="uppercase text-xs font-semibold text-fg-muted mt-6 mb-2">{{ $strings.HeaderRiceBuiltIn }}</p>
        <div v-for="theme in builtins" :key="theme.id" class="flex items-center border-b border-border">
          <button class="flex-grow text-left py-3 flex items-center" :aria-pressed="String(isSelected('builtin', theme.id))" @click="select({ kind: 'builtin', id: theme.id })">
            <span class="material-symbols w-6 mr-2" :class="isSelected('builtin', theme.id) ? 'text-fg' : 'opacity-0'" aria-hidden="true">check</span>
            {{ $strings[theme.labelKey] }}
            <span v-if="isSelected('builtin', theme.id)" class="sr-only">{{ $strings.LabelRiceActive }}</span>
          </button>
          <button class="w-10 h-10 flex items-center justify-center" :aria-label="`${$strings.ButtonRiceCustomizeCopy} ${$strings[theme.labelKey]}`" @click="customize({ kind: 'builtin', id: theme.id })"><span class="material-symbols text-fg-muted">edit</span></button>
        </div>

        <p class="uppercase text-xs font-semibold text-fg-muted mt-6 mb-2">{{ $strings.HeaderRiceStarters }}</p>
        <div v-for="starter in starters" :key="starter.id" class="flex items-center border-b border-border">
          <button class="flex-grow text-left py-3 flex items-center min-w-0" :aria-pressed="String(isSelected('starter', starter.id))" @click="select({ kind: 'starter', id: starter.id })">
            <span class="material-symbols w-6 mr-2" :class="isSelected('starter', starter.id) ? 'text-fg' : 'opacity-0'" aria-hidden="true">check</span>
            <span class="flex mr-3 flex-shrink-0" aria-hidden="true"><span v-for="(c, i) in swatches(starter.snapshot)" :key="i" class="w-4 h-6 first:rounded-l-sm last:rounded-r-sm" :style="{ backgroundColor: `rgb(${c.join(',')})` }" /></span>
            <span class="truncate">{{ starter.name }}</span>
            <span v-if="isSelected('starter', starter.id)" class="sr-only">{{ $strings.LabelRiceActive }}</span>
          </button>
          <button class="w-10 h-10 flex items-center justify-center" :aria-label="`${$strings.ButtonRiceCustomizeCopy} ${starter.name}`" @click="customize({ kind: 'starter', id: starter.id })"><span class="material-symbols text-fg-muted">edit</span></button>
        </div>

        <p class="uppercase text-xs font-semibold text-fg-muted mt-6 mb-2">{{ $strings.HeaderRiceDevice }}</p>
        <div v-for="mode in deviceModes" :key="mode.mode" class="flex items-center border-b border-border">
          <button class="flex-grow text-left py-3 flex items-center" :aria-pressed="String(isSelected('device', mode.mode))" @click="select({ kind: 'device', mode: mode.mode })">
            <span class="material-symbols w-6 mr-2" :class="isSelected('device', mode.mode) ? 'text-fg' : 'opacity-0'" aria-hidden="true">check</span>
            {{ $strings[mode.label] }}
          </button>
          <button v-if="rice.deviceAvailable" class="w-10 h-10 flex items-center justify-center" :aria-label="`${$strings.ButtonRiceFreezeDevice} ${$strings[mode.label]}`" @click="customize({ kind: 'device', mode: mode.mode })"><span class="material-symbols text-fg-muted">edit</span></button>
        </div>
        <p v-if="!rice.deviceAvailable" class="text-xs text-fg-muted mt-1">{{ $strings.MessageRiceDeviceUnavailable }}</p>

        <p class="uppercase text-xs font-semibold text-fg-muted mt-6 mb-2">{{ $strings.HeaderRicePresets }}</p>
        <p v-if="!rice.presets.length" class="text-sm text-fg-muted">{{ $strings.MessageRiceNoPresets }}</p>
        <div v-for="preset in rice.presets" :key="preset.id" class="border-b border-border">
          <div class="flex items-center">
            <button class="flex-grow text-left py-3 flex items-center min-w-0" :aria-pressed="String(isSelected('preset', preset.id))" @click="select({ kind: 'preset', id: preset.id })">
              <span class="material-symbols w-6 mr-2" :class="isSelected('preset', preset.id) ? 'text-fg' : 'opacity-0'" aria-hidden="true">check</span>
              <span class="flex mr-3 flex-shrink-0" aria-hidden="true"><span v-for="(c, i) in preset.swatches" :key="i" class="w-4 h-6" :style="{ backgroundColor: `rgb(${c.join(',')})` }" /></span>
              <span class="truncate" dir="auto">{{ preset.name }}</span>
            </button>
            <button class="w-10 h-10 flex items-center justify-center" :aria-label="`${$strings.ButtonRicePresetActions} ${preset.name}`" :aria-expanded="String(openPreset === preset.id)" @click="openPreset = openPreset === preset.id ? null : preset.id"><span class="material-symbols text-fg-muted">more_vert</span></button>
          </div>
          <div v-if="openPreset === preset.id" class="flex flex-wrap pb-3">
            <ui-btn small class="mr-2 mb-2" @click="customize({ kind: 'preset', id: preset.id })">{{ $strings.ButtonRiceEdit }}</ui-btn>
            <ui-btn small class="mr-2 mb-2" @click="rename(preset)">{{ $strings.ButtonRiceRename }}</ui-btn>
            <ui-btn small class="mr-2 mb-2" @click="run(() => controller.duplicate(preset.id, `${preset.name} copy`))">{{ $strings.ButtonRiceDuplicate }}</ui-btn>
            <ui-btn small color="error" class="mb-2" @click="remove(preset)">{{ $strings.ButtonDelete }}</ui-btn>
          </div>
        </div>
        <p class="text-xs text-fg-muted mt-1">{{ rice.presets.length }} / {{ maxPresets }}</p>

        <button class="w-full text-left py-3 mt-4 flex items-center" @click="importing = true">
          <span class="material-symbols mr-3" aria-hidden="true">download</span>
          <span>
            <span class="block">{{ $strings.ButtonRiceImport }}</span>
            <span class="block text-sm text-fg-muted">{{ $strings.MessageRiceImportSubtitle }}</span>
          </span>
        </button>

        <button class="w-full text-left py-3 flex items-center" @click="run(() => controller.restoreDefaults())"><span class="material-symbols mr-3" aria-hidden="true">settings_backup_restore</span>{{ $strings.ButtonRiceRestoreDefaults }}</button>

        <p class="uppercase text-xs font-semibold text-fg-muted mt-6 mb-2">{{ $strings.HeaderRiceCredits }}</p>
        <p class="text-xs text-fg-muted mb-2">{{ $strings.MessageRiceCredits }}</p>
        <div v-for="starter in starters" :key="`credit-${starter.id}`" class="text-xs text-fg-muted py-1">
          <p class="text-fg">{{ starter.name }} · {{ starter.attribution.license }}</p>
          <p class="font-mono break-all" dir="ltr">{{ starter.attribution.project.replace('https://', '') }} @ {{ starter.attribution.commit.slice(0, 12) }}</p>
          <p v-if="starter.attribution.note">{{ starter.attribution.note }}</p>
          <button v-for="notice in starter.attribution.notices" :key="notice" class="underline mr-3" @click="showNotice(notice)">{{ notice.split('/').pop() }}</button>
        </div>
      </template>
    </template>

    <modals-modal v-model="noticeOpen" :width="400" max-width="95%" height="80%">
      <div class="w-full h-full overflow-y-auto bg-primary rounded-md">
        <p class="px-4 pt-4 font-semibold" dir="ltr">{{ noticeTitle }}</p>
        <pre class="text-xs whitespace-pre-wrap p-4 text-fg" dir="ltr">{{ noticeText }}</pre>
      </div>
    </modals-modal>
  </div>
</template>

<script>
import { Dialog } from '@capacitor/dialog'
import themeEngine from '@/theme/engine'
import { STARTERS } from '@/theme/rice/catalog'
import { LIMITS } from '@/theme/rice/schema'

export default {
  data() {
    return {
      editing: null,
      importing: false,
      busy: false,
      error: null,
      openPreset: null,
      noticeOpen: false,
      noticeTitle: '',
      noticeText: '',
      starters: STARTERS,
      maxPresets: LIMITS.presets,
      deviceModes: [
        { mode: 'follow', label: 'LabelRiceDeviceFollow' },
        { mode: 'dark', label: 'LabelRiceDeviceDark' }
      ]
    }
  },
  computed: {
    controller() {
      return this.$theme.rice
    },
    rice() {
      return this.controller ? this.controller.state : { riceEnabled: false, presets: [], selection: null }
    },
    riceEnabled() {
      return !!this.rice.riceEnabled
    },
    builtins() {
      return themeEngine.THEMES
    },
    canUseRemembered() {
      const env = this.controller && this.controller.envelope
      return !!(env && env.rememberedRiceSelection && this.rice.selection && this.rice.selection.kind === 'builtin')
    },
    currentLabel() {
      const s = this.rice.selection
      if (!s || s.kind === 'builtin' || this.rice.kind === 'builtin') return this.$strings[this.$theme.theme.labelKey] || this.$theme.id
      if (s.kind === 'device') return this.$strings[s.mode === 'dark' ? 'LabelRiceDeviceDark' : 'LabelRiceDeviceFollow']
      return this.rice.label || this.$strings.LabelThemeCustom
    }
  },
  methods: {
    isSelected(kind, id) {
      const s = this.rice.selection
      return !!s && s.kind === kind && (s.id === id || s.mode === id)
    },
    swatches(snapshot) {
      const t = snapshot.tokens
      return [t['surface.base'], t['surface.raised'], t['text.primary'], t['accent.primary'], t['progress.played']]
    },
    async run(action) {
      if (this.busy || !this.controller) return
      this.busy = true
      this.error = null
      try {
        await action()
      } catch (error) {
        // Nothing changed: the committed appearance stays as it was
        this.error = error && error.code === 'capacity' ? this.$strings.MessageRicePresetLimit : this.$strings.MessageRiceSaveFailed
      } finally {
        this.busy = false
      }
    },
    toggleRice() {
      this.run(() => this.controller.setRiceEnabled(!this.riceEnabled))
    },
    select(selection) {
      this.run(() => this.controller.select(selection))
    },
    customize(selection) {
      const start = this.controller.sourceFor(selection)
      if (!start) return
      this.startEditing({ ...start, name: start.name || (selection.kind === 'builtin' ? this.$strings[themeEngine.getTheme(selection.id).labelKey] : start.name) || this.$strings.LabelThemeCustom })
    },
    startEditing(start) {
      this.importing = false
      this.editing = start
    },
    async rename(preset) {
      const { value, cancelled } = await Dialog.prompt({ title: this.$strings.ButtonRiceRename, message: this.$strings.LabelRicePresetName, inputText: preset.name })
      if (!cancelled && value) this.run(() => this.controller.rename(preset.id, value))
    },
    async remove(preset) {
      const { value } = await Dialog.confirm({ title: this.$strings.ButtonDelete, message: `${this.$strings.MessageRiceConfirmDelete} ${preset.name}` })
      if (value) this.run(() => this.controller.remove(preset.id))
    },
    async showNotice(path) {
      // Bundled license texts (static/licenses/rice), read from the app itself
      this.noticeTitle = path.split('/').pop()
      try {
        this.noticeText = await (await fetch(path)).text()
      } catch (e) {
        this.noticeText = path
      }
      this.noticeOpen = true
    }
  },
  beforeRouteLeave(to, from, next) {
    // Back/navigation discards an unsaved draft (Cancel semantics); the preview stylesheet goes with the editor
    this.editing = null
    this.importing = false
    next()
  },
  async mounted() {
    await this.$theme.ready
  }
}
</script>
