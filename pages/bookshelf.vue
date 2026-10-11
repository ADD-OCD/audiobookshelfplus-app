<template>
  <div class="w-full h-full flex flex-col">
    <home-bookshelf-nav-bar />
    <home-bookshelf-toolbar v-show="!hideToolbar" />
    <div id="bookshelf-wrapper" class="main-content overflow-y-auto overflow-x-hidden relative" :class="hideToolbar ? 'no-toolbar' : ''">
      <nuxt-child />
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {}
  },
  computed: {
    hideToolbar() {
      return this.isHome || this.isLatest || this.isPodcastSearch
    },
    isHome() {
      return this.$route.name === 'bookshelf'
    },
    isLatest() {
      return this.$route.name === 'bookshelf-latest'
    },
    isPodcastSearch() {
      return this.$route.name === 'bookshelf-add-podcast'
    }
  }
}
</script>

<style>
/* The shelf takes the height left under the navigation and the toolbar (previously 100% - 72px, or 100% - 36px without the
   toolbar), so a toolbar that grows for a wrapped title at a large font scale never pushes the shelf out of view */
.main-content {
  flex: 1 1 0;
  min-height: 0;
  max-width: 100vw;
}
</style>
