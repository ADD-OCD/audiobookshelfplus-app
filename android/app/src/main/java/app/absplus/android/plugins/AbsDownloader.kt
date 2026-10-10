package app.absplus.android.plugins

import app.absplus.android.MainActivity
import app.absplus.android.data.*
import app.absplus.android.device.DeviceManager
import app.absplus.android.models.DownloadItem
import app.absplus.android.models.DownloadItemPart
import app.absplus.android.server.ApiHandler
import app.absplus.android.managers.DownloadItemManager
import app.absplus.android.managers.LibraryItemDownloadStarter
import app.absplus.android.services.DownloadServiceHost
import com.fasterxml.jackson.core.json.JsonReadFeature
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AbsDownloader")
class AbsDownloader : Plugin() {
  private val tag = "AbsDownloader"
  private var jacksonMapper = jacksonObjectMapper().enable(JsonReadFeature.ALLOW_UNESCAPED_CONTROL_CHARS.mappedFeature())

  lateinit var mainActivity: MainActivity
  lateinit var apiHandler: ApiHandler
  lateinit var downloadItemManager: DownloadItemManager

  private val clientEventEmitter = (object : DownloadItemManager.DownloadEventEmitter {
    override fun onDownloadItem(downloadItem:DownloadItem) {
      notifyListeners("onDownloadItem", JSObject(jacksonMapper.writeValueAsString(downloadItem)))
    }
    override fun onDownloadItemPartUpdate(downloadItemPart:DownloadItemPart) {
      notifyListeners("onDownloadItemPartUpdate", JSObject(jacksonMapper.writeValueAsString(downloadItemPart)))
    }
    override fun onDownloadItemComplete(jsobj:JSObject) {
      notifyListeners("onItemDownloadComplete", jsobj)
    }
    override fun onQueueChanged(hasWork: Boolean) {
      notifyListeners("onQueueChanged", JSObject().put("hasWork", hasWork))
    }
  })

  override fun load() {
    mainActivity = (activity as MainActivity)
    apiHandler = ApiHandler(mainActivity)
    downloadItemManager = DownloadServiceHost.ensure(mainActivity)
    DownloadServiceHost.attachBridge(mainActivity, clientEventEmitter)
  }

  override fun handleOnDestroy() {
    DownloadServiceHost.detachBridge()
    super.handleOnDestroy()
  }

  @PluginMethod
  fun setDownloadNotificationStrings(call: PluginCall) {
    DownloadServiceHost.setNotificationStrings(
            mainActivity,
            call.getString("preparing") ?: "Preparing downloads",
            call.getString("downloadingFile") ?: "Downloading {0}",
            call.getString("waitingForStorage") ?: "Waiting for available storage",
            call.getString("downloads") ?: "Downloads",
            call.getString("cancel") ?: "Cancel")
    call.resolve()
  }

  /** The download queue (active, queued and failed items) for the Downloads screen. */
  @PluginMethod
  fun getDownloadQueue(call: PluginCall) {
    DownloadServiceHost.snapshot(mainActivity) { items ->
      val array = JSArray()
      items.forEach { array.put(JSObject(jacksonMapper.writeValueAsString(it))) }
      call.resolve(JSObject().put("items", array))
    }
  }

  /** Retry a stopped download: unfinished files restart from byte 0, finished files are kept. */
  @PluginMethod
  fun retryDownload(call: PluginCall) {
    val downloadItemId = call.getString("downloadItemId") ?: ""
    AbsLogger.info(tag, "User chose Retry for download $downloadItemId")
    DownloadServiceHost.retryExisting(mainActivity, downloadItemId) { result ->
      val errorCode =
              when (result) {
                DownloadServiceHost.ExistingDownloadResult.RETRIED -> null
                DownloadServiceHost.ExistingDownloadResult.NOT_FOUND -> "notFound"
                DownloadServiceHost.ExistingDownloadResult.ACTIVE -> "active"
                DownloadServiceHost.ExistingDownloadResult.FOLDER_ACCESS -> "folderAccess"
                DownloadServiceHost.ExistingDownloadResult.SERVICE_START_FAILED -> "service"
              }
      call.resolve(if (errorCode == null) JSObject() else JSObject().put("errorCode", errorCode))
    }
  }

