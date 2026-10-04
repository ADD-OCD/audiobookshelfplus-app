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
        <svg class="w-7 h-7 text-fg shrink-0 mr-2" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img" viewBox="0 0 24 24">
          <path
            d="M12 2.247a10 10 0 0 0-3.162 19.487c.5.088.687-.212.687-.475c0-.237-.012-1.025-.012-1.862c-2.513.462-3.163-.613-3.363-1.175a3.636 3.636 0 0 0-1.025-1.413c-.35-.187-.85-.65-.013-.662a2.001 2.001 0 0 1 1.538 1.025a2.137 2.137 0 0 0 2.912.825a2.104 2.104 0 0 1 .638-1.338c-2.225-.25-4.55-1.112-4.55-4.937a3.892 3.892 0 0 1 1.025-2.688a3.594 3.594 0 0 1 .1-2.65s.837-.262 2.75 1.025a9.427 9.427 0 0 1 5 0c1.912-1.3 2.75-1.025 2.75-1.025a3.593 3.593 0 0 1 .1 2.65a3.869 3.869 0 0 1 1.025 2.688c0 3.837-2.338 4.687-4.563 4.937a2.368 2.368 0 0 1 .675 1.85c0 1.338-.012 2.413-.012 2.75c0 .263.187.575.687.475A10.005 10.005 0 0 0 12 2.247z"
            fill="currentColor"
          />
        </svg>
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
        { url: 'https://github.com/advplyr/audiobookshelf', label: this.$strings.LabelOfficialAudiobookshelf, caption: this.$strings.LabelOfficialAudiobookshelfCaption },
        { url: 'https://github.com/ADD-OCD/audiobookshelfplus-app', label: this.$strings.LabelAudiobookshelfPlus, caption: this.$strings.LabelAudiobookshelfPlusCaption }
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
