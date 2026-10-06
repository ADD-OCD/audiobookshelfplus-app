<template>
  <div v-if="downloadItemPartsRemaining.length || downloadItemPartsFailed.length" @click="clickedIt">
    <span v-if="!downloadItemPartsRemaining.length" class="material-symbols text-error text-3xl">error</span>
    <widgets-circle-progress v-else :value="progress" :count="downloadItemPartsRemaining.length" />
  </div>
</template>

<script>
import { AbsDownloader } from '@/plugins/capacitor'
import { downloadProgress } from '@/utils/downloadState'

export default {
  data() {
    return {
      downloadItemListener: null,
      completeListener: null,
      itemPartUpdateListener: null,
      queueChangedListener: null
    }
  },
  computed: {
    downloadItems() {
      return this.$store.state.globals.itemDownloads
    },
    downloadItemParts() {
      let parts = []
      this.downloadItems.forEach((di) => parts.push(...di.downloadItemParts))
      return parts
    },
    downloadItemPartsRemaining() {
      // Exclude failed parts so a permanently failed download doesn't leave the header badge stuck spinning
      return this.downloadItemParts.filter((dip) => !dip.completed && !dip.failed)
    },
    downloadItemPartsFailed() {
      return this.downloadItemParts.filter((dip) => dip.failed)
    },
    progress() {
      let totalBytes = 0
      let totalBytesDownloaded = 0
      this.downloadItemParts.forEach((dip) => {
        totalBytes += dip.fileSize
        totalBytesDownloaded += dip.bytesDownloaded
      })

      if (!totalBytes) return 0
      return Math.min(1, totalBytesDownloaded / totalBytes)
    },
    isIos() {
      return this.$platform === 'ios'
    }
  },
  methods: {
    clickedIt() {
      this.$router.push('/downloading')
    },
    onItemDownloadComplete(data) {
      console.log('DownloadProgressIndicator onItemDownloadComplete', JSON.stringify(data))
      if (!data || !data.libraryItemId) {
        console.error('Invalid item download complete payload')
        return
      }

      if (!data.localLibraryItem) {
        this.$toast.error(this.$strings.MessageItemDownloadCompleteFailedToCreate)
      } else {
        this.$eventBus.$emit('new-local-library-item', data.localLibraryItem)
      }

      if (data.localMediaProgress) {
        console.log('onItemDownloadComplete updating local media progress', data.localMediaProgress.id)
        this.$store.commit('globals/updateLocalMediaProgress', data.localMediaProgress)
      }

      this.$store.commit('globals/removeItemDownload', data.libraryItemId)
    },
    onDownloadItem(downloadItem) {
      console.log('DownloadProgressIndicator onDownloadItem', JSON.stringify(downloadItem))

      downloadItem.itemProgress = 0
      downloadItem.episodes = downloadItem.downloadItemParts.filter((dip) => dip.episode).map((dip) => dip.episode)

      this.$store.commit('globals/addUpdateItemDownload', downloadItem)
    },
    onDownloadItemPartUpdate(itemPart) {
      this.$store.commit('globals/updateDownloadItemPart', itemPart)
    },
    onQueueChanged(data) {
      if (!data.hasWork) this.$store.commit('globals/clearItemDownloads')
      // The native queue is authoritative: it also drops cancelled and cleared items
      this.refreshQueue()
    },
    async refreshQueue() {
      const result = await AbsDownloader.getDownloadQueue().catch(() => null)
      if (!result || !Array.isArray(result.items)) return
      this.$store.commit(
        'globals/setItemDownloads',
        result.items.map((downloadItem) => ({ ...downloadItem, itemProgress: downloadProgress(downloadItem), episodes: downloadItem.downloadItemParts.filter((dip) => dip.episode).map((dip) => dip.episode) }))
      )
    }
  },
  async mounted() {
    this.downloadItemListener = await AbsDownloader.addListener('onDownloadItem', (data) => this.onDownloadItem(data))
    this.itemPartUpdateListener = await AbsDownloader.addListener('onDownloadItemPartUpdate', (data) => this.onDownloadItemPartUpdate(data))
    this.queueChangedListener = await AbsDownloader.addListener('onQueueChanged', (data) => this.onQueueChanged(data))
    this.completeListener = await AbsDownloader.addListener('onItemDownloadComplete', (data) => this.onItemDownloadComplete(data))
    this.refreshQueue()
  },
  beforeDestroy() {
    this.downloadItemListener?.remove()
    this.completeListener?.remove()
    this.itemPartUpdateListener?.remove()
    this.queueChangedListener?.remove()
  }
}
</script>
