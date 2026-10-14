package app.absplus.android.managers

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import app.absplus.android.data.DeviceSettings
import app.absplus.android.data.MediaProgress
import app.absplus.android.data.Podcast
import app.absplus.android.data.PodcastAutoDownloadEntry
import app.absplus.android.device.DeviceManager
import app.absplus.android.models.DownloadItem
import app.absplus.android.plugins.AbsLogger
import java.io.File

/** Current network/power state for the auto download gate. */
object AutoDownloadConditions {
  fun current(context: Context): AutoDownloadPolicy.Conditions {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?
    val caps = cm?.activeNetwork?.let { cm.getNetworkCapabilities(it) }
    val connected = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    val unmetered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
    val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager?
    return AutoDownloadPolicy.Conditions(connected, unmetered, bm?.isCharging == true)
  }

  fun transfersAllowed(context: Context): Boolean =
          AutoDownloadPolicy.transfersAllowed(DeviceManager.deviceData.deviceSettings ?: DeviceSettings.default(), current(context))
}

/**
 * Decides, per queued item, whether the download queue may transfer it now. Auto-owned items follow the auto download
 * network/charging settings in the shared queue too (worker, app start, restore and retry all go through the queue);
 * manual downloads are never gated here.
 */
interface AutoTransferGate {
  fun isAuto(item: DownloadItem): Boolean
  fun allowedNow(): Boolean

  companion object {
    fun forContext(context: Context): AutoTransferGate = object : AutoTransferGate {
      override fun isAuto(item: DownloadItem): Boolean =
              try {
                AutoDownloadStore.isAutoOwned(item.serverConnectionConfigId, item.libraryItemId, item.episodeId)
              } catch (e: Exception) {
                false
              }
      override fun allowedNow(): Boolean = AutoDownloadConditions.transfersAllowed(context)
    }
  }
}

/** Applies [AutoDownloadPolicy.retentionDeletions] to the internal local copy of one podcast of one server. */
object AutoDownloadRetention {
  private const val TAG = "AutoDownloadRetention"

  /**
   * @param serverProgress server progress keyed by episode id (the check's current user)
   * @param queuedEpisodeIds episodes of this podcast that are in the download queue
   * @return episode ids that were deleted
   */
  fun apply(
          context: Context,
          serverConfigId: String,
          libraryItemId: String,
          entry: PodcastAutoDownloadEntry,
          windowIds: Set<String>,
          serverEpisodeIds: Set<String>,
          serverProgress: Map<String, MediaProgress>,
          queuedEpisodeIds: Set<String>
  ): List<String> {
    val downloadsRoot = File(context.filesDir, "downloads").canonicalFile
    val last = DeviceManager.deviceData.lastPlaybackSession
    val deleted = mutableListOf<String>()
    DeviceManager.dbManager.getLocalLibraryItems()
            .filter {
              it.libraryItemId == libraryItemId && it.serverConnectionConfigId == serverConfigId &&
                      it.folderId.startsWith("internal-")
            }
            .forEach { local ->
              val podcast = local.media as? Podcast ?: return@forEach
              val episodes = podcast.episodes ?: return@forEach
              val view = episodes.mapNotNull { ep ->
                val serverEpisodeId = ep.serverEpisodeId ?: return@mapNotNull null
                val localProgress = DeviceManager.dbManager.getLocalMediaProgress("${local.id}-${ep.id}")
                val remote = serverProgress[serverEpisodeId]
                val inProgress = (localProgress != null && localProgress.currentTime > 0 && !localProgress.isFinished) ||
                        (remote != null && remote.currentTime > 0 && !remote.isFinished)
                val lastPlayed = last != null &&
                        ((last.localLibraryItem?.id == local.id && last.localEpisodeId == ep.id) ||
                                (last.libraryItemId == libraryItemId && last.episodeId == serverEpisodeId))
                AutoDownloadPolicy.LocalEpisode(serverEpisodeId, inProgress, lastPlayed, serverEpisodeId in queuedEpisodeIds)
              }
              val remove = AutoDownloadPolicy.retentionDeletions(entry, windowIds, serverEpisodeIds, view).toSet()
              if (remove.isEmpty()) return@forEach
              var changed = false
              episodes.filter { it.serverEpisodeId in remove }.forEach { ep ->
                val localFileId = ep.audioTrack?.localFileId ?: return@forEach
                val localFile = local.localFiles.find { it.id == localFileId }
                val file = localFile?.absolutePath?.let { File(it).canonicalFile }
                // Only files inside the app's own downloads folder; anything else stays untouched
                if (file == null || !file.path.startsWith(downloadsRoot.path + File.separator)) {
                  AbsLogger.error(TAG, "Not removing ${ep.serverEpisodeId}: file is outside app storage")
                  return@forEach
                }
                if (file.exists() && !file.delete()) {
                  AbsLogger.error(TAG, "Could not delete the file of ${ep.serverEpisodeId}")
                  return@forEach
                }
                podcast.removeAudioTrack(localFileId)
                local.removeLocalFile(localFileId)
                deleted.add(ep.serverEpisodeId!!)
                changed = true
              }
              if (changed) DeviceManager.dbManager.saveLocalLibraryItem(local)
            }
    if (deleted.isNotEmpty()) AbsLogger.info(TAG, "Removed ${deleted.size} auto downloaded episode(s) of $libraryItemId outside the latest window")
    return deleted
  }
}
