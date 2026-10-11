package app.absplus.android.managers

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.util.Log
import app.absplus.android.data.DeviceSettings
import app.absplus.android.data.MediaProgress
import app.absplus.android.data.Podcast
import app.absplus.android.data.PodcastAutoDownloadEntry
import app.absplus.android.device.DeviceManager
import app.absplus.android.models.User
import app.absplus.android.plugins.AbsLogger
import app.absplus.android.server.ApiHandler
import app.absplus.android.services.DownloadServiceHost
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withTimeoutOrNull

/** Keeps the newest unfinished episodes of opted-in podcasts downloaded. */
object AutoDownloadManager {
  enum class Status(val jsValue: String) {
    STARTED("started"),
    DISABLED("disabled"),
    CONSTRAINTS("constraints"),
    BUSY("busy"),
    NO_SERVER("no-server")
  }

  enum class Trigger { APP, WORKER }

  private const val TAG = "AutoDownloadManager"
  private const val PAGE_LIMIT = 100
  private const val MAX_PAGES = 1000
  private const val DEFAULT_TIMEOUT_MS = 120_000L

  private val mutex = Mutex()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private class StartResult(val error: String?)

  /** Worker entry point: runs preflight and, if STARTED, the whole check before returning. */
  suspend fun check(context: Context, trigger: Trigger): Status {
    val appContext = context.applicationContext
    val (status, settings) = preflight(appContext, trigger)
    if (status != Status.STARTED || settings == null) return status
    try {
      runCheck(appContext, trigger, settings)
    } finally {
      mutex.unlock()
    }
    return Status.STARTED
  }

  /** Plugin entry point: runs preflight; on STARTED the check continues in the background. Blocking (Paper I/O) — call off the main thread. */
  fun startCheck(context: Context, trigger: Trigger): Status {
    val appContext = context.applicationContext
    val (status, settings) = preflight(appContext, trigger)
    if (status != Status.STARTED || settings == null) return status
    scope.launch {
      try {
        runCheck(appContext, trigger, settings)
      } finally {
        mutex.unlock()
      }
    }
    return Status.STARTED
  }

  // On STARTED the mutex is held and the caller must unlock it
  private fun preflight(appContext: Context, trigger: Trigger): Pair<Status, DeviceSettings?> {
    DbManager.initialize(appContext)

    if (DeviceManager.serverConnectionConfig == null && trigger == Trigger.WORKER) {
      DeviceManager.serverConnectionConfig = DeviceManager.deviceData.getLastServerConnectionConfig()
    }
    if (DeviceManager.serverConnectionConfig == null) return Pair(Status.NO_SERVER, null)

    val settings = DeviceManager.deviceData.deviceSettings ?: DeviceSettings.default()
    if (!settings.autoDownloadEnabled) return Pair(Status.DISABLED, null)

    if (trigger == Trigger.APP && !constraintsMet(appContext, settings)) return Pair(Status.CONSTRAINTS, null)

    if (!mutex.tryLock()) return Pair(Status.BUSY, null)
    return Pair(Status.STARTED, settings)
  }

