<template>
  <!-- RICE preset editor (docs/rice-customization.md, "Editing"). Edits change a draft shown only in the preview below;
       nothing is applied or saved until Save. Leaving the page or Cancel discards the draft. -->
  <div class="w-full">
    <appearance-theme-preview :snapshot="draft" class="mb-4" />

    <div class="mb-4">
      <label class="text-sm text-fg-muted" :for="'rice-name'">{{ $strings.LabelRicePresetName }}</label>
      <input id="rice-name" v-model="name" maxlength="64" class="w-full bg-primary border border-border rounded-md px-3 py-2 text-fg mt-1" dir="auto" />
      <p v-if="nameError" class="text-error text-sm mt-1" role="alert">{{ $strings.MessageRiceNameInvalid }}</p>
    </div>

    <p v-if="locked" class="text-sm text-fg-muted mb-3">{{ $strings.MessageRiceLlamaLocked }}</p>

    <p class="uppercase text-xs font-semibold text-fg-muted mb-2">{{ $strings.HeaderRiceColors }}</p>
    <div v-for="field in visibleColorFields" :key="field.token" class="flex items-center py-2">
      <span class="w-8 h-8 rounded-md border border-border flex-shrink-0" :style="{ backgroundColor: css(field.token) }" role="img" :aria-label="`${$strings[field.label]} ${hex(field.token)}`" />
      <label class="pl-3 flex-grow min-w-0" :for="`rice-${field.token}`">{{ $strings[field.label] }}</label>
      <input :id="`rice-${field.token}-picker`" type="color" class="w-10 h-8 bg-transparent border-0 p-0 mr-2" :value="hex(field.token).toLowerCase()" :aria-label="$strings[field.label]" @input="setColor(field.token, $event.target.value)" />
      <input :id="`rice-${field.token}`" class="w-24 bg-primary border rounded-md px-2 py-1 text-fg font-mono text-sm" :class="fieldErrors[field.token] ? 'border-error' : 'border-border'" dir="ltr" maxlength="7" :value="fieldText[field.token] !== undefined ? fieldText[field.token] : hex(field.token)" @input="typeHex(field.token, $event.target.value)" />
      <button class="ml-1 w-9 h-9 flex items-center justify-center" :aria-label="`${$strings.ButtonRiceResetValue} ${$strings[field.label]}`" @click="resetToken(field.token)"><span class="material-symbols text-lg text-fg-muted">restart_alt</span></button>
    </div>
    <p v-if="Object.keys(fieldErrors).length" class="text-error text-sm" role="alert">{{ $strings.MessageRiceHexInvalid }}</p>

    <button class="text-sm text-fg underline py-2" :aria-expanded="String(showAdvanced)" @click="showAdvanced = !showAdvanced">{{ showAdvanced ? $strings.ButtonRiceFewerOptions : $strings.ButtonRiceMoreOptions }}</button>

    <template v-if="showAdvanced && !locked">
      <p class="uppercase text-xs font-semibold text-fg-muted mt-4 mb-2">{{ $strings.HeaderRiceStyle }}</p>
      <div v-for="option in appearanceFields" :key="option.key" class="flex items-center py-2">
        <label class="flex-grow" :for="`rice-${option.key}`">{{ $strings[option.label] }}</label>
        <select :id="`rice-${option.key}`" class="bg-primary border border-border rounded-md px-2 py-1 text-fg" :value="String(draft.appearance[option.key])" @change="setAppearance(option.key, $event.target.value)">
          <option v-for="value in options[option.key]" :key="String(value)" :value="String(value)">{{ optionLabel(option.key, value) }}</option>
        </select>
      </div>
      <button class="text-sm text-fg underline py-2" @click="resetCategory('appearance')">{{ $strings.ButtonRiceResetStyle }}</button>
    </template>

    <div class="mt-4 p-3 rounded-md bg-primary border" :class="report.ok ? 'border-border' : 'border-error'" aria-live="polite">
      <p v-if="report.ok" class="text-sm flex items-center"><span class="material-symbols text-base mr-1 text-success" aria-hidden="true">check_circle</span>{{ $strings.MessageRiceContrastOk }}</p>
      <template v-else>
        <p class="text-sm flex items-center"><span class="material-symbols text-base mr-1 text-warning" aria-hidden="true">warning</span>{{ $strings.MessageRiceContrastLow }}</p>
        <ul class="text-xs text-fg-muted mt-1">
          <li v-for="f in report.failures.slice(0, 6)" :key="f.a + f.b">{{ pairLabel(f) }}</li>
        </ul>
        <ui-btn small class="mt-2" @click="autoFix">{{ $strings.ButtonRiceFixContrast }}</ui-btn>
      </template>
    </div>
    <p v-if="adjustments.length" class="text-xs text-fg-muted mt-2">{{ $strings.MessageRiceAdjusted }} {{ adjustments.map((a) => `${tokenLabel(a.token)} ${hexOf(a.from)} → ${hexOf(a.to)}`).join(', ') }}</p>

    <button class="text-sm text-fg underline py-2 mt-2" @click="resetAll">{{ $strings.ButtonRiceRestoreStart }}</button>

    <p v-if="error" class="text-error text-sm mt-2" role="alert">{{ error }}</p>
    <div class="flex flex-wrap mt-4">
      <ui-btn color="success" class="mr-2 mb-2" :disabled="!canSave" :loading="saving" @click="save('apply')">{{ $strings.ButtonRiceSaveApply }}</ui-btn>
      <ui-btn class="mr-2 mb-2" :disabled="!canSave || saving" @click="save('save')">{{ $strings.ButtonSave }}</ui-btn>
      <ui-btn class="mb-2" :disabled="saving" @click="$emit('close')">{{ $strings.ButtonCancel }}</ui-btn>
    </div>
  </div>
