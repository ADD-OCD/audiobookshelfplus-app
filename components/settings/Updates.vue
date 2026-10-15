<template>
  <div>
    <p class="uppercase text-xs font-semibold text-fg-muted mb-2 mt-10">{{ $strings.HeaderUpdates }}</p>
    <div class="py-2 flex flex-wrap items-baseline gap-x-2">
      <p class="w-36 min-w-min">{{ $strings.LabelInstalledVersion }}</p>
      <p class="text-fg-muted">{{ installedText }}</p>
    </div>
    <div v-if="lastCheckedText" class="py-1 flex flex-wrap items-baseline gap-x-2">
      <p class="w-36 min-w-min">{{ $strings.LabelLastChecked }}</p>
      <p class="text-fg-muted">{{ lastCheckedText }}</p>
    </div>

    <div v-if="view.showCandidate" class="py-2" data-testid="update-candidate">
      <p class="font-semibold">{{ $strings.LabelLatestRelease }}: v{{ status.candidate.version }}</p>
      <p class="text-xs text-fg-muted">{{ candidateMeta }}</p>
      <p v-if="status.candidate.summary" class="text-sm text-fg-muted mt-1 break-words">{{ status.candidate.summary }}</p>
    </div>

    <p v-if="view.statusKey" class="text-sm py-1 break-words" role="status" aria-live="polite">{{ statusText }}</p>
    <div v-if="view.showProgress" class="py-2" data-testid="update-progress">
      <div class="w-full h-2 rounded-full bg-border overflow-hidden" role="progressbar" :aria-valuenow="view.percent" aria-valuemin="0" aria-valuemax="100">
        <div class="h-full bg-success" :style="{ width: view.percent + '%' }" />
      </div>
      <p class="text-xs text-fg-muted mt-1">{{ view.percent }}% · {{ $bytesPretty(status.downloadedBytes) }} / {{ $bytesPretty(status.totalBytes) }}</p>
    </div>
    <p v-if="view.noticeKey" class="text-sm text-fg-muted py-1 break-words">{{ $strings[view.noticeKey] }}</p>
    <p v-if="view.errorKey" class="text-sm text-error py-1 break-words" role="alert">{{ $strings[view.errorKey] }}</p>
    <p v-if="view.permissionNote" class="text-sm py-1 break-words">{{ $strings.MessageUpdatePermission }}</p>
    <p v-if="view.debugNote" class="text-xs text-fg-muted py-1 break-words">{{ $strings.MessageUpdateDebugBuild }}</p>

    <!-- Wraps to more rows on narrow screens / large font sizes; labels never shrink or truncate -->
    <div v-if="view.actions.length" class="flex flex-wrap gap-2 pt-2 pb-4" role="group" :aria-label="$strings.HeaderUpdates">
      <ui-btn v-for="action in buttons" :key="action.id" small class="min-h-12" :loading="action.loading" :disabled="busy" @click="action.handler">
        <span class="flex items-center whitespace-nowrap">
          <span class="material-symbols text-lg leading-none mr-1" aria-hidden="true">{{ action.icon }}</span>
          <span>{{ action.text }}</span>
        </span>
      </ui-btn>
    </div>
  </div>
</template>

<script>
import { Dialog } from '@capacitor/dialog'
import { AbsUpdater } from '@/plugins/capacitor'
import { updateView } from '@/utils/updaterView'

export default {
  data() {
    return {
      status: { state: 'IDLE' },
      permissionPrompt: false,
      busy: false,
      listener: null
    }
  },
  computed: {
    view() {
      return updateView(this.status, this.permissionPrompt)
    },
    installedText() {
      const s = this.status
      if (!s.installedVersion) return '—'
      return `Audiobookshelf+ v${s.installedVersion} (${s.installedVersionCode})`
    },
    lastCheckedText() {
      return this.status.lastCheckAt ? this.$formatDate(this.status.lastCheckAt, 'MMM d, yyyy HH:mm') : ''
    },
    candidateMeta() {
      const c = this.status.candidate
      const parts = []
      const published = c.publishedAt ? Date.parse(c.publishedAt) : NaN
      if (!isNaN(published)) parts.push(this.$formatDate(published, 'MMM d, yyyy'))
      if (c.size) parts.push(this.$bytesPretty(c.size))
      return parts.join(' · ')
    },
    statusText() {
      const text = this.$strings[this.view.statusKey] || ''
      return this.status.state === 'AVAILABLE' && this.status.candidate ? `${text} (v${this.status.candidate.version})` : text
    },
    buttons() {
      const all = {
        check: { icon: 'refresh', text: this.$strings.ButtonCheckForUpdates, handler: this.check, loading: this.status.state === 'CHECKING' },
        download: { icon: 'download', text: this.$strings.ButtonDownloadUpdate, handler: this.download },
        retry: { icon: 'replay', text: this.$strings.ButtonRetryDownload, handler: this.download },
        cancel: { icon: 'close', text: this.$strings.ButtonCancelDownload, handler: this.cancel },
        install: { icon: 'install_mobile', text: this.$strings.ButtonInstallUpdate, handler: this.install },
        permission: { icon: 'settings', text: this.$strings.ButtonOpenInstallSettings, handler: this.openPermissionSettings },
        reopen: { icon: 'open_in_new', text: this.$strings.ButtonOpenInstaller, handler: this.reopenInstaller },
        notes: { icon: 'description', text: this.$strings.ButtonReleaseNotes, handler: this.openNotes }
      }
      return this.view.actions.map((id) => ({ id, ...all[id] }))
    }
  },
  methods: {
    apply(s) {
      if (s && s.state) this.status = s
      if (this.status.state !== 'READY' || !this.status.installPermissionNeeded) this.permissionPrompt = false
    },
    async run(fn) {
      if (this.busy) return null
      this.busy = true
      try {
        return await fn()
      } catch (error) {
        console.error('[Updates] action failed', error)
        return null
      } finally {
        this.busy = false
      }
    },
    check() {
      return this.run(() => AbsUpdater.checkForUpdates())
    },
    download() {
      return this.run(() => AbsUpdater.downloadUpdate())
    },
    cancel() {
      return this.run(() => AbsUpdater.cancelDownload())
    },
    async install() {
      // Installing replaces the running app: say so first when audio is playing
      if (this.$store.state.playerIsPlaying && this.status.state === 'READY') {
        const { value } = await Dialog.confirm({ title: this.$strings.HeaderUpdates, message: this.$strings.MessageUpdateConfirmWhilePlaying })
        if (!value) return
      }
      const result = await this.run(() => AbsUpdater.installUpdate())
      if (result && result.result === 'needs_permission') {
        this.permissionPrompt = true
        this.status = { ...this.status, installPermissionNeeded: true }
      }
    },
    reopenInstaller() {
      return this.run(() => AbsUpdater.reopenInstaller())
    },
    openPermissionSettings() {
      return this.run(() => AbsUpdater.openInstallPermissionSettings())
    },
    openNotes() {
      return this.run(() => AbsUpdater.openReleaseNotes())
    }
  },
  async mounted() {
    this.listener = await AbsUpdater.addListener('onUpdateState', this.apply)
    try {
      this.apply(await AbsUpdater.getState())
    } catch (error) {
      console.error('[Updates] state unavailable', error)
    }
  },
  beforeDestroy() {
    this.listener?.remove()
  }
}
</script>
