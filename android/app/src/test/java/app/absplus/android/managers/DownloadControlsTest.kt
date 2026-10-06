package app.absplus.android.managers

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import app.absplus.android.data.LocalFolder
import app.absplus.android.data.MediaType
import app.absplus.android.data.MediaTypeMetadata
import app.absplus.android.device.DeviceManager
import app.absplus.android.device.FolderScanner
import app.absplus.android.models.DownloadItem
import app.absplus.android.models.DownloadItemPart
import com.getcapacitor.JSObject
import io.paperdb.Paper
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The user's download controls: Retry restarts unfinished files from byte 0 and keeps finished ones;
 * Cancel and Clear remove the download, deleting only app-owned partial data (and unreachable
 * internal files), never a file a saved local item uses or one that existed before.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DownloadControlsTest {
  private lateinit var context: Context
  private lateinit var root: File
  private val events = mutableListOf<String>()

  private val emitter =
          object : DownloadItemManager.DownloadEventEmitter {
            override fun onDownloadItem(downloadItem: DownloadItem) { events.add("item:${downloadItem.id}") }
            override fun onDownloadItemPartUpdate(downloadItemPart: DownloadItemPart) { events.add("part:${downloadItemPart.filename}") }
            override fun onDownloadItemComplete(jsobj: JSObject) { events.add("complete") }
            override fun onQueueChanged(hasWork: Boolean) { events.add("queue:$hasWork") }
          }

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    Paper.init(context)
    Paper.book("downloadItems").destroy()
    Paper.book("localLibraryItems").destroy()
    try {
      WorkManager.initialize(context, Configuration.Builder().setExecutor { it.run() }.build())
    } catch (e: IllegalStateException) {
      // Already initialized by an earlier test in this process
    }
    root = File(context.cacheDir, "downloads-test").apply { deleteRecursively(); mkdirs() }
    events.clear()
  }

  private fun part(
          itemId: String,
          name: String,
          internal: Boolean = true,
          moved: Boolean = false,
          failed: Boolean = false,
          isMoving: Boolean = false,
          bytes: Long = 0
  ) =
          DownloadItemPart(
                  id = "part-$itemId-$name",
                  downloadItemId = itemId,
                  filename = name,
                  fileSize = 10,
                  destinationPath = File(root, "staging/$itemId/$name.part").path,
                  finalDestinationPath = File(root, "final/$itemId/$name").path,
                  serverPath = "/api/items/$itemId/file/$name",
                  localFolderName = if (internal) "Internal App Storage" else "ABSTEST",
                  localFolderUrl = if (internal) "" else "content://com.android.externalstorage.documents/tree/primary%3AABSTEST",
                  localFolderId = if (internal) "internal-book" else "saf-abstest",
                  ebookFile = null,
                  audioTrack = null,
                  episode = null,
                  completed = moved,
                  moved = moved,
                  isMoving = isMoving,
                  failed = failed,
                  uri = Uri.parse("http://server/file"),
                  destinationUri = Uri.parse("file:///staging/$name"),
                  finalDestinationUri = Uri.parse("file:///final/$name"),
                  completedDestinationUri = null,
                  finalDestinationSubfolder = "Author/Book",
                  downloadId = null,
                  lastUpdateTime = null,
                  progress = 0,
                  bytesDownloaded = bytes
          )

  private fun item(id: String, vararg parts: DownloadItemPart, internal: Boolean = true) =
          DownloadItem(
                  id = id,
                  libraryItemId = id,
                  episodeId = null,
                  userMediaProgress = null,
                  serverConnectionConfigId = "server",
                  serverAddress = "http://server",
                  serverUserId = "user",
                  mediaType = "book",
                  itemFolderPath = File(root, "final/$id").path,
                  localFolder =
                          if (internal) LocalFolder("internal-book", "Internal App Storage", "", "", "", "internal", "book")
                          else LocalFolder("saf-abstest", "ABSTEST", "content://tree/ABSTEST", "", "", "external", "book"),
                  itemTitle = "Title $id",
                  itemSubfolder = "Author/Book",
                  media = MediaType(MediaTypeMetadata("Title $id", false), null),
                  downloadItemParts = parts.toMutableList()
          )

  private fun touch(path: String, size: Int = 10) = File(path).apply { parentFile?.mkdirs(); writeBytes(ByteArray(size)) }

  private fun manager() = DownloadItemManager(FolderScanner(context), context, emitter)

  // --- Pure decisions ---

  @Test
  fun aFinishedOrFinishingDownloadCannotBeRemoved() {
    val done = item("done", part("done", "01.mp3", moved = true), part("done", "cover.jpg", moved = true))
    assertEquals(DownloadControls.Refusal.FINISHING, DownloadControls.removalRefusal(done, isFinalizing = false))
    val failed = item("failed", part("failed", "01.mp3", failed = true))
    assertEquals(DownloadControls.Refusal.FINISHING, DownloadControls.removalRefusal(failed, isFinalizing = true))
    assertNull(DownloadControls.removalRefusal(failed, isFinalizing = false))
  }

  @Test
  fun aFileBeingSavedToItsFolderBlocksRemovalUntilItLands() {
    val saving = item("saving", part("saving", "01.mp3", internal = false, isMoving = true), internal = false)
    assertEquals(DownloadControls.Refusal.MOVING, DownloadControls.removalRefusal(saving, isFinalizing = false))
  }

  @Test
  fun removalDeletesPartialDataAndKeepsFinishedFilesInDeviceFolders() {
    val audio = part("a", "01.mp3", internal = false, moved = true)
    val reused = part("a", "02.mp3", internal = false, moved = true).apply { reusedExistingFile = true }
    val cover = part("a", "cover.jpg", internal = false, failed = true)
    val plan = DownloadControls.removalPlan(item("a", audio, reused, cover, internal = false)) { false }
    assertEquals(listOf(audio.destinationPath, reused.destinationPath, cover.destinationPath), plan.delete)
    assertEquals(listOf("01.mp3", "02.mp3"), plan.keptFinishedFiles)
  }

  @Test
  fun removalDeletesUnreachableInternalFilesButNeverOnesALocalItemUses() {
    val loose = part("b", "01.mp3", moved = true)
    val used = part("b", "02.mp3", moved = true)
    val pending = part("b", "03.mp3")
    val plan = DownloadControls.removalPlan(item("b", loose, used, pending)) { it === used }
    assertTrue(loose.finalDestinationPath in plan.delete)
    assertFalse(used.finalDestinationPath in plan.delete)
    assertEquals(listOf("02.mp3"), plan.keptFinishedFiles)
  }

  @Test
  fun retryNeedsEveryTransferStoppedAndAnUnfinishedItem() {
    val a = part("r", "01.mp3", failed = true)
    val b = part("r", "cover.jpg", failed = true)
    val stopped = item("r", a, b)
    assertTrue(DownloadControls.canRetry(stopped) { false })
    // A second Retry while the first one's transfer runs does nothing
    assertFalse(DownloadControls.canRetry(stopped) { it === a })
    assertFalse(DownloadControls.canRetry(item("m", part("m", "01.mp3", isMoving = true))) { false })
    assertFalse(DownloadControls.canRetry(item("f", part("f", "01.mp3", moved = true))) { false })
  }

  @Test
  fun lostFolderAccessIsReportedForFilesStillToBeWritten() {
    val audio = part("p", "01.mp3", internal = false, failed = true).apply { permissionLost = true }
    val cover = part("p", "cover-p.jpg", internal = false, failed = true).apply { permissionLost = true }
    val lost = item("p", audio, cover, internal = false)
    assertEquals(listOf("ABSTEST"), DownloadControls.foldersWithoutAccess(lost) { false })
    // Access restored by re-selecting the folder
    assertTrue(DownloadControls.foldersWithoutAccess(lost) { true }.isEmpty())
    // Files already written and internal storage need no folder access
    val written = item("w", part("w", "01.mp3", internal = false, moved = true), part("w", "02.mp3"), internal = false)
    assertTrue(DownloadControls.foldersWithoutAccess(written) { false }.isEmpty())
  }

  // --- DownloadItemManager applying them ---

  @Test
  fun cancelWhileQueuedRemovesTheItemAndItsPartialFiles() {
    val queued = part("q", "01.mp3", bytes = 4)
    touch(queued.destinationPath, 4)
    val manager = manager()
    manager.addDownloadItem(item("q", queued))
    assertEquals(DownloadItemManager.RemoveResult.REMOVED, manager.removeDownloadItem("q", "Cancel"))
    assertTrue(manager.downloadItemQueue.isEmpty())
    assertTrue(DeviceManager.dbManager.getDownloadItems().isEmpty())
    assertFalse(File(queued.destinationPath).exists())
    assertEquals("queue:false", events.last())
    // Cancelling again finds nothing: no duplicate work, no error
    assertEquals(DownloadItemManager.RemoveResult.NOT_FOUND, manager.removeDownloadItem("q", "Cancel"))
  }

  @Test
  fun clearFailedRemovesTheEntryAndKeepsTheFinishedAudioInTheDeviceFolder() {
    val audio = part("c", "01.mp3", internal = false, moved = true)
    val cover = part("c", "cover-c.jpg", internal = false, failed = true).apply { permissionLost = true }
    val finishedAudio = touch(audio.finalDestinationPath)
    touch(cover.destinationPath, 3)
    val manager = manager()
    manager.addDownloadItem(item("c", audio, cover, internal = false))
    assertEquals(DownloadItemManager.RemoveResult.REMOVED, manager.removeDownloadItem("c", "Clear"))
    assertTrue(finishedAudio.exists())
    assertFalse(File(cover.destinationPath).exists())
    assertTrue(manager.downloadItemQueue.isEmpty())
  }

  @Test
  fun clearCannotTouchACompletedDownload() {
    val audio = part("done", "01.mp3", moved = true)
    val cover = part("done", "cover-done.jpg", moved = true)
    val files = listOf(touch(audio.finalDestinationPath), touch(cover.finalDestinationPath))
    val manager = manager()
    manager.downloadItemQueue.add(item("done", audio, cover))
    assertEquals(DownloadItemManager.RemoveResult.FINISHING, manager.removeDownloadItem("done", "Clear"))
    assertTrue(files.all { it.exists() })
    assertEquals(1, manager.downloadItemQueue.size)
  }

  @Test
  fun retryRestartsUnfinishedFilesFromZeroAndKeepsFinishedOnes() {
    val finished = part("r", "01.mp3", moved = true)
    touch(finished.finalDestinationPath)
    val failedAudio = part("r", "02.mp3", failed = true, bytes = 7).apply { failureReason = "Transfer failed after 5 retries" }
    val failedCover = part("r", "cover-r.jpg", failed = true).apply { failureReason = "Transfer failed after 5 retries" }
    touch(failedAudio.destinationPath, 7)
    val failed = item("r", finished, failedAudio, failedCover).apply { terminalFailureAt = 1L }
    val manager = manager()
    manager.downloadItemQueue.add(failed)

    assertTrue(manager.retryDownloadItem("r"))
    // Audio and cover failures are reset alike: from byte 0, no stale reason, eligible to download again
    listOf(failedAudio, failedCover).forEach {
      assertFalse(it.failed)
      assertEquals(0L, it.bytesDownloaded)
      assertNull(it.failureReason)
      assertNull(it.downloadId)
    }
    assertFalse(File(failedAudio.destinationPath).exists())
    assertTrue(finished.moved)
    assertTrue(File(finished.finalDestinationPath).exists())
    assertNull(failed.terminalFailureAt)
    assertEquals(listOf(failedAudio, failedCover), failed.getNextDownloadItemParts(3))
  }

  @Test
  fun restoringAfterAProcessRestartRestartsUnfinishedFilesAndKeepsFailuresVisible() {
    val partial = part("i", "01.mp3", bytes = 6)
    touch(partial.destinationPath, 6)
    val finished = part("i", "02.mp3", moved = true)
    touch(finished.finalDestinationPath)
    DeviceManager.dbManager.saveDownloadItem(item("i", partial, finished))
    val lostCover = part("l", "cover-l.jpg", internal = false, failed = true).apply { permissionLost = true }
    DeviceManager.dbManager.saveDownloadItem(item("l", lostCover, internal = false).apply { terminalFailureAt = 1L })

    val manager = manager()
    manager.restoreQueue()
    val restored = manager.downloadItemQueue.associateBy { it.id }
    val restartedPart = restored.getValue("i").downloadItemParts.first { it.filename == "01.mp3" }
    assertEquals(0L, restartedPart.bytesDownloaded)
    assertFalse(File(partial.destinationPath).exists())
    assertTrue(restored.getValue("i").downloadItemParts.first { it.filename == "02.mp3" }.moved)
    // The folder-access failure stays failed (not silently retried) and is still in the queue to act on
    val lost = restored.getValue("l").downloadItemParts.single()
    assertTrue(lost.failed && lost.permissionLost)
    assertTrue(events.contains("item:l"))
  }
}