</template>

<script>
import { parseHex, toHex } from '@/theme/rice/color'
import { evaluateContrast, repairColor, thresholds } from '@/theme/rice/contrast'
import { APPEARANCE_OPTIONS, validateSnapshot, normalizeName, deepClone } from '@/theme/rice/schema'

// Editable roles. Editing one updates the tokens that share its purpose (e.g. Background also sets the content
// surface, the solid overlays and the owned system-bar background) so the draft stays consistent.
const COLOR_FIELDS = [
  { token: 'surface.base', label: 'LabelRiceBackground', linked: ['surface.content', 'overlay.item-header', 'overlay.player', 'system.status-bar', 'system.navigation-bar'], basic: true },
  { token: 'surface.raised', label: 'LabelRiceSurface', linked: ['control.toggle', 'overlay.mini-player'], basic: true },
  { token: 'text.primary', label: 'LabelRiceText', linked: ['text.default'], basic: true },
  { token: 'text.muted', label: 'LabelRiceMutedText', linked: [], basic: true },
  { token: 'accent.primary', label: 'LabelRiceAccent', linked: [], basic: true },
  { token: 'progress.played', label: 'LabelRiceProgress', linked: [], basic: true },
  { token: 'surface.hover', label: 'LabelRiceSelection', linked: ['control.toggle-selected'], basic: false },
  { token: 'border.default', label: 'LabelRiceBorder', linked: [], basic: false },
  { token: 'progress.track', label: 'LabelRiceProgressTrack', linked: [], basic: false },
  { token: 'progress.buffered', label: 'LabelRiceProgressBuffered', linked: [], basic: false }
]
const APPEARANCE_FIELDS = [
  { key: 'interfaceFont', label: 'LabelRiceInterfaceFont' },
  { key: 'displayFont', label: 'LabelRiceDisplayFont' },
  { key: 'weight', label: 'LabelRiceWeight' },
  { key: 'textScale', label: 'LabelRiceTextSize' },
  { key: 'radius', label: 'LabelRiceCorners' },
  { key: 'frame', label: 'LabelRiceArtworkFrame' },
  { key: 'borderWidth', label: 'LabelRiceButtonBorder' },
  { key: 'shadow', label: 'LabelRiceShadow' },
  { key: 'finish', label: 'LabelRiceFinish' }
]
const OVERLAYS = ['overlay.item-header', 'overlay.player', 'overlay.mini-player']

