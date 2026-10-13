package app.absplus.android.managers

import app.absplus.android.data.DeviceSettings
import app.absplus.android.data.DownloadUsingCellularSetting
import app.absplus.android.data.PodcastAutoDownloadEntry
import app.absplus.android.services.DownloadServiceHost

/** Pure decisions of podcast auto download, kept apart from Android and network code for tests. */
object AutoDownloadPolicy {
  enum class EpisodeOutcome { QUEUED, SKIPPED, FAILED }

  // A missing SD card is not a failure: the episode is retried on a later check once the card is back
  fun outcomeFor(error: String?): EpisodeOutcome =
          when (error) {
            null, DownloadServiceHost.SERVICE_START_FAILED_MESSAGE -> EpisodeOutcome.QUEUED
            LibraryItemDownloadStarter.STORAGE_UNAVAILABLE_MESSAGE -> EpisodeOutcome.SKIPPED
            else -> EpisodeOutcome.FAILED
          }

  // Auto download has no UI to ask in, so anything but "Always" for cellular means unmetered only
  fun requiresUnmeteredNetwork(settings: DeviceSettings): Boolean =
          settings.autoDownloadWifiOnly || settings.downloadUsingCellular != DownloadUsingCellularSetting.ALWAYS

  fun isEnabledFor(entry: PodcastAutoDownloadEntry, settings: DeviceSettings): Boolean =
          entry.enabled == PodcastAutoDownloadEntry.ENABLED_ON ||
                  (entry.enabled == PodcastAutoDownloadEntry.ENABLED_DEFAULT && settings.autoDownloadAllPodcasts)

  fun keepCountFor(entry: PodcastAutoDownloadEntry, settings: DeviceSettings): Int =
          entry.keepCount ?: settings.autoDownloadKeepCount

  /** The [keepCount] newest candidates; items without a publish date count as the oldest. */
  fun <T> newestWindow(items: List<T>, keepCount: Int, publishedAt: (T) -> Long?, isCandidate: (T) -> Boolean): List<T> {
    if (keepCount <= 0) return emptyList()
    return items.filter(isCandidate).sortedWith(compareByDescending(nullsFirst<Long>(), publishedAt)).take(keepCount)
  }
}
