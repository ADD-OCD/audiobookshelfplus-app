package app.absplus.android.managers

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import app.absplus.android.data.LocalFolder
import app.absplus.android.data.MediaType
import app.absplus.android.data.MediaTypeMetadata
import app.absplus.android.device.FolderScanner
import app.absplus.android.models.DownloadItem
import app.absplus.android.models.DownloadItemPart
import com.getcapacitor.JSObject
import io.paperdb.Paper
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Retry (and every new download request, which first checks for an existing item) looks the item up in the queue while
 * download threads add and remove items. The lookup takes the queue's lock, like every queue mutation.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DownloadQueueLookupTest {
  private lateinit var context: Context
  private lateinit var root: File

  private val emitter =
          object : DownloadItemManager.DownloadEventEmitter {
            override fun onDownloadItem(downloadItem: DownloadItem) {}
            override fun onDownloadItemPartUpdate(downloadItemPart: DownloadItemPart) {}
            override fun onDownloadItemComplete(jsobj: JSObject) {}
            override fun onQueueChanged(hasWork: Boolean) {}
          }

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    Paper.init(context)
    Paper.book("downloadItems").destroy()
    try {
      WorkManager.initialize(context, Configuration.Builder().setExecutor { it.run() }.build())
    } catch (e: IllegalStateException) {
      // Already initialized by an earlier test in this process
    }
    root = File(context.cacheDir, "lookup-test").apply { deleteRecursively(); mkdirs() }
  }

  private fun item(id: String): DownloadItem {
    val part =
            DownloadItemPart(
                    id = "part-$id", downloadItemId = id, filename = "01.mp3", fileSize = 10,
                    destinationPath = File(root, "staging/$id/01.mp3.part").path, finalDestinationPath = File(root, "final/$id/01.mp3").path,
                    serverPath = "/api/items/$id/file/1", localFolderName = "Internal App Storage", localFolderUrl = "", localFolderId = "internal-book",
                    ebookFile = null, audioTrack = null, episode = null, completed = false, moved = false, isMoving = false, failed = false,
                    uri = Uri.parse("http://server/file"), destinationUri = Uri.parse("file:///staging/01.mp3"), finalDestinationUri = Uri.parse("file:///final/01.mp3"),
                    completedDestinationUri = null, finalDestinationSubfolder = "Author/Book", downloadId = null, lastUpdateTime = null, progress = 0, bytesDownloaded = 0
            )
    return DownloadItem(
            id = id, libraryItemId = id, episodeId = null, userMediaProgress = null, serverConnectionConfigId = "server", serverAddress = "http://server",
            serverUserId = "user", mediaType = "book", itemFolderPath = File(root, "final/$id").path,
            localFolder = LocalFolder("internal-book", "Internal App Storage", "", "", "", "internal", "book"), itemTitle = "Title $id",
            itemSubfolder = "Author/Book", media = MediaType(MediaTypeMetadata("Title $id", false), null), downloadItemParts = mutableListOf(part)
    )
  }

  private fun manager() = DownloadItemManager(FolderScanner(context), context, emitter)

  @Test
  fun findsTheQueuedItemItselfAndNothingElse() {
    val manager = manager()
    manager.addDownloadItem(item("a"))
    manager.addDownloadItem(item("b"))
    assertSame("the queued object itself, not a copy", manager.downloadItemQueue.first { it.id == "b" }, manager.findDownloadItem("b"))
    assertNull(manager.findDownloadItem("missing"))
  }

  @Test
  fun lookupWaitsWhileAnotherThreadHoldsTheQueueLock() {
    val manager = manager()
    manager.addDownloadItem(item("a"))
    val found = AtomicReference<DownloadItem?>()
    val started = CountDownLatch(1)
    val lookup = Thread { started.countDown(); found.set(manager.findDownloadItem("a")) }
    synchronized(manager) {
      lookup.start()
      assertTrue(started.await(5, TimeUnit.SECONDS))
      lookup.join(300)
      assertTrue("the lookup must wait for the lock that guards every queue change", lookup.isAlive)
    }
    lookup.join(5000)
    assertFalse(lookup.isAlive)
    assertEquals("a", found.get()?.id)
  }

  @Test
  fun lookupsDuringConcurrentAddsAndRemovesNeverThrow() {
    val manager = manager()
    (0 until 40).forEach { manager.addDownloadItem(item("seed-$it")) }
    val failure = AtomicReference<Throwable?>()
    val done = CountDownLatch(1)
    val writer = Thread {
      try {
        repeat(150) { i ->
          manager.addDownloadItem(item("w-$i"))
          manager.removeDownloadItem("w-$i", "Cancel")
        }
      } catch (e: Throwable) {
        failure.compareAndSet(null, e)
      } finally {
        done.countDown()
      }
    }
    val reader = Thread {
      try {
        var i = 0
        while (done.count > 0) manager.findDownloadItem("seed-${i++ % 40}") ?: error("seed item vanished")
      } catch (e: Throwable) {
        failure.compareAndSet(null, e)
      }
    }
    writer.start()
    reader.start()
    writer.join(60_000)
    reader.join(10_000)
    assertNull("no exception while the queue changes: ${failure.get()}", failure.get())
    assertEquals(40, manager.downloadItemQueue.size)
  }

  @Test
  fun retryExistingUsesTheLockedLookup() {
    val host = File("src/main/java/app/absplus/android/services/DownloadServiceHost.kt").readText()
    val retry = host.substring(host.indexOf("fun retryExisting("), host.indexOf("fun remove("))
    assertTrue(retry.contains("queue.findDownloadItem(downloadItemId)"))
    assertFalse("no unlocked queue read in retryExisting", retry.contains("downloadItemQueue"))
  }
}
