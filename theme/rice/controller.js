/**
 * RICE controller (docs/rice-customization.md, "Service"): resolves the saved selection to an appearance, applies it,
 * and runs every change as one store commit. Attached to the existing $theme service by plugins/rice.client.js; the
 * built-in theme path (ThemeService.select/apply) is unchanged when RICE is off.
 *
 * Boundaries are injected (document, store, native appearance bridge, widgets, clock, randomness), so tests drive it
 * without a WebView. It never calls playback, queue, download or auth code.
 */
const engine = require('../engine')
const S = require('./schema')
const ops = require('./store')
const { getStarter, STARTERS } = require('./catalog')
const { mapDevice, snapshotFromTheme, widgetColors } = require('./mapping')
const { evaluateContrast } = require('./contrast')
const runtime = require('./runtime')

const CUSTOM_ID = 'rice-custom'

/** A validated theme object for consumers of $theme.theme (cover presentation, player chrome, reader shell). */
function themeFromSnapshot(snapshot) {
  const { theme } = engine.validateTheme({ id: CUSTOM_ID, labelKey: 'LabelThemeCustom', colorScheme: snapshot.colorScheme, tokens: snapshot.tokens }, engine.getTheme(snapshot.colorScheme === 'light' ? 'light' : 'dark').tokens)
  return theme
}

class RiceController {
  /**
   * @param {object} deps
   * @param {object} deps.service    the existing ThemeService (apply/applySystemBars/refreshWidgets)
   * @param {object} deps.store      PresetStore
   * @param {Document} deps.doc
   * @param {object} [deps.appearance] native bridge: getDeviceAppearance(), applyNativeAppearance(), addListener()
   * @param {(o: object) => object} [deps.observable]
   * @param {() => string} [deps.now] ISO time
   * @param {(n: number) => Uint8Array} [deps.randomBytes]
   */
  constructor({ service, store, doc, appearance = null, observable = (o) => o, now = () => new Date().toISOString(), randomBytes }) {
    this.service = service
    this.store = store
    this.doc = doc
    this.appearance = appearance
    this.now = now
    this.randomBytes = randomBytes
    this.envelope = null
    this.persisted = false
    this.device = null // last accepted DeviceAppearance from native
    this.deviceSession = null
    this.generation = 0
    this.state = observable({ ready: false, riceEnabled: false, selection: null, kind: 'builtin', label: null, resolved: null, revision: 0, recovery: null, presets: [], deviceAvailable: false, deviceNight: null, error: null })
  }

  async init() {
    const loaded = await this.store.load()
    this.envelope = loaded.envelope
    this.persisted = loaded.persisted
    this.state.recovery = loaded.recovery
    await this.refreshDevice()
    this.applyEnvelope()
    this.state.ready = true
    return this.state
  }

  /** Subscribes to native device appearance changes (listener first, then a fresh snapshot). */
  async subscribe() {
    if (!this.appearance || !this.appearance.addListener) return
    await this.appearance.addListener('deviceAppearanceChanged', (snapshot) => this.onDeviceAppearance(snapshot))
    await this.refreshDevice()
  }

  async refreshDevice() {
    if (!this.appearance) return
    try {
      const snapshot = await this.appearance.getDeviceAppearance()
      this.onDeviceAppearance(snapshot, { apply: false })
    } catch (e) {
      // Unavailable bridge: device modes fall back to built-ins
    }
  }

  /** Orders device snapshots by native session + sequence; duplicates (same content hash) do nothing. */
  onDeviceAppearance(snapshot, { apply = true } = {}) {
    if (!snapshot || typeof snapshot.sessionId !== 'string' || !Number.isSafeInteger(snapshot.sequence)) return false
    if (this.device && this.device.sessionId === snapshot.sessionId && snapshot.sequence <= this.device.sequence) return false
    const same = this.device && this.device.paletteRevision === snapshot.paletteRevision && this.device.night === snapshot.night && this.device.contrast === snapshot.contrast
    this.device = snapshot
    this.state.deviceAvailable = !!snapshot.paletteAvailable
    this.state.deviceNight = !!snapshot.night
    if (same || !apply) return false
    if (this.envelope && this.envelope.riceEnabled && this.envelope.selection.kind === 'device') {
      this.applyEnvelope()
      this.service.refreshWidgets()
    }
    return true
  }

  // --- Resolution ---

