package app.absplus.android.managers

import app.absplus.android.data.PodcastAutoDownloadEntry
import app.absplus.android.device.DeviceManager
import app.absplus.android.plugins.AbsLogger

/** Single entry point for auto download state; serializes read-modify-write cycles. */
object AutoDownloadStore {
  private fun key(serverConfigId: String, libraryItemId: String) = "$serverConfigId:$libraryItemId"

  // In-memory copy of the owned (auto) episode keys, read by the download queue on every pass
  private var ownedCache: MutableSet<String>? = null

  private fun ownedKey(serverConfigId: String, libraryItemId: String, episodeId: String) =
          "$serverConfigId:$libraryItemId:$episodeId"

  // Paper/Kryo skips constructors, so fields missing in older saved records are null despite Kotlin types
  @Suppress("UNCHECKED_CAST", "USELESS_CAST")
  private fun normalize(entry: PodcastAutoDownloadEntry): PodcastAutoDownloadEntry {
    val enabled = (entry.enabled as String?) ?: PodcastAutoDownloadEntry.ENABLED_DEFAULT
    val ids = (entry.autoDownloadedEpisodeIds as MutableList<String>?) ?: mutableListOf()
    val manual = (entry.manualEpisodeIds as MutableList<String>?) ?: mutableListOf()
    val failed = (entry.failedAttempts as MutableMap<String, Int>?) ?: mutableMapOf()
    // A manual claim always wins; never keep an episode in both lists
    val owned = ids.filter { it !in manual }.toMutableList()
    return PodcastAutoDownloadEntry(enabled, entry.keepCount, owned, manual.toMutableList(), failed.toMutableMap())
  }

  // An unreadable record must not block every check; it reads as OFF so a lost opt-out is never overridden
  private fun read(key: String): PodcastAutoDownloadEntry? {
    return try {
      DeviceManager.dbManager.getPodcastAutoDownloadEntry(key)
    } catch (e: Exception) {
      AbsLogger.error("AutoDownloadStore", "Could not read auto download entry $key (${e.javaClass.simpleName}: ${e.message})")
      PodcastAutoDownloadEntry(PodcastAutoDownloadEntry.ENABLED_OFF, null, mutableListOf())
    }
  }

  private fun write(serverConfigId: String, libraryItemId: String, entry: PodcastAutoDownloadEntry) {
    DeviceManager.dbManager.savePodcastAutoDownloadEntry(key(serverConfigId, libraryItemId), entry)
    ownedCache?.let { cache ->
      cache.removeAll { it.startsWith(key(serverConfigId, libraryItemId) + ":") }
      entry.autoDownloadedEpisodeIds.forEach { cache.add(ownedKey(serverConfigId, libraryItemId, it)) }
    }
  }

  private fun defaultEntry() = PodcastAutoDownloadEntry(PodcastAutoDownloadEntry.ENABLED_DEFAULT, null, mutableListOf())

  @Synchronized
  fun get(serverConfigId: String, libraryItemId: String): PodcastAutoDownloadEntry {
    val entry = read(key(serverConfigId, libraryItemId))
    return if (entry == null) defaultEntry() else normalize(entry)
  }

  @Synchronized
  fun setSettings(serverConfigId: String, libraryItemId: String, enabled: String, keepCount: Int?) {
    val entry = get(serverConfigId, libraryItemId)
    entry.enabled = enabled
    entry.keepCount = keepCount
    write(serverConfigId, libraryItemId, entry)
  }

  /**
   * Records that auto download queued this episode. Refused (false) when the user claimed it manually, so a manual
   * download can never become auto-managed by a later or concurrent check.
   */
  @Synchronized
  fun markAutoQueued(serverConfigId: String, libraryItemId: String, episodeId: String): Boolean {
    val entry = get(serverConfigId, libraryItemId)
    if (episodeId in entry.manualEpisodeIds) return false
    if (episodeId in entry.autoDownloadedEpisodeIds) return true
    entry.autoDownloadedEpisodeIds.add(episodeId)
    write(serverConfigId, libraryItemId, entry)
    return true
  }

  /** The user requested this episode: it is the user's download from now on and auto retention never removes it. */
  @Synchronized
  fun claimManual(serverConfigId: String, libraryItemId: String, episodeId: String) {
    val entry = get(serverConfigId, libraryItemId)
    val changed = entry.autoDownloadedEpisodeIds.remove(episodeId) or
            (entry.failedAttempts.remove(episodeId) != null) or
            (episodeId !in entry.manualEpisodeIds && entry.manualEpisodeIds.add(episodeId))
    if (changed) write(serverConfigId, libraryItemId, entry)
  }

  @Synchronized
  fun isAutoOwned(serverConfigId: String, libraryItemId: String, episodeId: String?): Boolean {
    if (episodeId.isNullOrBlank() || serverConfigId.isBlank()) return false
    val cache = ownedCache ?: loadOwnedCache().also { ownedCache = it }
    return ownedKey(serverConfigId, libraryItemId, episodeId) in cache
  }

  private fun loadOwnedCache(): MutableSet<String> {
    val cache = mutableSetOf<String>()
    DeviceManager.dbManager.getPodcastAutoDownloadKeys().forEach { k ->
      val sep = k.lastIndexOf(':')
      if (sep <= 0) return@forEach
      read(k)?.let { entry -> normalize(entry).autoDownloadedEpisodeIds.forEach { cache.add("$k:$it") } }
    }
    return cache
  }

  /** A failed automatic attempt of an auto-owned episode (manual downloads are not counted). */
  @Synchronized
  fun recordAutoFailure(serverConfigId: String, libraryItemId: String, episodeId: String) {
    val entry = get(serverConfigId, libraryItemId)
    if (episodeId !in entry.autoDownloadedEpisodeIds) return
    entry.failedAttempts[episodeId] = (entry.failedAttempts[episodeId] ?: 0) + 1
    write(serverConfigId, libraryItemId, entry)
  }

  @Synchronized
  fun recordAutoSuccess(serverConfigId: String, libraryItemId: String, episodeId: String) {
    val entry = get(serverConfigId, libraryItemId)
    if (entry.failedAttempts.remove(episodeId) != null) write(serverConfigId, libraryItemId, entry)
  }

  /** Drops ownership records of episodes the server no longer lists (keeps the entry bounded by the feed). */
  @Synchronized
  fun forgetEpisodes(serverConfigId: String, libraryItemId: String, episodeIds: Collection<String>) {
    if (episodeIds.isEmpty()) return
    val entry = get(serverConfigId, libraryItemId)
    val changed = entry.autoDownloadedEpisodeIds.removeAll(episodeIds.toSet()) or
            episodeIds.map { entry.failedAttempts.remove(it) != null }.any { it }
    if (changed) write(serverConfigId, libraryItemId, entry)
  }

  @Synchronized
  fun getEntriesForServer(serverConfigId: String): Map<String, PodcastAutoDownloadEntry> {
    val prefix = "$serverConfigId:"
    val result = mutableMapOf<String, PodcastAutoDownloadEntry>()
    DeviceManager.dbManager.getPodcastAutoDownloadKeys().filter { it.startsWith(prefix) }.forEach { k ->
      read(k)?.let {
        result[k.removePrefix(prefix)] = normalize(it)
      }
    }
    return result
  }

  /** Tests replace the Paper books between cases. */
  @Synchronized
  fun clearCacheForTests() {
    ownedCache = null
  }
}
