package app.absplus.android.managers

import app.absplus.android.data.PodcastAutoDownloadEntry
import app.absplus.android.device.DeviceManager

/** Single entry point for auto download state; serializes read-modify-write cycles. */
object AutoDownloadStore {
  private fun key(serverConfigId: String, libraryItemId: String) = "$serverConfigId:$libraryItemId"

  // Paper/Kryo skips constructors, so fields missing in older saved records are null despite Kotlin types
  private fun normalize(entry: PodcastAutoDownloadEntry): PodcastAutoDownloadEntry {
    val enabled = (entry.enabled as String?) ?: PodcastAutoDownloadEntry.ENABLED_DEFAULT
    val ids = (entry.autoDownloadedEpisodeIds as MutableList<String>?) ?: mutableListOf()
    return PodcastAutoDownloadEntry(enabled, entry.keepCount, ids.toMutableList())
  }

  private fun defaultEntry() = PodcastAutoDownloadEntry(PodcastAutoDownloadEntry.ENABLED_DEFAULT, null, mutableListOf())

  @Synchronized
  fun get(serverConfigId: String, libraryItemId: String): PodcastAutoDownloadEntry {
    val entry = DeviceManager.dbManager.getPodcastAutoDownloadEntry(key(serverConfigId, libraryItemId))
    return if (entry == null) defaultEntry() else normalize(entry)
  }

  @Synchronized
  fun setSettings(serverConfigId: String, libraryItemId: String, enabled: String, keepCount: Int?) {
    val entry = get(serverConfigId, libraryItemId)
    entry.enabled = enabled
    entry.keepCount = keepCount
    DeviceManager.dbManager.savePodcastAutoDownloadEntry(key(serverConfigId, libraryItemId), entry)
  }

  @Synchronized
  fun addEpisodeId(serverConfigId: String, libraryItemId: String, episodeId: String) {
    val entry = get(serverConfigId, libraryItemId)
    if (entry.autoDownloadedEpisodeIds.contains(episodeId)) return
    entry.autoDownloadedEpisodeIds.add(episodeId)
    DeviceManager.dbManager.savePodcastAutoDownloadEntry(key(serverConfigId, libraryItemId), entry)
  }

  @Synchronized
  fun removeEpisodeId(serverConfigId: String, libraryItemId: String, episodeId: String) {
    val k = key(serverConfigId, libraryItemId)
    val stored = DeviceManager.dbManager.getPodcastAutoDownloadEntry(k) ?: return
    val entry = normalize(stored)
    if (!entry.autoDownloadedEpisodeIds.remove(episodeId)) return
    DeviceManager.dbManager.savePodcastAutoDownloadEntry(k, entry)
  }

  @Synchronized
  fun getEntriesForServer(serverConfigId: String): Map<String, PodcastAutoDownloadEntry> {
    val prefix = "$serverConfigId:"
    val result = mutableMapOf<String, PodcastAutoDownloadEntry>()
    DeviceManager.dbManager.getPodcastAutoDownloadKeys().filter { it.startsWith(prefix) }.forEach { k ->
      DeviceManager.dbManager.getPodcastAutoDownloadEntry(k)?.let {
        result[k.removePrefix(prefix)] = normalize(it)
      }
    }
    return result
  }
}
