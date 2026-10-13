<template>
  <div class="w-full bg-bg relative" :class="labeled ? 'labeled-nav' : 'h-9'">
    <div id="bookshelf-navbar" class="z-10 w-full flex bg-secondary" :class="labeled ? 'relative' : 'absolute top-0 left-0 h-full'">
      <nuxt-link v-for="item in items" :key="item.to" :to="item.to" class="h-full flex-grow flex items-center justify-center" :class="routeName === item.routeName ? 'bg-primary' : 'text-fg-muted'">
        <!-- Podcast libraries: every tab shows its icon and its label, selected or not -->
        <template v-if="labeled">
          <span v-if="item.iconPack === 'abs-icons'" aria-hidden="true" class="nav-icon abs-icons" :class="`icon-${item.icon} ${item.iconClass || ''}`"></span>
          <span v-else aria-hidden="true" class="nav-icon" :class="`${item.iconPack} ${item.iconClass || ''}`">{{ item.icon }}</span>
          <p class="nav-label" :class="{ 'font-semibold': routeName === item.routeName }">{{ item.text }}</p>
        </template>
        <template v-else>
          <p v-if="routeName === item.routeName" class="text-sm font-semibold">{{ item.text }}</p>
          <span v-else-if="item.iconPack === 'abs-icons'" class="abs-icons" :class="`icon-${item.icon} ${item.iconClass || ''}`"></span>
          <span v-else :class="`${item.iconPack} ${item.iconClass || ''}`">{{ item.icon }}</span>
        </template>
      </nuxt-link>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {}
  },
  computed: {
    currentLibrary() {
      return this.$store.getters['libraries/getCurrentLibrary']
    },
    currentLibraryIcon() {
      return this.currentLibrary?.icon || 'database'
    },
    userHasPlaylists() {
      return this.$store.state.libraries.numUserPlaylists
    },
    userIsAdminOrUp() {
      return this.$store.getters['user/getIsAdminOrUp']
    },
    items() {
      let items = []
      if (this.isPodcast) {
        // Each icon names its destination (recent episodes, the podcast collection, adding a podcast) rather than the
        // library's own icon (a microphone) and the broadcast symbol, which read as recording and live audio
        items = [
          {
            to: '/bookshelf',
            routeName: 'bookshelf',
            iconPack: 'abs-icons',
            icon: 'home',
            iconClass: 'text-xl',
            text: this.$strings.ButtonHome
          },
          {
            to: '/bookshelf/latest',
            routeName: 'bookshelf-latest',
            iconPack: 'material-symbols',
            icon: 'schedule',
            iconClass: 'text-xl',
            text: this.$strings.ButtonLatest
          },
          {
            to: '/bookshelf/library',
            routeName: 'bookshelf-library',
            iconPack: 'material-symbols',
            icon: 'library_books',
            iconClass: 'text-xl',
            text: this.$strings.ButtonLibrary
          }
        ]

        if (this.userIsAdminOrUp) {
          items.push({
            to: '/bookshelf/add-podcast',
            routeName: 'bookshelf-add-podcast',
            iconPack: 'material-symbols',
            icon: 'add',
            iconClass: 'text-xl',
            text: this.$strings.ButtonAdd
          })
        }
      } else {
        items = [
          {
            to: '/bookshelf',
            routeName: 'bookshelf',
            iconPack: 'abs-icons',
            icon: 'home',
            iconClass: 'text-xl',
            text: this.$strings.ButtonHome
          },
          {
            to: '/bookshelf/library',
            routeName: 'bookshelf-library',
            iconPack: 'abs-icons',
            icon: this.currentLibraryIcon,
            iconClass: 'text-lg',
            text: this.$strings.ButtonLibrary
          },
          {
            to: '/bookshelf/series',
            routeName: 'bookshelf-series',
            iconPack: 'abs-icons',
            icon: 'columns',
            iconClass: 'text-lg pt-px',
            text: this.$strings.ButtonSeries
          },
          {
            to: '/bookshelf/collections',
            routeName: 'bookshelf-collections',
            iconPack: 'material-symbols',
            icon: 'collections_bookmark',
            iconClass: 'text-xl',
            text: this.$strings.ButtonCollections
          },
          {
            to: '/bookshelf/authors',
            routeName: 'bookshelf-authors',
            iconPack: 'abs-icons',
            icon: 'authors',
            iconClass: 'text-2xl',
            text: this.$strings.ButtonAuthors
          }
        ]
      }

      if (this.userHasPlaylists) {
        items.push({
          to: '/bookshelf/playlists',
          routeName: 'bookshelf-playlists',
          iconPack: 'material-symbols',
          icon: 'queue_music',
          iconClass: 'text-2xl',
          text: this.$strings.ButtonPlaylists
        })
      }

      return items
    },
    // Podcast libraries label every tab (four or five tabs fit); book libraries keep the selected-label strip
    labeled() {
      return this.isPodcast
    },
    routeName() {
      return this.$route.name
    },
    isPodcast() {
      return this.libraryMediaType == 'podcast'
    },
    libraryMediaType() {
      return this.$store.getters['libraries/getCurrentLibraryMediaType']
    }
  },
  methods: {
    isSelected(item) {}
  },
  mounted() {}
}
</script>

<style>
#bookshelf-navbar {
  box-shadow: 0px 5px 5px #11111155;
}
#bookshelf-navbar a {
  font-size: 0.9rem;
}
/* Labeled tabs: the icon above its label in portrait (44px, growing with the font scale), side by side in landscape, where
   width is plentiful and height is scarce (36px) */
.labeled-nav #bookshelf-navbar a {
  flex: 1 1 0;
  min-width: 0;
  min-height: 44px;
  flex-direction: column;
  gap: 1px;
  padding: 4px 2px;
}
.labeled-nav .nav-icon {
  line-height: 1;
}
.labeled-nav .nav-label {
  max-width: 100%;
  font-size: 0.75rem;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (orientation: landscape) {
  .labeled-nav #bookshelf-navbar a {
    min-height: 36px;
    flex-direction: row;
    gap: 6px;
    padding: 2px 6px;
  }
  .labeled-nav .nav-label {
    font-size: 0.85rem;
  }
}
</style>
