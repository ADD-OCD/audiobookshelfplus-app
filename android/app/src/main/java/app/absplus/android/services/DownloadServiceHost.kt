package app.absplus.android.services

import android.content.Context
import androidx.core.content.ContextCompat
import app.absplus.android.device.DeviceManager
import app.absplus.android.device.FolderScanner
import app.absplus.android.managers.DbManager
import app.absplus.android.managers.DownloadItemManager
import app.absplus.android.managers.IncompleteDownloadCleanup
import app.absplus.android.models.DownloadItem
import app.absplus.android.plugins.AbsLogger
import com.getcapacitor.JSObject
import java.util.Collections
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Shared process owner used by the foreground service and the Capacitor bridge. */
object DownloadServiceHost {
  enum class ExistingDownloadResult { NOT_FOUND, ACTIVE, RETRIED, SERVICE_START_FAILED, FOLDER_ACCESS }

  data class NotificationStrings(
          val preparing: String,
          val downloadingFile: String,
          val waitingForStorage: String,
          val downloads: String,
          val cancel: String
  )

  private var manager: DownloadItemManager? = null
  private var bridgeEmitter: DownloadItemManager.DownloadEventEmitter = NoopEmitter
  @Volatile private var service: DownloadService? = null
  @Volatile private var bridgeReady = false
  private val deferredCompletions = Collections.synchronizedList(mutableListOf<JSObject>())
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var restoreJob: Job? = null

  @Synchronized
  fun ensure(context: Context): DownloadItemManager {
    if (manager == null) {
      val appContext = context.applicationContext
      DbManager.initialize(appContext)
      manager = DownloadItemManager(FolderScanner(appContext), appContext, ForwardingEmitter)
      restoreJob = scope.launch {
        try {
          if (DeviceManager.dbManager.ensureValidDownloadQueue()) {
            IncompleteDownloadCleanup.cleanupExpired(appContext)
            manager!!.restoreQueue()
          } else {
            AbsLogger.error(TAG, "Skipping invalid download queue because it could not be cleared")
          }
          onRestoreComplete(appContext)
        } catch (restoreError: Exception) {
          AbsLogger.error(
                  TAG,
                  "Could not restore download queue (${restoreError.javaClass.simpleName}: ${restoreError.message})"
          )
        }
      }
    }
    return manager!!
  }

  /** Attaches the frontend after restored queue items have been emitted. */
  @Synchronized
  fun attachBridge(context: Context, emitter: DownloadItemManager.DownloadEventEmitter) {
    bridgeReady = false
    bridgeEmitter = emitter
    ensure(context).setEventEmitter(ForwardingEmitter)
    bridgeReady = true
    val completions = synchronized(deferredCompletions) {
      deferredCompletions.toList().also { deferredCompletions.clear() }
    }
    completions.forEach(bridgeEmitter::onDownloadItemComplete)
  }

  @Synchronized
  fun detachBridge() {
    bridgeReady = false
    bridgeEmitter = NoopEmitter
  }

  fun enqueue(context: Context, item: DownloadItem, callback: (String?) -> Unit) {
    val queue = ensure(context)
    scope.launch {
      restoreJob?.join()
      queue.addDownloadItem(item)
      if (startService(context)) callback(null)
      else callback("Unable to start the Android download service")
    }
  }

  fun retryExisting(
          context: Context,
          downloadItemId: String,
          callback: (ExistingDownloadResult) -> Unit
  ) {
    val queue = ensure(context)
    scope.launch {
      restoreJob?.join()
      val existing = queue.downloadItemQueue.find { it.id == downloadItemId }
      val missingFolders = if (existing == null) emptyList() else queue.foldersWithoutAccess(downloadItemId)
      if (existing == null) {
        callback(ExistingDownloadResult.NOT_FOUND)
      } else if (missingFolders.isNotEmpty()) {
        // Retrying can only fail again until the user re-selects the folder, so the item stays as it is
        AbsLogger.info(TAG, "Retry of $downloadItemId refused: no access to ${missingFolders.joinToString()}")
        callback(ExistingDownloadResult.FOLDER_ACCESS)
      } else if (!queue.retryDownloadItem(downloadItemId)) {
        callback(ExistingDownloadResult.ACTIVE)
      } else if (startService(context)) {
        callback(ExistingDownloadResult.RETRIED)
      } else {
        callback(ExistingDownloadResult.SERVICE_START_FAILED)
      }
    }
  }

  /** Cancel or Clear one download (see [DownloadItemManager.removeDownloadItem]). */
  fun remove(
          context: Context,
          downloadItemId: String,
          action: String,
          callback: (DownloadItemManager.RemoveResult) -> Unit
  ) {
    val queue = ensure(context)
    scope.launch {
      restoreJob?.join()
      callback(queue.removeDownloadItem(downloadItemId, action))
    }
  }

