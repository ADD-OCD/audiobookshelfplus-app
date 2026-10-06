import { registerPlugin, WebPlugin } from '@capacitor/core'

class AbsDownloaderWeb extends WebPlugin {
  constructor() {
    super()
  }

  async getDownloadQueue() {
    return { items: [] }
  }

  async retryDownload() {
    return { errorCode: 'notFound' }
  }

  async removeDownload() {
    return { errorCode: 'notFound' }
  }
}

const AbsDownloader = registerPlugin('AbsDownloader', {
  web: () => new AbsDownloaderWeb()
})

export { AbsDownloader }
