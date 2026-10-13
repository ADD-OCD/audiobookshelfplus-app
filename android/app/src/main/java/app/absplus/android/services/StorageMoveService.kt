package app.absplus.android.services

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.StatFs
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.absplus.android.MainActivity
import app.absplus.android.R
import app.absplus.android.data.LocalLibraryItem
import app.absplus.android.data.PlaybackSession
import app.absplus.android.device.AndroidVolumeProbe
import app.absplus.android.device.AppStorage
import app.absplus.android.device.DeviceManager
import app.absplus.android.device.DownloadStorageSetting
import app.absplus.android.device.StorageTarget
import app.absplus.android.device.VolumeProbe
import app.absplus.android.managers.LocalItemLocks
import app.absplus.android.managers.MovePlan
import app.absplus.android.managers.MoveResult
import app.absplus.android.managers.MoveStatus
import app.absplus.android.managers.MoverDb
import app.absplus.android.managers.StorageMovePass
import app.absplus.android.managers.StorageMovePlanner
import app.absplus.android.managers.StorageMover
import app.absplus.android.plugins.AbsLogger
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.getcapacitor.JSObject
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Foreground pass that moves app-storage downloads to the selected storage and cleans up after moves. */
class StorageMoveService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val mainHandler = Handler(Looper.getMainLooper())
  private var running = false
  private var lastStartId = 0

  override fun onCreate() {
    super.onCreate()
    DownloadService.ensureChannel(this)
    startForegroundWithType(notification(this, null))
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForegroundWithType(notification(this, lastStatus?.takeIf { running }))
    lastStartId = startId
    // A running pass re-plans before every item, so it picks up whatever this start was for
    if (!running) {
      running = true
      isRunning = true
      // A previous pass's status must not pass for this one's progress
      lastStatus = null
      scope.launch { runPass() }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    scope.cancel()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private suspend fun runPass() {
    val app = applicationContext
    val probe = AndroidVolumeProbe(app)
    try {
      // Before the queue is restored it looks empty, and orphan cleanup would delete failed downloads' folders
      DownloadServiceHost.awaitRestored(app)
      val db = ProdMoverDb()
      StorageMovePass.reconcile(
              setReconcileNeeded = ::postReconcileNeeded,
              heal = { StorageMover.healLastSession(db) },
              cleanOrphans = { StorageMover.cleanOrphans(mountedDownloadRoots(probe), db) },
              planFn = { planNow(probe) },
              move = { move(it, probe, db) },
              onMoved = { id -> DeviceManager.dbManager.getLocalLibraryItem(id)?.let { movedListener?.invoke(it) } },
              onStatus = { publish(app, it) })
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      val message = "${e.javaClass.simpleName}: ${e.message}"
      AbsLogger.error(TAG, "Storage move pass failed ($message)")
      publish(app, lastStatus?.copy(running = false, lastError = message)
              ?: MoveStatus(0, 0, 0L, 0L, emptyMap(), running = false, lastError = message))
    }
    mainHandler.post { finishPass() }
  }

  private fun finishPass() {
    running = false
    isRunning = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    // Not stopSelf(): a start that arrived meanwhile must still reach onStartCommand, or Android kills the app
    stopSelfResult(lastStartId)
  }

  private fun publish(context: Context, status: MoveStatus) {
    lastStatus = status
    // Reporting must not abort the pass or skip finishPass, which would leave the service in foreground
    try {
      (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification(context, status))
      statusListener?.invoke(statusJson(context, status))
    } catch (e: Exception) {
      AbsLogger.error(TAG, "Could not report storage move status (${e.javaClass.simpleName}: ${e.message})")
    }
  }

  private fun startForegroundWithType(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private class ProdMoverDb : MoverDb {
    override fun getItem(id: String): LocalLibraryItem? = DeviceManager.dbManager.getLocalLibraryItem(id)

    override fun saveItem(item: LocalLibraryItem) = DeviceManager.dbManager.saveLocalLibraryItem(item)

    // Called under the item lock; takes only the download manager's monitor, never the other way round
    override fun hasQueuedDownload(libraryItemId: String): Boolean = DownloadServiceHost.hasQueuedDownload(libraryItemId)

    override fun dirOwned(dir: File): Boolean {
      val target = norm(dir)
      return DeviceManager.dbManager.getLocalLibraryItems().any { it.absolutePath.isNotEmpty() && norm(File(it.absolutePath)) == target } ||
              DownloadServiceHost.queueSnapshot().any { it.itemFolderPath.isNotEmpty() && norm(File(it.itemFolderPath)) == target }
    }

    // healLastSession edits the session, so it gets a copy, tracks included, not the live DeviceData object
    override fun lastSession(): PlaybackSession? =
            DeviceManager.deviceData.lastPlaybackSession?.clone()?.also { s ->
              s.audioTracks = s.audioTracks.map { it.copy() }.toMutableList()
            }

    override fun saveLastSession(s: PlaybackSession) {
      Handler(Looper.getMainLooper()).post {
        val deviceData = DeviceManager.deviceData
        // The player may have started another session meanwhile; that one is newer
        if (deviceData.lastPlaybackSession?.id == s.id) {
          deviceData.lastPlaybackSession = s
          DeviceManager.dbManager.saveDeviceData(deviceData)
        }
      }
    }

    private fun norm(f: File) = f.absoluteFile.toPath().normalize()
  }

  companion object {
    private const val TAG = "StorageMoveService"
    private const val NOTIFICATION_ID = 12

    @Volatile var statusListener: ((JSObject) -> Unit)? = null
    @Volatile var movedListener: ((LocalLibraryItem) -> Unit)? = null
    @Volatile var lastStatus: MoveStatus? = null
    @Volatile var isRunning = false

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mapper = jacksonObjectMapper()

    /** Marks a pass as needed after something that may unblock a move ended (download, playback). */
    fun requestReconcile(context: Context) {
      val app = context.applicationContext
      Handler(Looper.getMainLooper()).post {
        try {
          DeviceManager.deviceData.reconcileNeeded = true
          DeviceManager.dbManager.saveDeviceData(DeviceManager.deviceData)
          if (MainActivity.isForeground) startIfNeeded(app)
        } catch (e: Exception) {
          AbsLogger.error(TAG, "Could not request a storage move pass (${e.javaClass.simpleName}: ${e.message})")
        }
      }
    }

    fun startIfNeeded(context: Context) {
      if (isRunning) return
      val app = context.applicationContext
      scope.launch {
        try {
          DownloadServiceHost.awaitRestored(app)
          val flag = DeviceManager.deviceData.reconcileNeeded
          val toMoveEmpty = flag || planNow(AndroidVolumeProbe(app)).toMove.isEmpty()
          if (!StorageMovePass.shouldStart(flag, toMoveEmpty)) return@launch
          // From the background Android 12+ refuses the foreground start; the flag brings it back on resume
          if (!MainActivity.isForeground) {
            AbsLogger.info(TAG, "Storage move pass deferred: app is in background")
            return@launch
          }
          try {
            ContextCompat.startForegroundService(app, Intent(app, StorageMoveService::class.java))
          } catch (e: Exception) {
            AbsLogger.error(TAG, "Could not start storage move service (${e.javaClass.simpleName}: ${e.message})")
          }
        } catch (e: Exception) {
          AbsLogger.error(TAG, "Could not check for downloads to move (${e.javaClass.simpleName}: ${e.message})")
        }
      }
    }

    /** The running pass's status, or what a pass would do now. */
    suspend fun currentMoveStatus(context: Context): MoveStatus {
      val last = lastStatus
      if (isRunning && last != null) return last
      DownloadServiceHost.awaitRestored(context)
      val plan = planNow(AndroidVolumeProbe(context.applicationContext))
      return MoveStatus(
              total = plan.toMove.size,
              done = 0,
              bytesTotal = plan.toMove.sumOf(StorageMovePass::itemSize),
              bytesDone = 0L,
              waiting = StorageMovePass.countWaiting(plan),
              running = false,
              lastError = last?.lastError)
    }

    fun statusJson(context: Context, move: MoveStatus): JSObject {
      val sdVolume = AndroidVolumeProbe(context).volumes().firstOrNull { it.removable }
      val result = JSObject()
      result.put("downloadStorage", DeviceManager.deviceData.deviceSettings?.downloadStorage ?: "internal")
      result.put("internalFreeBytes", StatFs(context.filesDir.path).availableBytes)
      if (sdVolume == null) {
        result.put("sd", JSONObject.NULL)
      } else {
        result.put("sd", JSObject().apply {
          put("uuid", sdVolume.uuid ?: JSONObject.NULL)
          put("mounted", sdVolume.mounted)
          put("freeBytes", if (sdVolume.mounted) StatFs(sdVolume.filesDir.path).availableBytes else 0L)
        })
      }
      result.put("move", JSObject(mapper.writeValueAsString(move)))
      return result
    }

    // Same thread as AbsDatabase's DeviceData writes, so they never overwrite each other
    private fun postReconcileNeeded(value: Boolean) {
      Handler(Looper.getMainLooper()).post {
        DeviceManager.deviceData.reconcileNeeded = value
        DeviceManager.dbManager.saveDeviceData(DeviceManager.deviceData)
      }
    }

    // Re-read every time: the setting can change during a pass
    private fun currentTarget(): StorageTarget =
            DownloadStorageSetting.parse(DeviceManager.deviceData.deviceSettings?.downloadStorage)

    private fun planNow(probe: VolumeProbe): MovePlan =
            StorageMovePlanner.plan(
                    DeviceManager.dbManager.getLocalLibraryItems(),
                    DownloadServiceHost.queueSnapshot(),
                    currentTarget(),
                    probe,
                    LocalItemLocks::isPinned,
                    ::freeBytes)

    private fun move(item: LocalLibraryItem, probe: VolumeProbe, db: MoverDb): MoveResult {
      val folder = AppStorage.folderFor(currentTarget(), item.mediaType)
      // App-storage folders are saved lazily, and moveOne does not save them
      if (AppStorage.isAvailable(folder, probe) && DeviceManager.dbManager.getLocalFolder(folder.id) == null) {
        DeviceManager.dbManager.saveLocalFolder(folder)
      }
      return StorageMover.moveOne(item.id, folder, probe, db)
    }

    // The target downloads directory may not exist yet
    private fun freeBytes(dir: File): Long =
            try {
              var existing: File? = dir.absoluteFile
              while (existing != null && !existing.exists()) existing = existing.parentFile
              if (existing == null) 0L else StatFs(existing.path).availableBytes
            } catch (e: Exception) {
              AbsLogger.error(TAG, "Could not read free space of ${dir.absolutePath}: ${e.message}")
              0L
            }

    // Only removable volumes carry app storage folders; the primary external volume is never a target
    private fun mountedDownloadRoots(probe: VolumeProbe): List<File> {
      val roots = mutableListOf(File(probe.internalFilesDir(), "downloads"))
      probe.volumes().forEach { v ->
        val uuid = v.uuid
        if (v.removable && v.mounted && v.writable && uuid != null) {
          AppStorage.downloadsRoot(AppStorage.appsdFolderId(uuid, "book"), probe)?.let { roots += it }
        }
      }
      return roots
    }

    private fun notification(context: Context, status: MoveStatus?): Notification {
      val strings = DownloadServiceHost.notificationStrings(context)
      val title = if (currentTarget() is StorageTarget.Sd) strings.moveToSd else strings.moveToInternal
      val builder =
              NotificationCompat.Builder(context, DownloadService.CHANNEL_ID)
                      .setSmallIcon(R.drawable.icon)
                      .setContentTitle(title)
                      .setOngoing(true)
                      .setOnlyAlertOnce(true)
      if (status != null && status.running && status.total > 0) {
        builder.setContentText("${status.done + 1} / ${status.total}").setProgress(status.total, status.done, false)
      } else {
        builder.setProgress(0, 0, true)
      }
      return builder.build()
    }
  }
}