  /** Resolves a selection to { kind, label, snapshot|null, builtinId|null, fallback } without side effects. */
  resolve(selection, envelope = this.envelope) {
    const builtin = (id, fallback = null) => ({ kind: 'builtin', builtinId: id, snapshot: null, label: null, fallback })
    if (!envelope.riceEnabled || selection.kind === 'builtin') return builtin(selection.kind === 'builtin' ? selection.id : envelope.lastBuiltin)
    if (selection.kind === 'starter') {
      const starter = getStarter(selection.id)
      return starter ? { kind: 'starter', snapshot: starter.snapshot, label: starter.name, builtinId: null } : builtin(envelope.lastBuiltin, 'missing-starter')
    }
    if (selection.kind === 'preset') {
      const preset = envelope.presets.find((p) => p.id === selection.id)
      return preset ? { kind: 'preset', snapshot: preset.snapshot, label: preset.name, builtinId: null, presetId: preset.id } : builtin(envelope.lastBuiltin, 'missing-preset')
    }
    if (selection.kind === 'device') {
      const night = selection.mode === 'dark' ? true : this.device ? !!this.device.night : true
      const mapped = this.device && this.device.paletteAvailable ? mapDevice(this.device.tones, { night, highContrast: (this.device.contrast || 0) > 0 }) : null
      if (mapped && evaluateContrast(mapped.snapshot).ok) return { kind: 'device', snapshot: mapped.snapshot, label: null, builtinId: null, deviceMode: selection.mode }
      // No platform palette (Android < 12) or an unusable one: follow only light/dark with the built-ins
      return builtin(night ? 'dark' : 'light', 'device-unavailable')
    }
    return builtin(envelope.lastBuiltin, 'invalid-selection')
  }

