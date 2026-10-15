<template>
  <!-- RICE preview (docs/rice-customization.md): a fixed sample of the app's surfaces, styled only by the scoped preview
       stylesheet (theme/rice/runtime.js applyPreview). Example text only: no library data, no playback. -->
  <div class="rice-preview bg-bg rounded-md overflow-hidden border border-border" role="img" :aria-label="$strings.LabelRicePreview">
    <div class="bg-primary flex items-center px-3 h-10">
      <span class="material-symbols text-xl text-fg" aria-hidden="true">menu</span>
      <p class="pl-3 text-fg font-semibold truncate">{{ $strings.LabelRicePreviewLibrary }}</p>
      <span class="material-symbols text-xl text-fg-muted ml-auto" aria-hidden="true">search</span>
    </div>
    <div class="bg-secondary flex px-3 py-1 text-sm">
      <p class="text-fg pr-4 border-b-2 border-accent">{{ $strings.LabelRicePreviewHome }}</p>
      <p class="text-fg-muted">{{ $strings.LabelRicePreviewSeries }}</p>
    </div>
    <div class="flex p-3">
      <div class="relative w-16 h-24 rounded-sm bg-secondary card-artwork overflow-hidden flex-shrink-0">
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="material-symbols text-3xl text-fg-muted" aria-hidden="true">menu_book</span>
        </div>
        <div class="card-frame absolute inset-0 rounded-sm pointer-events-none" aria-hidden="true" />
        <div class="absolute bottom-0 left-0 h-1 bg-track-cursor" style="width: 40%" />
      </div>
      <div class="pl-3 min-w-0 flex-grow">
        <p class="text-fg truncate">{{ $strings.LabelRicePreviewTitle }}</p>
        <p class="text-fg-muted text-sm truncate">{{ $strings.LabelRicePreviewAuthor }}</p>
        <div class="relative h-1.5 mt-3 rounded-full bg-track overflow-hidden">
          <div class="absolute inset-y-0 left-0 bg-track-buffered" style="width: 65%" />
          <div class="absolute inset-y-0 left-0 bg-track-cursor" style="width: 40%" />
        </div>
        <p class="font-mono text-xs text-fg-muted mt-1">1:12:40 / 3:05:00</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center px-3 pb-3">
      <div class="btn rounded-md border border-border bg-primary text-fg text-sm px-3 py-1 mr-2 mb-2">{{ $strings.LabelRicePreviewButton }}</div>
      <div class="btn rounded-md border border-border bg-success-action text-white text-sm px-3 py-1 mr-2 mb-2">{{ $strings.ButtonSave }}</div>
      <div class="btn rounded-md border border-border bg-error text-white text-sm px-3 py-1 mb-2">{{ $strings.ButtonDelete }}</div>
    </div>
    <div class="flex flex-wrap px-3 pb-3 text-sm">
      <p class="text-success flex items-center mr-3"><span class="material-symbols text-base mr-1" aria-hidden="true">check_circle</span>{{ $strings.LabelRicePreviewFinished }}</p>
      <p class="text-warning flex items-center mr-3"><span class="material-symbols text-base mr-1" aria-hidden="true">warning</span>{{ $strings.LabelRicePreviewWarning }}</p>
      <p class="text-info flex items-center"><span class="material-symbols text-base mr-1" aria-hidden="true">info</span>{{ $strings.LabelRicePreviewInfo }}</p>
    </div>
    <div class="bg-bg-hover px-3 py-2 text-fg text-sm">{{ $strings.LabelRicePreviewSelectedRow }}</div>
    <!-- Mini player chrome -->
    <div class="bg-secondary flex items-center px-3 h-14">
      <div class="w-10 h-10 rounded-sm bg-primary flex items-center justify-center">
        <span class="material-symbols text-xl text-fg-muted" aria-hidden="true">headphones</span>
      </div>
      <div class="pl-3 min-w-0 flex-grow">
        <p class="text-fg text-sm truncate">{{ $strings.LabelRicePreviewTitle }}</p>
        <p class="text-fg-muted text-xs truncate">{{ $strings.LabelRicePreviewAuthor }}</p>
      </div>
      <span class="material-symbols fill text-3xl" :class="isLight ? 'text-black' : 'text-white'" aria-hidden="true">play_arrow</span>
    </div>
    <!-- Home-screen widget colors -->
    <div v-if="snapshot" class="flex items-center px-3 py-2 bg-primary">
      <p class="text-fg-muted text-xs pr-2">{{ $strings.LabelRicePreviewWidget }}</p>
      <span v-for="swatch in widgetSwatches" :key="swatch.role" class="w-5 h-5 rounded-sm mr-1 border border-border" :style="{ backgroundColor: swatch.css }" :aria-label="swatch.label" role="img" />
    </div>
  </div>
</template>

<script>
import { widgetColors } from '@/theme/rice/mapping'
import { toHex } from '@/theme/rice/color'
import { validateSnapshot } from '@/theme/rice/schema'
import { applyPreview } from '@/theme/rice/runtime'

// The preview styles itself from its snapshot: one scoped stylesheet update per animation frame, removed on destroy
export default {
  props: {
    snapshot: Object
  },
  data() {
    return { frame: null }
  },
  watch: {
    snapshot: {
      deep: true,
      handler() {
        this.schedule()
      }
    }
  },
  mounted() {
    this.schedule()
  },
  beforeDestroy() {
    if (this.frame) cancelAnimationFrame(this.frame)
    applyPreview(document, null)
  },
  methods: {
    schedule() {
      if (this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = null
        if (this.snapshot && validateSnapshot(this.snapshot).ok) applyPreview(document, this.snapshot, '.rice-preview')
      })
    }
  },
  computed: {
    isLight() {
      return this.snapshot ? this.snapshot.colorScheme === 'light' : false
    },
    widgetSwatches() {
      if (!this.snapshot) return []
      const colors = widgetColors(this.snapshot)
      return ['background', 'surface', 'text', 'played'].map((role) => ({ role, css: `rgb(${colors[role].join(',')})`, label: `${role} ${toHex(colors[role])}` }))
    }
  }
}
</script>
