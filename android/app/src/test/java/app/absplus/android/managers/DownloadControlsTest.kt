package app.absplus.android.managers

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import app.absplus.android.data.LocalFolder
import app.absplus.android.data.MediaType
import app.absplus.android.data.MediaTypeMetadata
import app.absplus.android.data.ServerConnectionConfig
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
import org.junit.After
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
  private lateinit var previousServers: MutableList<ServerConnectionConfig>
  private var previousActive: ServerConnectionConfig? = null

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
    previousServers = DeviceManager.deviceData.serverConnectionConfigs
    previousActive = DeviceManager.serverConnectionConfig
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(
            ServerConnectionConfig("server", 0, "Synthetic owner", "http://server", null,
                    "user", "synthetic", "synthetic-owner-token", null))
    DeviceManager.serverConnectionConfig = null
    try {
      WorkManager.initialize(context, Configuration.Builder().setExecutor { it.run() }.build())
    } catch (e: IllegalStateException) {
      // Already initialized by an earlier test in this process
    }
    root = File(context.cacheDir, "downloads-test").apply { deleteRecursively(); mkdirs() }
    events.clear()
  }

  @After
  fun restoreServerFixtures() {
    DeviceManager.deviceData.serverConnectionConfigs = previousServers
    DeviceManager.serverConnectionConfig = previousActive
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

  @Test
  fun missingOwnerOnRestoreKeepsPartialBytesAndDoesNotAdoptActiveServer() {
    val partial = part("held", "01.mp3", bytes = 6)
    val bytes = touch(partial.destinationPath, 6).readBytes().toList()
    DeviceManager.dbManager.saveDownloadItem(item("held", partial).apply { terminalFailureAt = 1L })
    val other = DeviceManager.deviceData.serverConnectionConfigs.single().copy(
            id = "other", address = "http://other.invalid", token = "synthetic-other-token")
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(other)
    DeviceManager.serverConnectionConfig = other

    val manager = manager()
    manager.restoreQueue()
    val held = manager.downloadItemQueue.single()
    assertEquals("server", held.serverConnectionConfigId)
    assertEquals(6L, held.downloadItemParts.single().bytesDownloaded)
    assertTrue(held.downloadItemParts.single().failed)
    assertNull(held.terminalFailureAt)
    assertEquals(bytes, File(partial.destinationPath).readBytes().toList())
    assertEquals(6L, DeviceManager.dbManager.getDownloadItems().single().downloadItemParts.single().bytesDownloaded)
  }

  @Test
  fun changedOwnerCannotRetryOrDiscardPartialData() {
    val partial = part("held", "01.mp3", failed = true, bytes = 7)
    touch(partial.destinationPath, 7)
    val held = item("held", partial).apply { terminalFailureAt = 1L }
    DeviceManager.deviceData.serverConnectionConfigs.single().userId = "different-user"
    val manager = manager()
    manager.downloadItemQueue.add(held)

    assertFalse(manager.retryDownloadItem("held"))
    assertTrue(partial.failed)
    assertEquals(7L, partial.bytesDownloaded)
    assertEquals(7L, File(partial.destinationPath).length())
    assertNull(held.terminalFailureAt)
    assertEquals(1, DeviceManager.dbManager.getDownloadItems().size)
  }

  @Test
  fun missingFinalizedFileDoesNotDiscardRetainedCopyWhenOwnerIsGone() {
    val part = part("missing-final", "01.mp3", moved = true, bytes = 7)
    touch(part.destinationPath, 7)
    assertFalse(File(part.finalDestinationPath).exists())
    DeviceManager.dbManager.saveDownloadItem(item("missing-final", part))
    DeviceManager.deviceData.serverConnectionConfigs.clear()

    val manager = manager()
    manager.restoreQueue()
    val held = manager.downloadItemQueue.single().downloadItemParts.single()
    assertTrue(held.failed)
    assertEquals(7L, held.bytesDownloaded)
    assertEquals(7L, File(part.destinationPath).length())
  }

  @Test
  fun expiredCleanupBeforeRestorePreservesMissingOwnersPartialData() {
    val partial = part("expired-held", "01.mp3", failed = true, bytes = 7).copy(
            destinationPath = File(context.filesDir, "authorization-expiry-fixture/01.mp3.part").path)
    val owner = DeviceManager.deviceData.serverConnectionConfigs.single().copy()
    touch(partial.destinationPath, 7)
    DeviceManager.dbManager.saveDownloadItem(item("expired-held", partial).apply { terminalFailureAt = 1L })
    DeviceManager.deviceData.serverConnectionConfigs.clear()

    IncompleteDownloadCleanup.cleanupExpired(context)
    val kept = DeviceManager.dbManager.getDownloadItems().single()
    assertNull(kept.stagingCleanupAt)
    assertEquals(7L, kept.downloadItemParts.single().bytesDownloaded)
    assertEquals(7L, File(partial.destinationPath).length())

    // The ordinary retention policy still works for a verified owner; the guard is not a blanket bypass.
    DeviceManager.deviceData.serverConnectionConfigs.add(owner)
    IncompleteDownloadCleanup.cleanupExpired(context)
    assertFalse(File(partial.destinationPath).exists())
    assertEquals(0L, DeviceManager.dbManager.getDownloadItems().single().downloadItemParts.single().bytesDownloaded)
  }
}
