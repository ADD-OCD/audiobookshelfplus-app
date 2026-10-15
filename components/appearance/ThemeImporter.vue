<template>
  <!-- RICE "Import theme colors" (docs/rice-customization.md). The network part runs natively (AbsThemeImport: GitHub
       only, commit-pinned, bounded); files are parsed here as data. Nothing is applied: the result opens in the editor. -->
  <div class="w-full">
    <p class="text-sm text-fg-muted mb-3">{{ $strings.MessageRiceImportHelp }}</p>

    <template v-if="step === 'url' || step === 'resolving'">
      <label class="text-sm text-fg-muted" for="rice-import-url">{{ $strings.LabelRiceImportUrl }}</label>
      <input id="rice-import-url" v-model="url" class="w-full bg-primary border border-border rounded-md px-3 py-2 text-fg mt-1 font-mono text-sm" dir="ltr" inputmode="url" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="https://github.com/owner/repo" :disabled="step === 'resolving'" />
      <button class="text-sm text-fg underline py-2" :aria-expanded="String(showRef)" @click="showRef = !showRef">{{ $strings.ButtonRiceSpecifyRef }}</button>
      <div v-if="showRef">
        <label class="text-sm text-fg-muted" for="rice-import-ref">{{ $strings.LabelRiceImportRef }}</label>
        <input id="rice-import-ref" v-model="ref" class="w-full bg-primary border border-border rounded-md px-3 py-2 text-fg mt-1 font-mono text-sm" dir="ltr" autocapitalize="none" autocomplete="off" spellcheck="false" />
      </div>
      <div class="flex mt-3">
        <ui-btn class="mr-2" :loading="step === 'resolving'" :disabled="!url.trim()" @click="startImport">{{ $strings.ButtonRiceFindPalettes }}</ui-btn>
        <ui-btn v-if="step === 'resolving'" @click="cancel">{{ $strings.ButtonCancel }}</ui-btn>
      </div>
    </template>

    <template v-else-if="step === 'candidates' || step === 'reading'">
      <p class="text-sm mb-2">
        {{ project.owner }}/{{ project.repo }} · <span class="font-mono" dir="ltr">{{ project.commit.slice(0, 7) }}</span>
      </p>
      <p v-if="!candidates.length" class="text-sm text-fg-muted">{{ $strings.MessageRiceNoCandidates }}</p>
      <p v-if="truncated" class="text-sm text-fg-muted mb-2">{{ $strings.MessageRiceCandidatesTruncated }}</p>
      <button v-for="c in candidates" :key="c.id" class="w-full text-left py-3 border-b border-border flex items-center" :disabled="step === 'reading'" @click="choose(c)">
        <span class="material-symbols text-fg-muted mr-2" aria-hidden="true">description</span>
        <span class="font-mono text-sm flex-grow truncate" dir="ltr">{{ c.path }}</span>
        <span class="text-xs text-fg-muted">{{ $bytesPretty ? $bytesPretty(c.size) : c.size }}</span>
      </button>
      <ui-btn class="mt-3" @click="cancel">{{ $strings.ButtonCancel }}</ui-btn>
    </template>

    <template v-else-if="step === 'roles'">
      <p class="text-sm mb-2">{{ $strings.MessageRiceChooseRoles }}</p>
      <div v-for="role in roleNames" :key="role.key" class="py-2">
        <p class="text-sm mb-1" :id="`rice-role-${role.key}`">{{ $strings[role.label] }}</p>
        <div class="flex flex-wrap" role="radiogroup" :aria-labelledby="`rice-role-${role.key}`">
          <button
            v-for="(swatch, i) in uniqueSwatches"
            :key="i"
            class="w-10 h-10 rounded-md border-2 mr-2 mb-2 flex items-center justify-center"
            :class="sameColor(roles[role.key], swatch) ? 'border-fg' : 'border-border'"
            :style="{ backgroundColor: `rgb(${swatch.join(',')})` }"
            role="radio"
            :aria-checked="String(sameColor(roles[role.key], swatch))"
            :aria-label="`${$strings[role.label]} ${hex(swatch)}`"
            @click="$set(roles, role.key, swatch)"
          >
            <span v-if="sameColor(roles[role.key], swatch)" class="material-symbols text-lg" :style="{ color: checkColor(swatch) }" aria-hidden="true">check</span>
          </button>
        </div>
      </div>
      <div class="flex mt-3">
        <ui-btn class="mr-2" @click="review">{{ $strings.ButtonRiceContinue }}</ui-btn>
        <ui-btn @click="cancel">{{ $strings.ButtonCancel }}</ui-btn>
      </div>
    </template>

    <template v-else-if="step === 'review'">
      <appearance-theme-preview :snapshot="mapped.snapshot" class="mb-3" />
      <dl class="text-sm">
        <dt class="text-fg-muted">{{ $strings.LabelRiceSource }}</dt>
        <dd class="mb-2 font-mono text-xs break-all" dir="ltr">{{ project.owner }}/{{ project.repo }} · {{ file.path }} · {{ project.commit.slice(0, 12) }}</dd>
        <dt class="text-fg-muted">{{ $strings.LabelRiceFormat }}</dt>
        <dd class="mb-2">{{ formatLabel }}</dd>
        <dt class="text-fg-muted">{{ $strings.LabelRiceLicense }}</dt>
        <dd class="mb-2">{{ project.licensePath ? $strings.MessageRiceLicenseNotVerified : $strings.MessageRiceLicenseUnknown }}</dd>
      </dl>
      <p v-if="mapped.adjustments.length" class="text-xs text-fg-muted mb-2">{{ $strings.MessageRiceAdjusted }} {{ mapped.adjustments.map((a) => `${tokenLabel(a.token)} ${hex(a.from)} → ${hex(a.to)}`).join(', ') }}</p>
      <p v-if="mapped.unresolved.length" class="text-xs text-warning mb-2" role="alert">{{ $strings.MessageRiceUnresolved }}</p>
      <p class="text-xs text-fg-muted mb-3">{{ $strings.MessageRiceImportDataOnly }}</p>
      <div class="flex flex-wrap">
        <ui-btn class="mr-2 mb-2" @click="openProject">{{ $strings.ButtonRiceOpenProject }}</ui-btn>
        <ui-btn color="success" class="mr-2 mb-2" @click="customize">{{ $strings.ButtonRiceCustomizeSave }}</ui-btn>
        <ui-btn class="mb-2" @click="cancel">{{ $strings.ButtonCancel }}</ui-btn>
      </div>
    </template>

    <p v-if="error" class="text-error text-sm mt-3" role="alert">{{ error }}</p>
  </div>
