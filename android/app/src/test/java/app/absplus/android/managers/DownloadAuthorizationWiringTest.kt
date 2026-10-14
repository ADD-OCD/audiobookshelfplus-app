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
import java.net.InetAddress
import java.net.ServerSocket
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowStatFs

/**
 * Promoted from Claude’s H04 integration review (2026-10-14): drives the real DownloadItemManager entry points that
 * Codex's DownloadControlsTest does not reach (resumeWork -> checkUpdateDownloadQueue -> startDownload,
 * a held item surviving persistence and a second restore, reconnect-then-retry, token rotation, re-added
 * server under a new config id). Synthetic configs only; the owner address is 127.0.0.1:1 so a transfer
 * that does start is refused locally.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DownloadAuthorizationWiringTest {
  private lateinit var context: Context
  private lateinit var root: File
  private lateinit var previousServers: MutableList<ServerConnectionConfig>
  private var previousActive: ServerConnectionConfig? = null
  private val owner = "http://127.0.0.1:1"
  private val hold = "Download authorization changed: reconnect the original server before retrying"
  private val managers = mutableListOf<DownloadItemManager>()

  private val emitter = object : DownloadItemManager.DownloadEventEmitter {
    override fun onDownloadItem(downloadItem: DownloadItem) {}
    override fun onDownloadItemPartUpdate(downloadItemPart: DownloadItemPart) {}
    override fun onDownloadItemComplete(jsobj: JSObject) {}
    override fun onQueueChanged(hasWork: Boolean) {}
  }

  private fun config(id: String = "A", address: String = owner, user: String = "alice", token: String = "synthetic-A") =
          ServerConnectionConfig(id, 0, "Synthetic $id", address, null, user, "synthetic", token, null)

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    Paper.init(context)
    Paper.book("downloadItems").destroy()
    Paper.book("localLibraryItems").destroy()
    previousServers = DeviceManager.deviceData.serverConnectionConfigs
    previousActive = DeviceManager.serverConnectionConfig
    try {
      WorkManager.initialize(context, Configuration.Builder().setExecutor { it.run() }.build())
    } catch (e: IllegalStateException) {
      // Already initialized by an earlier test in this process
    }
    root = File(context.cacheDir, "auth-wiring").apply { deleteRecursively(); mkdirs() }
  }

  @After
  fun tearDown() {
    // Also stop a deliberately broken mutant's transfer when an assertion fails mid-test.
    managers.forEach { manager ->
      manager.downloadItemQueue.map { it.id }.forEach { manager.removeDownloadItem(it, "test cleanup") }
    }
    DeviceManager.deviceData.serverConnectionConfigs = previousServers
    DeviceManager.serverConnectionConfig = previousActive
  }

  private fun part(itemId: String, name: String, bytes: Long = 0) = DownloadItemPart(
          id = "part-$itemId-$name", downloadItemId = itemId, filename = name, fileSize = 10,
          destinationPath = File(root, "staging/$itemId/$name.part").path,
          finalDestinationPath = File(root, "final/$itemId/$name").path,
          serverPath = "/api/items/$itemId/file/$name/download",
          localFolderName = "Internal App Storage", localFolderUrl = "", localFolderId = "internal-book",
          ebookFile = null, audioTrack = null, episode = null, completed = false, moved = false, isMoving = false,
          failed = false, uri = Uri.parse("$owner/x"), destinationUri = Uri.parse("file:///s/$name"),
          finalDestinationUri = Uri.parse("file:///f/$name"), completedDestinationUri = null,
          finalDestinationSubfolder = "Author/Book", downloadId = null, lastUpdateTime = null, progress = 0,
          bytesDownloaded = bytes)

  private fun item(id: String, vararg parts: DownloadItemPart) = DownloadItem(
          id = id, libraryItemId = id, episodeId = null, userMediaProgress = null,
          serverConnectionConfigId = "A", serverAddress = owner, serverUserId = "alice", mediaType = "book",
          itemFolderPath = File(root, "final/$id").path,
          localFolder = LocalFolder("internal-book", "Internal App Storage", "", "", "", "internal", "book"),
          itemTitle = "Title $id", itemSubfolder = "Author/Book",
          media = MediaType(MediaTypeMetadata("Title $id", false), null), downloadItemParts = parts.toMutableList())

  private fun manager() = DownloadItemManager(FolderScanner(context), context, emitter).also { managers.add(it) }

  /** Robolectric reports 0 free bytes unless told otherwise; give the staging folder room so tryReserve passes. */
  private fun room(p: DownloadItemPart) {
    val dir = File(p.destinationPath).parentFile!!.apply { mkdirs() }
    ShadowStatFs.registerStats(dir.absolutePath, 1_000_000, 900_000, 900_000)
  }

  private fun staged(p: DownloadItemPart, size: Int) =
          File(p.destinationPath).apply { parentFile?.mkdirs(); writeBytes(ByteArray(size) { 7 }) }

  /** A fresh download queued for A must not start with the active server B's token (the original H04 leak). */
  @Test
  fun newQueuedDownloadIsHeldWhenOnlyAnotherServerIsAvailable() {
    val b = config(id = "B", address = "http://127.0.0.1:2", user = "bob", token = "synthetic-B")
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(b)
    DeviceManager.serverConnectionConfig = b
    val p = part("q", "01.mp3").also { room(it) }
    val m = manager()
    m.addDownloadItem(item("q", p))
    m.resumeWork()
    val queued = m.downloadItemQueue.single().downloadItemParts.single()
    assertFalse(queued.waitingForSpace)
    assertTrue(queued.failed)
    assertEquals(hold, queued.failureReason)
    assertNull(queued.downloadId)
    assertTrue(m.currentDownloadItemParts.isEmpty())
    assertNull(m.downloadItemQueue.single().terminalFailureAt)
    assertEquals(1, DeviceManager.dbManager.getDownloadItems().size)
  }

  /** Positive control: the same queue with its own owner saved starts normally (the guard is not a blanket block). */
  @Test
  fun newQueuedDownloadStartsForItsOwner() {
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(config())
    DeviceManager.serverConnectionConfig = DeviceManager.deviceData.serverConnectionConfigs.single()
    val m = manager()
    val p = part("ok", "01.mp3").also { room(it) }
    m.addDownloadItem(item("ok", p))
    m.resumeWork()
    // reached startDownload with a token: the part became an active transfer (not a hold, not waiting for space)
    assertFalse(p.waitingForSpace)
    assertNotEquals(hold, p.failureReason)
    assertTrue(p.downloadId == -1L || p.failed)
    m.removeDownloadItem("ok", "test cleanup")
  }

  /** Held state survives persistence (PR #25 compact read path) and a second restore; partial bytes stay. */
  @Test
  fun heldItemSurvivesPersistenceAndSecondRestoreThenRetriesAfterReconnect() {
    val p = part("h", "01.mp3", bytes = 6)
    staged(p, 6)
    DeviceManager.dbManager.saveDownloadItem(item("h", p))
    // same saved config id, different account
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(config(user = "mallory"))
    manager().restoreQueue()
    // second "process": a fresh manager reads what the first one persisted
    val second = manager()
    second.restoreQueue()
    val held = second.downloadItemQueue.single()
    assertTrue(held.downloadItemParts.single().failed)
    assertEquals(hold, held.downloadItemParts.single().failureReason)
    assertEquals(6L, held.downloadItemParts.single().bytesDownloaded)
    assertEquals(6L, File(p.destinationPath).length())
    assertNull(held.terminalFailureAt)
    assertFalse(second.retryDownloadItem("h"))
    assertEquals(6L, File(p.destinationPath).length())
    // reconnect the original account on the same saved config -> retry is accepted
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(config())
    assertTrue(second.retryDownloadItem("h"))
    assertFalse(second.downloadItemQueue.single().downloadItemParts.single().failed)
    second.removeDownloadItem("h", "test cleanup")
  }

  /** Same-owner token rotation (TokenRefresher updates the saved config) keeps restore on the normal path. */
  @Test
  fun rotatedTokenForSameOwnerIsNotHeld() {
    val p = part("r", "01.mp3", bytes = 3)
    staged(p, 3)
    DeviceManager.dbManager.saveDownloadItem(item("r", p))
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(config(token = "synthetic-A-rotated"))
    val m = manager()
    m.restoreQueue()
    val restored = m.downloadItemQueue.single().downloadItemParts.single()
    assertNotEquals(hold, restored.failureReason)
    assertFalse(restored.failed)
    m.removeDownloadItem("r", "test cleanup")
  }

  /** The same server saved again under a new config id does not silently rebind an old queue. */
  @Test
  fun reAddedServerUnderDifferentIdDoesNotRebind() {
    val p = part("x", "01.mp3", bytes = 2)
    staged(p, 2)
    DeviceManager.dbManager.saveDownloadItem(item("x", p))
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(config(id = "A2"))
    val m = manager()
    m.restoreQueue()
    assertEquals(hold, m.downloadItemQueue.single().downloadItemParts.single().failureReason)
    assertEquals(2L, File(p.destinationPath).length())
  }

  /** Observe the real startDownload header after a server switch and same-owner token renewal. */
  @Test
  fun activeOtherServerCannotReplaceTheSavedOwnersRenewedTokenAtLaunch() {
    ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
      server.soTimeout = 5000
      val address = "http://127.0.0.1:${server.localPort}"
      val a = config(address = address, token = "synthetic-A-before-renewal")
      val b = config(id = "B", address = "http://127.0.0.1:2", user = "bob", token = "synthetic-B")
      DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(a, b)
      DeviceManager.serverConnectionConfig = b
      val p = part("switch", "01.mp3").also { room(it) }
      val m = manager()
      m.addDownloadItem(item("switch", p).copy(serverAddress = address))
      a.token = "synthetic-A-renewed"
      try {
        m.resumeWork()
        server.accept().use { socket ->
          socket.soTimeout = 5000
          val reader = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
          assertTrue(reader.readLine().startsWith("GET /api/items/switch/"))
          val headers = mutableMapOf<String, String>()
          var bytes = 0
          while (true) {
            val line = reader.readLine() ?: error("Incomplete request")
            bytes += line.length
            require(bytes < 16 * 1024)
            if (line.isEmpty()) break
            headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
          }
          assertEquals("Bearer synthetic-A-renewed", headers["authorization"])
          // Cancel while the fixture still owns the connection; no real content or server used.
          m.removeDownloadItem("switch", "test cleanup")
        }
      } finally { m.removeDownloadItem("switch", "test cleanup") }
    }
  }

  @Test
  fun legacyAddressSpellingsWorkThroughTheManagersActualUrlConstruction() {
    val method = DownloadItemManager::class.java.getDeclaredMethod(
            "downloadToken", DownloadItemPart::class.java, DownloadItem::class.java)
    method.isAccessible = true
    val m = manager()
    for (address in listOf("http://abs_server:13378", "https://bücher.example",
            "https://a.invalid/abs path", "https://a.invalid/abs?tenant=home office")) {
      DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(config(address = address))
      for (serverPath in listOf("/api/items/book/file/one/download", "/api/items/book/cover")) {
        val p = part("book", "test").copy(serverPath = serverPath)
        assertEquals(address, "synthetic-A", method.invoke(m, p, item("book", p).copy(serverAddress = address)))
      }
    }
  }
}