  applyEnvelope() {
    const resolved = this.resolve(this.envelope.selection)
    this.applyResolved(resolved)
    this.state.riceEnabled = this.envelope.riceEnabled
    this.state.selection = S.deepClone(this.envelope.selection)
    this.state.presets = this.envelope.presets.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, baseId: p.snapshot.baseId, swatches: swatches(p.snapshot), source: p.source.kind }))
    this.state.revision = this.envelope.revision
  }

  applyResolved(resolved) {
    if (resolved.snapshot) {
      runtime.applyRice(this.doc, resolved.snapshot)
      const theme = themeFromSnapshot(resolved.snapshot)
      this.service.state.id = resolved.snapshot.baseId
      this.service.state.resolved = theme
      this.service.applySystemBars(theme)
      this.native({ enabled: true, background: resolved.snapshot.tokens['surface.base'], iconBrightness: resolved.snapshot.tokens['system.bar-icons'] })
    } else {
      runtime.clearRice(this.doc)
      this.service.state.resolved = null
      this.service.apply(resolved.builtinId)
      this.native({ enabled: false, background: [35, 35, 35], iconBrightness: 'light' })
    }
    this.state.kind = resolved.kind
    this.state.label = resolved.label
    this.state.resolved = resolved.snapshot ? S.deepClone(resolved.snapshot) : null
    this.state.error = resolved.fallback || null
  }

  native(options) {
    if (!this.appearance || !this.appearance.applyNativeAppearance) return
    Promise.resolve()
      .then(() => this.appearance.applyNativeAppearance({ revision: Math.max(1, this.envelope ? this.envelope.revision : 1), ...options }))
      .catch(() => {})
  }

  // --- Transactions: build a candidate, commit it, then publish ---

  async transact(build) {
    const generation = ++this.generation
    const candidate = build(S.deepClone(this.envelope))
    const resolved = this.resolve(candidate.selection, candidate)
    const withWidget = ops.setWidget(candidate, this.widgetProjection(candidate, resolved))
    const committed = await this.store.commit(withWidget, this.envelope.revision)
    this.envelope = committed
    this.persisted = true
    this.state.recovery = null
    if (generation === this.generation) this.applyEnvelope()
    this.service.refreshWidgets()
    return committed
  }

  widgetProjection(envelope, resolved) {
    if (!envelope.riceEnabled || !resolved.snapshot) return null
    return {
      revision: envelope.revision + 1,
      selectionKind: resolved.kind,
      deviceMode: resolved.kind === 'device' ? envelope.selection.mode : null,
      family: resolved.snapshot.baseId === 'llama' ? 'llama' : 'standard',
      colors: widgetColors(resolved.snapshot)
    }
  }

  setRiceEnabled(enabled) {
    return this.transact((env) => ops.setRiceEnabled(env, enabled))
  }

  /** Applies a built-in, starter, preset or device selection. */
  select(selection) {
    return this.transact((env) => ops.selectAppearance(env, selection))
  }

  /** The built-in picker (Settings) while a RICE store exists: same commit path, so the selection stays authoritative. */
  selectBuiltin(id) {
    return this.select({ kind: 'builtin', id: engine.resolveThemeId(id) })
  }

  /**
   * The legacy built-in path persisted a choice (RICE never saved yet): keep the in-memory starting envelope in step,
   * so a later first RICE commit starts from the built-in the user actually chose.
   */
  noteBuiltin(id) {
    if (this.persisted || !this.envelope) return
    this.envelope = ops.initialEnvelope(engine.resolveThemeId(id))
    this.state.selection = S.deepClone(this.envelope.selection)
  }

  /** "Use last custom appearance" */
  useRemembered() {
    if (!this.envelope.rememberedRiceSelection) return Promise.resolve(this.envelope)
    return this.select(this.envelope.rememberedRiceSelection)
  }

  /** Turns RICE off and returns to the last built-in. Presets are kept. */
  restoreDefaults() {
    return this.setRiceEnabled(false)
  }

  newId() {
    return S.newPresetId(this.randomBytes)
  }

  rename(id, name) {
    return this.transact((env) => ops.updatePreset(env, id, { name, now: this.now() }))
  }

  duplicate(id, name) {
    return this.transact((env) => ops.duplicatePreset(env, id, { newId: this.newId(), name, now: this.now() }))
  }

  remove(id) {
    return this.transact((env) => ops.deletePreset(env, id))
  }

  // --- Sources for a new custom copy ---

  /** Starting snapshot + source record for "Customize a copy" of a built-in, starter, device colors or a preset. */
  sourceFor(selection) {
    if (selection.kind === 'builtin') {
      const { snapshot, adjustments } = snapshotFromTheme(engine.getTheme(selection.id))
      return { snapshot, adjustments, source: { kind: 'builtin', id: selection.id }, name: null }
    }
    if (selection.kind === 'starter') {
      const starter = getStarter(selection.id)
      return { snapshot: S.deepClone(starter.snapshot), adjustments: starter.adjustments, source: { kind: 'starter', id: starter.id }, name: starter.name }
    }
    if (selection.kind === 'device') {
      const resolved = this.resolve(selection, { ...this.envelope, riceEnabled: true })
      if (!resolved.snapshot) return null
      return { snapshot: S.deepClone(resolved.snapshot), adjustments: [], source: { kind: 'device', mode: selection.mode }, name: null }
    }
    if (selection.kind === 'preset') {
      const preset = this.envelope.presets.find((p) => p.id === selection.id)
      return preset ? { snapshot: S.deepClone(preset.snapshot), adjustments: [], source: S.deepClone(preset.source), name: preset.name, presetId: preset.id, reset: S.deepClone(preset.reset) } : null
    }
    return null
  }

  /**
   * Saves a draft snapshot. mode 'apply' saves and selects it; 'save' saves without changing the active appearance.
   * An existing preset id updates that preset; otherwise a new preset is created. Contrast must pass to persist.
   */
  async saveDraft({ snapshot, name, source, presetId = null, mode = 'apply' }) {
    const valid = S.validateSnapshot(snapshot)
    if (!valid.ok) throw new ops.StoreError('invalid-snapshot', valid.errors[0])
    const report = evaluateContrast(snapshot)
    if (!report.ok) throw Object.assign(new ops.StoreError('contrast'), { failures: report.failures })
    const now = this.now()
    const id = presetId || this.newId()
    return this.transact((env) => {
      let next = presetId ? ops.updatePreset(env, presetId, { snapshot, name, now }) : ops.addPreset(env, ops.makePreset({ id, name, snapshot, source, now }))
      if (mode === 'apply') next = ops.selectAppearance(next, { kind: 'preset', id })
      return next
    }).then((env) => ({ envelope: env, presetId: id }))
  }
}

function swatches(snapshot) {
  const t = snapshot.tokens
  return [t['surface.base'], t['surface.raised'], t['text.primary'], t['accent.primary'], t['progress.played']]
}

module.exports = { RiceController, themeFromSnapshot, CUSTOM_ID, STARTERS }