  /** The current download queue, restored items included, for the Downloads screen. */
  fun snapshot(context: Context, callback: (List<DownloadItem>) -> Unit) {
    val queue = ensure(context)
    scope.launch {
      restoreJob?.join()
      callback(synchronized(queue) { queue.downloadItemQueue.toList() })
    }
  }

  fun cancelAll(context: Context) {
    val queue = ensure(context)
    scope.launch {
      restoreJob?.join()
      queue.cancelAll()
    }
  }

  fun setNotificationStrings(
          context: Context,
          preparing: String,
          downloadingFile: String,
          waitingForStorage: String,
          downloads: String,
          cancel: String
  ) {
    context.getSharedPreferences(NOTIFICATION_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PREPARING, preparing)
            .putString(KEY_DOWNLOADING_FILE, downloadingFile)
            .putString(KEY_WAITING_FOR_STORAGE, waitingForStorage)
            .putString(KEY_DOWNLOADS, downloads)
            .putString(KEY_CANCEL, cancel)
            .apply()
  }

  fun notificationStrings(context: Context): NotificationStrings {
    val preferences = context.getSharedPreferences(NOTIFICATION_PREFERENCES, Context.MODE_PRIVATE)
    return NotificationStrings(
            preferences.getString(KEY_PREPARING, DEFAULT_PREPARING) ?: DEFAULT_PREPARING,
            preferences.getString(KEY_DOWNLOADING_FILE, DEFAULT_DOWNLOADING_FILE)
                    ?: DEFAULT_DOWNLOADING_FILE,
            preferences.getString(KEY_WAITING_FOR_STORAGE, DEFAULT_WAITING_FOR_STORAGE)
                    ?: DEFAULT_WAITING_FOR_STORAGE,
            preferences.getString(KEY_DOWNLOADS, DEFAULT_DOWNLOADS) ?: DEFAULT_DOWNLOADS,
            preferences.getString(KEY_CANCEL, DEFAULT_CANCEL) ?: DEFAULT_CANCEL)
  }

  fun attachService(downloadService: DownloadService) {
    synchronized(this) { service = downloadService }
    startWork(downloadService)
  }

  @Synchronized
  fun detachService(downloadService: DownloadService) {
    if (service === downloadService) service = null
  }

  fun startWork(context: Context) {
    val queue = ensure(context)
    scope.launch {
      restoreJob?.join()
      queue.resumeWork()
    }
  }

  private fun onRestoreComplete(context: Context) {
    val attachedService = synchronized(this) { service }
    if (attachedService != null) {
      manager?.resumeWork()
    } else if (bridgeReady && manager?.hasWork() == true) {
      startService(context)
    }
  }

  private fun startService(context: Context): Boolean {
    return try {
      ContextCompat.startForegroundService(context, DownloadService.intent(context))
      true
    } catch (e: RuntimeException) {
      AbsLogger.error(TAG, "Could not start download foreground service: ${e.message}")
      false
    }
  }

  private object ForwardingEmitter : DownloadItemManager.DownloadEventEmitter {
    override fun onDownloadItem(downloadItem: DownloadItem) { bridgeEmitter.onDownloadItem(downloadItem) }
    override fun onDownloadItemPartUpdate(downloadItemPart: app.absplus.android.models.DownloadItemPart) {
      if (bridgeReady) bridgeEmitter.onDownloadItemPartUpdate(downloadItemPart)
      service?.onPartUpdate(downloadItemPart)
    }
    override fun onDownloadItemComplete(jsobj: JSObject) {
      if (bridgeReady) bridgeEmitter.onDownloadItemComplete(jsobj) else deferredCompletions.add(jsobj)
    }
    override fun onQueueChanged(hasWork: Boolean) {
      bridgeEmitter.onQueueChanged(hasWork)
      service?.onQueueChanged(hasWork)
    }
  }

  private object NoopEmitter : DownloadItemManager.DownloadEventEmitter {
    override fun onDownloadItem(downloadItem: DownloadItem) = Unit
    override fun onDownloadItemPartUpdate(downloadItemPart: app.absplus.android.models.DownloadItemPart) = Unit
    override fun onDownloadItemComplete(jsobj: JSObject) = Unit
    override fun onQueueChanged(hasWork: Boolean) = Unit
  }

  private const val NOTIFICATION_PREFERENCES = "download_notifications"
  private const val KEY_PREPARING = "preparing"
  private const val KEY_DOWNLOADING_FILE = "downloading_file"
  private const val KEY_WAITING_FOR_STORAGE = "waiting_for_storage"
  private const val KEY_DOWNLOADS = "downloads"
  private const val KEY_CANCEL = "cancel"
  private const val DEFAULT_PREPARING = "Preparing downloads"
  private const val DEFAULT_DOWNLOADING_FILE = "Downloading {0}"
  private const val DEFAULT_WAITING_FOR_STORAGE = "Waiting for available storage"
  private const val DEFAULT_DOWNLOADS = "Downloads"
  private const val DEFAULT_CANCEL = "Cancel"
  private const val TAG = "DownloadServiceHost"
}