  private fun constraintsMet(appContext: Context, settings: DeviceSettings): Boolean {
    if (settings.autoDownloadWifiOnly) {
      val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
      if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) return false
    }
    if (settings.autoDownloadChargingOnly) {
      val bm = appContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
      if (!bm.isCharging) return false
    }
    return true
  }

  private enum class Recheck { OK, SKIP_PODCAST, ABORT_CHECK }

  // Settings and server can change while the check awaits network or queue responses
  private fun recheck(serverConfigId: String, libraryItemId: String): Recheck {
    if (DeviceManager.serverConnectionConfig?.id != serverConfigId) return Recheck.ABORT_CHECK
    val current = DeviceManager.deviceData.deviceSettings ?: DeviceSettings.default()
    if (!current.autoDownloadEnabled) return Recheck.ABORT_CHECK
    val entry = AutoDownloadStore.get(serverConfigId, libraryItemId)
    val allowed = entry.enabled == PodcastAutoDownloadEntry.ENABLED_ON ||
            (entry.enabled == PodcastAutoDownloadEntry.ENABLED_DEFAULT && current.autoDownloadAllPodcasts)
    return if (allowed) Recheck.OK else Recheck.SKIP_PODCAST
  }

  private suspend fun <T> await(timeoutMs: Long = DEFAULT_TIMEOUT_MS, block: ((T) -> Unit) -> Unit): T? {
    return withTimeoutOrNull(timeoutMs) {
      suspendCancellableCoroutine<T> { cont ->
        block { result -> if (cont.isActive) cont.resume(result) }
      }
    }
  }

  private fun isDownloadedLocally(libraryItemId: String, episodeId: String): Boolean {
    return DeviceManager.dbManager.getLocalLibraryItems().any { local ->
      local.libraryItemId == libraryItemId && (local.media as? Podcast)?.episodes?.any { it.serverEpisodeId == episodeId } == true
    }
  }

  private suspend fun runCheck(appContext: Context, trigger: Trigger, settings: DeviceSettings) {
    try {
      val serverConfigId = DeviceManager.serverConnectionConfig?.id ?: return
      doCheck(appContext, trigger, serverConfigId, settings)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      AbsLogger.error(TAG, "Auto download check failed unexpectedly (${e.javaClass.simpleName}: ${e.message})")
    }
  }

  private suspend fun doCheck(appContext: Context, trigger: Trigger, serverConfigId: String, settings: DeviceSettings) {
    val api = ApiHandler(appContext)

    val user = await<User?> { api.getCurrentUser(it) }
    if (user == null) {
      AbsLogger.error(TAG, "Could not load the current user, ending check")
      return
    }
    val finished = HashSet<String>()
    val progressByKey = HashMap<String, MediaProgress>()
    user.mediaProgress.forEach { progress ->
      val episodeId = progress.episodeId ?: return@forEach
      val key = "${progress.libraryItemId}/$episodeId"
      progressByKey[key] = progress
      if (progress.isFinished) finished.add(key)
    }

    val entries = AutoDownloadStore.getEntriesForServer(serverConfigId)
    val targets = LinkedHashSet<String>()
    entries.forEach { (id, entry) -> if (entry.enabled == PodcastAutoDownloadEntry.ENABLED_ON) targets.add(id) }
    if (settings.autoDownloadAllPodcasts) {
      val libraries = await<List<app.absplus.android.data.Library>> { api.getLibraries(it) }
      if (libraries == null) {
        AbsLogger.error(TAG, "Could not load libraries, ending check")
        return
      }
      libraries.filter { it.mediaType == "podcast" }.forEach { library ->
        var page = 0
        while (page < MAX_PAGES) {
          val result = await<app.absplus.android.data.LibraryItemsPage?> { api.getLibraryItemsPage(library.id, page, PAGE_LIMIT, it) }
          if (result == null) {
            AbsLogger.error(TAG, "Could not load page $page of library ${library.id}, skipping the rest of it")
            break
          }
          result.results.forEach { targets.add(it.id) }
          if (result.isLastPage) break
          page++
        }
      }
      entries.forEach { (id, entry) -> if (entry.enabled == PodcastAutoDownloadEntry.ENABLED_OFF) targets.remove(id) }
    }

    AbsLogger.info(TAG, "Auto download check started (${trigger.name}), ${targets.size} podcasts")

    val localItems = DeviceManager.dbManager.getLocalLibraryItems()
    var queued = 0
    var retried = 0
    var failedPodcasts = 0

    for (id in targets) {
      if (DeviceManager.serverConnectionConfig?.id != serverConfigId) {
        AbsLogger.info(TAG, "Server connection changed, aborting auto download check")
        return
      }
      // Settings may change while a long check runs
      val current = DeviceManager.deviceData.deviceSettings ?: DeviceSettings.default()
      if (!current.autoDownloadEnabled) {
        AbsLogger.info(TAG, "Auto download was disabled, aborting check")
        return
      }
      val entry = AutoDownloadStore.get(serverConfigId, id)
      if (entry.enabled == PodcastAutoDownloadEntry.ENABLED_OFF) continue
      if (entry.enabled == PodcastAutoDownloadEntry.ENABLED_DEFAULT && !current.autoDownloadAllPodcasts) continue
      val keepCount = entry.keepCount ?: current.autoDownloadKeepCount
      if (keepCount <= 0) continue

      val item = await<app.absplus.android.data.LibraryItem?> { api.getLibraryItemWithProgress(id, null, it) }
      if (item == null) {
        AbsLogger.error(TAG, "Could not load podcast $id, skipping")
        failedPodcasts++
        continue
      }
      if (DeviceManager.serverConnectionConfig?.id != serverConfigId) {
        AbsLogger.info(TAG, "Server connection changed, aborting auto download check")
        return
      }
      val podcast = item.media as? Podcast ?: continue

      val window = (podcast.episodes ?: mutableListOf())
        .filter { it.audioFile != null && "$id/${it.id}" !in finished }
        .sortedWith(compareByDescending(nullsFirst<Long>()) { it.publishedAt })
        .take(keepCount)

      val downloadedEpisodeIds = localItems.filter { it.libraryItemId == id }
        .flatMap { local -> (local.media as? Podcast)?.episodes?.mapNotNull { it.serverEpisodeId } ?: emptyList() }
        .toSet()
      val knownIds = entry.autoDownloadedEpisodeIds.toSet()
      var podcastFailed = false

      for (episode in window) {
        val downloadId = "$id-${episode.id}"
        val state = await<DownloadItemManager.QueuedState> { DownloadServiceHost.queuedState(appContext, downloadId, it) }
        if (state == null) {
          AbsLogger.error(TAG, "Timed out reading queue state for $downloadId")
          podcastFailed = true
          continue
        }
        when (recheck(serverConfigId, id)) {
          Recheck.ABORT_CHECK -> {
            AbsLogger.info(TAG, "Server changed or auto download disabled, aborting check")
            return
          }
          Recheck.SKIP_PODCAST -> break
          Recheck.OK -> Unit
        }
        when (state) {
          DownloadItemManager.QueuedState.PENDING -> AutoDownloadStore.addEpisodeId(serverConfigId, id, episode.id)
          DownloadItemManager.QueuedState.FAILED -> {
            val result = await<DownloadServiceHost.ExistingDownloadResult> { DownloadServiceHost.retryExisting(appContext, downloadId, it) }
            when (result) {
              DownloadServiceHost.ExistingDownloadResult.RETRIED -> {
                retried++
                AutoDownloadStore.addEpisodeId(serverConfigId, id, episode.id)
              }
              DownloadServiceHost.ExistingDownloadResult.SERVICE_START_FAILED ->
                AutoDownloadStore.addEpisodeId(serverConfigId, id, episode.id)
              else -> Log.d(TAG, "Retry of $downloadId not applied: $result")
            }
          }
          DownloadItemManager.QueuedState.NOT_QUEUED -> {
            // The local snapshot is taken before network calls; a manual download may have finished since
            if (episode.id in downloadedEpisodeIds || episode.id in knownIds || isDownloadedLocally(id, episode.id)) {
              AutoDownloadStore.addEpisodeId(serverConfigId, id, episode.id)
              continue
            }
            item.userMediaProgress = progressByKey["$id/${episode.id}"]
            val result = await<StartResult> { cb ->
              LibraryItemDownloadStarter.startPodcastEpisodeDownload(appContext, item, episode) { cb(StartResult(it)) }
            }
            when {
              result == null -> {
                AbsLogger.error(TAG, "Timed out starting download $downloadId")
                podcastFailed = true
              }
              result.error == null -> {
                queued++
                AutoDownloadStore.addEpisodeId(serverConfigId, id, episode.id)
              }
              // The item is already persisted in the queue and resumes when the app opens
              result.error == DownloadServiceHost.SERVICE_START_FAILED_MESSAGE -> {
                queued++
                AutoDownloadStore.addEpisodeId(serverConfigId, id, episode.id)
              }
              else -> {
                AbsLogger.error(TAG, "Could not start download $downloadId: ${result.error}")
                podcastFailed = true
              }
            }
          }
        }
      }
      if (podcastFailed) failedPodcasts++
    }

    AbsLogger.info(TAG, "Auto download check finished: queued $queued, retried $retried, failed podcasts $failedPodcasts")
  }
}