  /** Cancel (active or queued) or Clear (failed) one download; see DownloadControls for what is deleted. */
  @PluginMethod
  fun removeDownload(call: PluginCall) {
    val downloadItemId = call.getString("downloadItemId") ?: ""
    val action = if (call.getString("action") == "clear") "Clear" else "Cancel"
    AbsLogger.info(tag, "User chose $action for download $downloadItemId")
    DownloadServiceHost.remove(mainActivity, downloadItemId, action) { result ->
      val errorCode =
              when (result) {
                DownloadItemManager.RemoveResult.REMOVED -> null
                DownloadItemManager.RemoveResult.NOT_FOUND -> "notFound"
                DownloadItemManager.RemoveResult.FINISHING -> "finishing"
                DownloadItemManager.RemoveResult.MOVING -> "moving"
              }
      call.resolve(if (errorCode == null) JSObject() else JSObject().put("errorCode", errorCode))
    }
  }

  /** Replays restored queue items when the frontend subscribes to download events. */
  @PluginMethod(returnType = PluginMethod.RETURN_NONE)
  override fun addListener(call: PluginCall) {
    super.addListener(call)
    if (call.getString("eventName") == "onDownloadItem" && ::downloadItemManager.isInitialized) {
      downloadItemManager.downloadItemQueue.forEach { item ->
        notifyListeners("onDownloadItem", JSObject(jacksonMapper.writeValueAsString(item)))
      }
    }
  }

  @PluginMethod
  fun downloadLibraryItem(call: PluginCall) {
    val libraryItemId = call.data.getString("libraryItemId").toString()
    var episodeId = call.data.getString("episodeId").toString()
    if (episodeId == "null") episodeId = ""
    var localFolderId = call.data.getString("localFolderId", "").toString()
    AbsLogger.info(tag, "Requested download for item $libraryItemId${if (episodeId.isEmpty()) "" else " / episode $episodeId"}")

    val downloadId = if (episodeId.isEmpty()) libraryItemId else "$libraryItemId-$episodeId"
    DownloadServiceHost.retryExisting(mainActivity, downloadId) { result ->
      when (result) {
        DownloadServiceHost.ExistingDownloadResult.RETRIED -> call.resolve()
        DownloadServiceHost.ExistingDownloadResult.ACTIVE -> {
          AbsLogger.info(tag, "Download already active for $downloadId")
          call.resolve(JSObject("{\"error\":\"Download already started for this media entity\"}"))
        }
        DownloadServiceHost.ExistingDownloadResult.SERVICE_START_FAILED ->
                call.resolve(JSObject("{\"error\":\"Unable to start the Android download service\"}"))
        DownloadServiceHost.ExistingDownloadResult.FOLDER_ACCESS ->
                call.resolve(JSObject().put("error", "Folder access lost: re-select the download folder to retry").put("errorCode", "folderAccess"))
        DownloadServiceHost.ExistingDownloadResult.NOT_FOUND -> {
          apiHandler.getLibraryItemWithProgress(libraryItemId, episodeId) { libraryItem ->
            if (libraryItem == null) {
              call.resolve(JSObject("{\"error\":\"Server request failed\"}"))
            } else {
              AbsLogger.info(tag, "Preparing download for ${libraryItem.id}")

              if (localFolderId == "") localFolderId = "internal-${libraryItem.mediaType}"
              val localFolder = LibraryItemDownloadStarter.getOrCreateLocalFolder(localFolderId, libraryItem.mediaType)

              if (localFolder == null) {
                call.resolve(JSObject("{\"error\":\"Local Folder Not Found\"}"))
              } else if (episodeId.isNotEmpty() && libraryItem.mediaType != "podcast") {
                call.resolve(JSObject("{\"error\":\"Invalid library item not a podcast\"}"))
              } else if (episodeId.isNotEmpty()) {
                val podcast = libraryItem.media as Podcast
                val episode = podcast.episodes?.find { it.id == episodeId }
                if (episode == null) {
                  call.resolve(JSObject("{\"error\":\"Invalid podcast episode not found\"}"))
                } else {
                  LibraryItemDownloadStarter.startLibraryItemDownload(mainActivity, libraryItem, localFolder, episode) { error -> resolveDownloadCall(call, error) }
                }
              } else {
                LibraryItemDownloadStarter.startLibraryItemDownload(mainActivity, libraryItem, localFolder, null) { error -> resolveDownloadCall(call, error) }
              }
            }
          }
        }
      }
    }
  }

  private fun resolveDownloadCall(call: PluginCall, error: String?) {
    if (error == null) call.resolve()
    else call.resolve(JSObject().put("error", error))
  }
}