export default {
  props: {
    /** { snapshot, reset?, source, name, presetId?, adjustments? } */
    start: { type: Object, required: true }
  },
  data() {
    return {
      draft: deepClone(this.start.snapshot),
      original: deepClone(this.start.reset || this.start.snapshot),
      name: this.start.name || '',
      fieldText: {},
      fieldErrors: {},
      showAdvanced: false,
      saving: false,
      error: null,
      nameError: false,
      options: APPEARANCE_OPTIONS,
      appearanceFields: APPEARANCE_FIELDS,
      adjustments: this.start.adjustments ? deepClone(this.start.adjustments) : []
    }
  },
  computed: {
    locked() {
      return this.draft.baseId === 'llama'
    },
    visibleColorFields() {
      return COLOR_FIELDS.filter((f) => f.basic || this.showAdvanced)
    },
    report() {
      return evaluateContrast(this.draft)
    },
    canSave() {
      return this.report.ok && validateSnapshot(this.draft).ok && !Object.keys(this.fieldErrors).length
    }
  },
  methods: {
    color(token) {
      const v = this.draft.tokens[token]
      return Array.isArray(v) ? v : v.color
    },
    css(token) {
      return `rgb(${this.color(token).join(',')})`
    },
    hex(token) {
      return toHex(this.color(token))
    },
    hexOf(c) {
      return toHex(c)
    },
    tokenLabel(token) {
      const field = COLOR_FIELDS.find((f) => f.token === token)
      return field ? this.$strings[field.label] : token
    },
    pairLabel(f) {
      const name = (t) => (t === '#white' ? this.$strings.LabelRiceWhiteLabels : t === '#black' ? this.$strings.LabelRiceDarkIcons : this.tokenLabel(t))
      return `${name(f.a)} / ${name(f.b)}: ${f.ratio.toFixed(2)}:1 (${f.min}:1)`
    },
    optionLabel(key, value) {
      const labels = {
        interfaceFont: { system: this.$strings.LabelRiceSystemFont, 'source-sans': 'Source Sans' },
        displayFont: { system: this.$strings.LabelRiceSystemFont, 'system-mono': this.$strings.LabelRiceMonospace, 'ubuntu-mono': 'Ubuntu Mono' },
        frame: { none: this.$strings.LabelRiceNone, inset: this.$strings.LabelRiceInset },
        shadow: { none: this.$strings.LabelRiceAppDefault, soft: this.$strings.LabelRiceSoft },
        finish: { flat: this.$strings.LabelRiceFlat, bevel: this.$strings.LabelRiceBevel },
        textScale: { 1: '100%', 1.1: '110%', 1.2: '120%' },
        radius: { 4: this.$strings.LabelRiceAppDefault, 0: '0 px', 8: '8 px', 12: '12 px' },
        borderWidth: { 0: this.$strings.LabelRiceNone, 1: '1 px', 2: '2 px' },
        weight: { 400: this.$strings.LabelRiceRegular, 600: this.$strings.LabelRiceSemibold }
      }
      return (labels[key] && labels[key][value]) || String(value)
    },
    write(token, rgb) {
      const field = COLOR_FIELDS.find((f) => f.token === token)
      for (const t of [token, ...(field ? field.linked : [])]) {
        if (OVERLAYS.includes(t)) this.draft.tokens[t] = { kind: 'solid', color: rgb.slice() }
        else this.draft.tokens[t] = rgb.slice()
      }
      if (token === 'surface.base') this.draft.tokens['system.bar-icons'] = this.draft.colorScheme === 'light' ? 'dark' : 'light'
    },
    setColor(token, value) {
      const rgb = parseHex(String(value).toUpperCase())
      if (!rgb) return
      this.$delete(this.fieldText, token)
      this.$delete(this.fieldErrors, token)
      this.write(token, rgb)
    },
    // Invalid text stays visible with an error and is never applied; the last valid color stays in the preview
    typeHex(token, value) {
      this.$set(this.fieldText, token, value)
      const rgb = parseHex(value.trim().startsWith('#') ? value.trim() : '#' + value.trim())
      if (!rgb) {
        this.$set(this.fieldErrors, token, true)
        return
      }
      this.$delete(this.fieldErrors, token)
      this.write(token, rgb)
    },
    resetToken(token) {
      this.$delete(this.fieldText, token)
      this.$delete(this.fieldErrors, token)
      const v = this.original.tokens[token]
      this.write(token, Array.isArray(v) ? v : v.color)
    },
    resetCategory() {
      this.draft.appearance = deepClone(this.original.appearance)
    },
    resetAll() {
      this.fieldText = {}
      this.fieldErrors = {}
      this.draft = deepClone(this.original)
    },
    setAppearance(key, raw) {
      const value = this.options[key].find((v) => String(v) === raw)
      if (value !== undefined && !this.locked) this.draft.appearance = { ...this.draft.appearance, [key]: value }
    },
    // Repairs only the failing foreground/indicator values (never backgrounds), and shows each change
    autoFix() {
      const min = thresholds(false)
      for (let pass = 0; pass < 3 && !this.report.ok; pass++) {
        for (const f of this.report.failures) {
          if (f.a.startsWith('#') || f.a.startsWith('overlay.')) {
            // Fixed white labels / player glyphs: darken or lighten the fill instead
            if (['state.success-action', 'state.error'].includes(f.b)) this.fix(f.b, [{ against: [255, 255, 255], min: min.text }])
            continue
          }
          const against = this.color(f.b)
          this.fix(f.a, [{ against, min: f.min }])
        }
      }
    },
    fix(token, constraints) {
      const from = this.color(token)
      const result = repairColor(from, constraints)
      if (result.changed) {
        this.adjustments.push({ token, from: from.slice(), to: result.color })
        this.write(token, result.color)
      }
    },
    async save(mode) {
      const name = normalizeName(this.name)
      this.nameError = !name
      if (!name || !this.canSave) return
      this.saving = true
      this.error = null
      try {
        await this.$theme.rice.saveDraft({ snapshot: deepClone(this.draft), name, source: this.start.source, presetId: this.start.presetId || null, mode })
        this.$toast.success(mode === 'apply' ? this.$strings.ToastRiceApplied : this.$strings.ToastRiceSaved)
        this.$emit('close')
      } catch (error) {
        // Nothing was saved: the committed appearance is unchanged and the draft stays here to retry
        this.error = error && error.code === 'capacity' ? this.$strings.MessageRicePresetLimit : this.$strings.MessageRiceSaveFailed
      } finally {
        this.saving = false
      }
    }
  }
}
</script>