</template>

<script>
import { Browser } from '@capacitor/browser'
import { AbsThemeImport } from '@/plugins/capacitor/AbsThemeImport'
import { detectAndParse, candidateScheme } from '@/theme/rice/import/parsers'
import { mapPalette, MAPPING_VERSION } from '@/theme/rice/mapping'
import { contrast, toHex } from '@/theme/rice/color'
import { validateSource, LIMITS } from '@/theme/rice/schema'

const ROLE_NAMES = [
  { key: 'background', label: 'LabelRiceBackground' },
  { key: 'raised', label: 'LabelRiceSurface' },
  { key: 'foreground', label: 'LabelRiceText' },
  { key: 'accent', label: 'LabelRiceAccent' },
  { key: 'progress', label: 'LabelRiceProgress' }
]
const FORMAT_LABELS = { 'pywal-json-v1': 'pywal JSON', 'kitty-colors-v1': 'Kitty', 'base-palette-v1': 'Base16/Base24', 'hex-list-v1': 'Hex color list' }

export default {
  data() {
    return {
      step: 'url',
      url: '',
      ref: '',
      showRef: false,
      generation: 0,
      sessionId: null,
      project: null,
      candidates: [],
      truncated: false,
      file: null,
      palette: null,
      roles: {},
      mapped: null,
      error: null,
      roleNames: ROLE_NAMES
    }
  },
  computed: {
    uniqueSwatches() {
      if (!this.palette) return []
      const seen = new Set()
      return this.palette.slots.filter((c) => !seen.has(c.join()) && seen.add(c.join()))
    },
    formatLabel() {
      return this.palette ? FORMAT_LABELS[this.palette.format] : ''
    }
  },
  beforeDestroy() {
    this.cancel()
  },
  methods: {
    hex(c) {
      return toHex(c)
    },
    tokenLabel(token) {
      const labels = { 'text.primary': 'LabelRiceText', 'text.muted': 'LabelRiceMutedText', 'border.default': 'LabelRiceBorder', 'progress.played': 'LabelRiceProgress', 'progress.track': 'LabelRiceProgressTrack', 'accent.primary': 'LabelRiceAccent' }
      return labels[token] ? this.$strings[labels[token]] : token
    },
    sameColor(a, b) {
      return !!a && !!b && a.join() === b.join()
    },
    checkColor(swatch) {
      return contrast(swatch, [0, 0, 0]) > contrast(swatch, [255, 255, 255]) ? '#000' : '#fff'
    },
    message(code, data) {
      const m = {
        pinterest: this.$strings.MessageRiceImportPinterest,
        'unsupported-platform': this.$strings.MessageRiceImportAndroidOnly,
        'rate-limited': this.$strings.MessageRiceImportRateLimited,
        'ref-not-found': this.$strings.MessageRiceImportRef,
        'bad-ref': this.$strings.MessageRiceImportRef,
        'not-public': this.$strings.MessageRiceImportNotPublic,
        'not-found': this.$strings.MessageRiceImportNotFound,
        'path-not-found': this.$strings.MessageRiceImportNotFound,
        network: this.$strings.MessageRiceImportNetwork,
        'time-budget': this.$strings.MessageRiceImportNetwork,
        symlink: this.$strings.MessageRiceImportNotRegular,
        executable: this.$strings.MessageRiceImportNotRegular,
        submodule: this.$strings.MessageRiceImportNotRegular,
        'unsupported-format': this.$strings.MessageRiceImportUnsupportedFormat
      }[code]
      const text = m || this.$strings.MessageRiceImportRejected
      return data && data.retryAfterSeconds ? `${text} (${Math.ceil(data.retryAfterSeconds / 60)} min)` : text
    },
    fail(error) {
      const code = error && (error.code || error.message)
      this.error = this.message(code, error && error.data)
    },
    async startImport() {
      const generation = ++this.generation
      this.error = null
      this.step = 'resolving'
      try {
        const result = await AbsThemeImport.start({ url: this.url.trim(), ref: this.showRef && this.ref.trim() ? this.ref.trim() : undefined })
        if (generation !== this.generation) return // canceled or replaced: late result discarded
        this.sessionId = result.sessionId
        this.project = { owner: result.owner, repo: result.repo, commit: result.commit, projectUrl: result.projectUrl, licensePath: result.licensePath }
        this.candidates = result.candidates
        this.truncated = result.truncated
        if (result.candidates.length === 1) return this.choose(result.candidates[0])
        this.step = 'candidates'
      } catch (error) {
        if (generation !== this.generation) return
        this.step = 'url'
        this.fail(error)
      }
    },
    async choose(candidate) {
      const generation = this.generation
      this.error = null
      this.step = 'reading'
      try {
        const file = await AbsThemeImport.readCandidate({ sessionId: this.sessionId, candidateId: candidate.id })
        if (generation !== this.generation) return
        this.file = file
        this.palette = detectAndParse(file.text)
        const r = this.palette.roles
        if (this.palette.needsRoles) {
          // Starting guesses only; the user confirms every role
          const slots = this.palette.slots
          const background = slots[0]
          const foreground = slots.reduce((best, c) => (contrast(c, background) > contrast(best, background) ? c : best), slots[1])
          // Surfaces: the other swatch closest in brightness to the background
          const others = slots.filter((c) => c.join() !== background.join())
          const raised = others.reduce((best, c) => (contrast(c, background) < contrast(best, background) ? c : best), others[0])
          this.roles = { background, raised, foreground, accent: slots[1], progress: slots[1] }
          this.step = 'roles'
        } else {
          this.roles = { background: r.background, foreground: r.foreground, accent: r.accent, progress: r.progress }
          this.review()
        }
      } catch (error) {
        if (generation !== this.generation) return
        this.step = this.candidates.length > 1 ? 'candidates' : 'url'
        this.fail(error.name === 'PaletteError' ? { code: error.code === 'unsupported-format' ? 'unsupported-format' : 'rejected' } : error)
      }
    },
    review() {
      const r = this.palette.needsRoles ? {} : this.palette.roles
      const input = { ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)), ...Object.fromEntries(Object.entries(this.roles).filter(([, v]) => v)) }
      const scheme = this.palette.needsRoles ? null : candidateScheme(this.palette)
      this.mapped = mapPalette({ ...input, scheme: scheme || undefined })
      this.step = 'review'
    },
    sourceRecord() {
      const license = this.project.licensePath ? 'Not verified (project license file)' : 'Unknown'
      const source = {
        kind: 'github',
        url: this.project.projectUrl,
        owner: this.project.owner,
        repo: this.project.repo,
        commit: this.project.commit,
        path: this.file.path,
        sha256: this.file.sha256,
        format: this.palette.format,
        colors: this.palette.slots.slice(0, LIMITS.sourceColors),
        mappingVersion: MAPPING_VERSION,
        attribution: `${this.project.owner}/${this.project.repo}${this.palette.author ? ` (${String(this.palette.author).slice(0, 80)})` : ''}`.slice(0, LIMITS.attribution),
        license,
        adjustments: this.mapped.adjustments.slice(0, LIMITS.adjustments)
      }
      if (this.project.licensePath) source.licenseUrl = `${this.project.projectUrl}/blob/${this.project.commit}/${this.project.licensePath}`
      return validateSource(source).ok ? source : { kind: 'manual' }
    },
    customize() {
      const name = (this.palette.name || this.project.repo).slice(0, 48)
      this.$emit('edit', { snapshot: this.mapped.snapshot, source: this.sourceRecord(), name, adjustments: this.mapped.adjustments })
      this.finish()
    },
    openProject() {
      // Opened only on request, in the system browser; never loaded into the app
      Browser.open({ url: `${this.project.projectUrl}/blob/${this.project.commit}/${this.file.path}` }).catch(() => {})
    },
    finish() {
      if (this.sessionId) AbsThemeImport.cancel({ sessionId: this.sessionId }).catch(() => {})
      this.sessionId = null
    },
    cancel() {
      this.generation++
      this.finish()
      this.step = 'url'
      this.candidates = []
      this.palette = null
      this.mapped = null
      this.file = null
      this.$emit('cancel')
    }
  }
}
</script>
