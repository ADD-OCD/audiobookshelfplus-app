<template>
  <div class="w-full h-full overflow-y-auto flex flex-col">
    <div class="relative flex grow shrink-0 items-center justify-center py-12 sm:pt-0">
      <nuxt-link to="/" class="absolute top-2 left-2 z-20">
        <span class="material-symbols text-4xl">arrow_back</span>
      </nuxt-link>
      <div class="absolute top-0 left-0 w-full p-6 flex items-center flex-col justify-center z-0 short:hidden">
        <img src="/Logo.png" class="h-20 w-20 mb-2" />
        <h1 class="text-2xl">{{ $strings.LabelAudiobookshelfPlus }}</h1>
      </div>
      <p class="hidden absolute short:block top-1.5 left-12 p-2 text-xl">{{ $strings.LabelAudiobookshelfPlus }}</p>

      <connection-server-connect-form v-if="deviceData" />
    </div>

    <div class="shrink-0 flex flex-wrap items-start justify-center gap-x-8 gap-y-3 px-4 pt-4 pb-4">
      <a v-for="link in projectLinks" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer" class="flex items-center">
        <!-- The destination owner's GitHub avatar, bundled (never fetched at runtime) -->
        <img :src="link.avatar" alt="" aria-hidden="true" class="w-7 h-7 rounded-full shrink-0 mr-2" />
        <span class="flex flex-col leading-tight">
          <span class="text-sm">{{ link.label }}</span>
          <span class="text-xs text-fg-muted">{{ link.caption }}</span>
        </span>
      </a>
    </div>
  </div>
</template>

<script>
export default {
  layout: 'blank',
  data() {
    return {
      deviceData: null
    }
  },
  computed: {
    projectLinks() {
      return [
        { url: 'https://github.com/advplyr/audiobookshelf', label: this.$strings.LabelOfficialAudiobookshelf, caption: this.$strings.LabelOfficialAudiobookshelfCaption, avatar: '/avatars/github-advplyr.png' },
        { url: 'https://github.com/ADD-OCD/audiobookshelfplus-app', label: this.$strings.LabelAudiobookshelfPlus, caption: this.$strings.LabelAudiobookshelfPlusCaption, avatar: '/avatars/github-ADD-OCD.jpg' }
      ]
    }
  },
  methods: {
    async init() {
      await this.$store.dispatch('setupNetworkListener')
      this.deviceData = await this.$db.getDeviceData()
      this.$store.commit('setDeviceData', this.deviceData)
    }
  },
  mounted() {
    // Reset data on logouts
    this.$store.commit('libraries/reset')
    this.$store.commit('setIsFirstLoad', true)
    this.init()
  }
}
</script>
