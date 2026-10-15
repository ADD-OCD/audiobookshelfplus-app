package app.absplus.android.managers

import android.net.Uri
import app.absplus.android.data.AudioTrack
import app.absplus.android.data.Book
import app.absplus.android.data.BookMetadata
import app.absplus.android.data.DeviceInfo
import app.absplus.android.data.EBookFile
import app.absplus.android.data.FileMetadata
import app.absplus.android.data.LocalFile
import app.absplus.android.data.LocalLibraryItem
import app.absplus.android.data.PlaybackSession
import app.absplus.android.data.Podcast
import app.absplus.android.data.PodcastEpisode
import app.absplus.android.data.PodcastMetadata
import app.absplus.android.device.AppStorage
import app.absplus.android.device.AppVolume
import app.absplus.android.device.StorageTarget
import app.absplus.android.device.VolumeProbe
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StorageMoverTest {
  @get:Rule val temp = TemporaryFolder()

  private val mapper = jacksonObjectMapper()
  private val sdUuid = "79EC-9B33"

  private class FakeProbe(val internal: File, val sdDir: File) : VolumeProbe {
    var sdMounted = true
    var sdWritable = true
    override fun volumes() = listOf(AppVolume("79EC-9B33", sdDir, removable = true, mounted = sdMounted, writable = sdMounted && sdWritable))
    override fun internalFilesDir() = internal
  }

  /** Stores serialized copies, so a reader never shares objects with a writer (like Paper). */
  private inner class MapBook : LocalItemBook {
    val data = ConcurrentHashMap<String, String>()
    override fun read(id: String): LocalLibraryItem? = data[id]?.let { mapper.readValue(it, LocalLibraryItem::class.java) }
    override fun write(item: LocalLibraryItem) {
      data[item.id] = mapper.writeValueAsString(item)
    }
    override fun delete(id: String) {
      data.remove(id)
    }
  }

  private inner class FakeDb : MoverDb {
    val book = MapBook()
    val store = LocalItemStore(book)
    val queued: MutableSet<String> = ConcurrentHashMap.newKeySet()
    val queueFolders = CopyOnWriteArrayList<String>()
    val dirOwnedCalls = AtomicInteger()
    val ownedDirsCalls = AtomicInteger()
    /** Replaces [ownedDirs]' result when set. */
    var ownedSnapshot: Set<String>? = null
    /** Runs once inside dirOwned, between the item read and the queue read. */
    var betweenReads: (() -> Unit)? = null
    var session: PlaybackSession? = null
    var sessionSaves = 0
    /** Runs once, after the read, inside the first getItem call. */
    var afterFirstGet: ((String) -> Unit)? = null
    /** Runs once, before the write, inside the next saveItem call. */
    var beforeSave: ((LocalLibraryItem) -> Unit)? = null

    override fun getItem(id: String): LocalLibraryItem? {
      val item = book.read(id)
      afterFirstGet?.let {
        afterFirstGet = null
        it(id)
      }
      return item
    }

    override fun saveItem(item: LocalLibraryItem) {
      beforeSave?.let {
        beforeSave = null
        it(item)
      }
      store.save(item)
    }

    override fun hasQueuedDownload(libraryItemId: String) = libraryItemId in queued

    private fun itemDirs() = book.data.keys.mapNotNull { book.read(it) }.map { it.absolutePath }.filter { it.isNotEmpty() }.map { norm(File(it)) }

    override fun dirOwned(dir: File): Boolean {
      dirOwnedCalls.incrementAndGet()
      val d = norm(dir)
      val inItems = d in itemDirs()
      betweenReads?.let {
        betweenReads = null
        it()
      }
      return inItems || queueFolders.any { norm(File(it)) == d }
    }

    override fun ownedDirs(): Set<String> {
      ownedDirsCalls.incrementAndGet()
      return ownedSnapshot ?: (itemDirs() + queueFolders.map { norm(File(it)) }).toSet()
    }

    override fun lastSession() = session

    override fun saveLastSession(s: PlaybackSession) {
      sessionSaves++
      session = s
    }

    fun json(id: String) = book.data[id]
  }

  private lateinit var probe: FakeProbe
  private lateinit var db: FakeDb
  private lateinit var inRoot: File
  private lateinit var sdRoot: File

  @Before
  fun setUp() {
    probe = FakeProbe(temp.newFolder("internal"), temp.newFolder("sd"))
    inRoot = File(probe.internal, "downloads").apply { mkdirs() }
    sdRoot = File(probe.sdDir, "downloads").apply { mkdirs() }
    db = FakeDb()
  }

  @After
  fun tearDown() {
    LocalItemLocks.clearPlaybackPin()
  }

  private fun norm(f: File) = AppStorage.normalizedPath(f)

  private fun uniq() = "li_" + UUID.randomUUID().toString().take(8)

  private fun sdFolder(mediaType: String) = AppStorage.folderFor(StorageTarget.Sd(sdUuid), mediaType)

  private fun write(dir: File, name: String, size: Int): File =
          File(dir, name).apply { writeBytes(ByteArray(size) { (it % 251).toByte() }) }

  private fun localFile(f: File) =
          LocalFile("lf-${f.name}", f.name, Uri.fromFile(f).toString(), "Internal/${f.parentFile!!.name}", f.absolutePath, "audio/mpeg", f.length())

  private fun track(index: Int, lf: LocalFile) =
          AudioTrack(
                  index, 0.0, 10.0, lf.filename!!, lf.contentUrl, "audio/mpeg",
                  FileMetadata(lf.filename!!, "mp3", lf.absolutePath, lf.basePath, lf.size), true, lf.id, index
          )

  private fun bookMeta() =
          BookMetadata("Book", null, null, null, mutableListOf(), null, null, null, null, null, null, null, false, null, null, null, null, null)

  private fun item(libId: String, dir: File, folderId: String, mediaType: String, media: app.absplus.android.data.MediaType, files: List<LocalFile>, cover: LocalFile?) =
          LocalLibraryItem(
                  "local_$libId", folderId, dir.absolutePath, dir.absolutePath, "", false, mediaType, media,
                  files.toMutableList(), cover?.contentUrl, cover?.absolutePath, true, "server", "addr", "user", libId
          )

  private fun bookItem(libId: String = uniq()): LocalLibraryItem {
    val dir = File(inRoot, libId).apply { mkdirs() }
    val files = listOf(write(dir, "01 Chapter.mp3", 1000), write(dir, "02 Глава é.mp3", 1500), write(dir, "book.epub", 300), write(dir, "cover.jpg", 50)).map { localFile(it) }
    val ebook = EBookFile("ino", FileMetadata("book.epub", "epub", "/server/Book/book.epub", "book.epub", 300), "epub", true, files[2].id, files[2].contentUrl)
    val media = Book(bookMeta(), null, listOf(), null, null, mutableListOf(track(1, files[0]), track(2, files[1])), ebook, null, null, null)
    return item(libId, dir, "internal-book", "book", media, files, files[3])
  }

  private fun episode(lf: LocalFile, n: Int) =
          PodcastEpisode("local_ep_$n-${lf.id}", n, null, null, "Episode $n", null, null, null, null, null, track(n, lf), null, 10.0, lf.size, "ep$n", null)

  private fun podcastItem(libId: String = uniq()): LocalLibraryItem {
    val dir = File(inRoot, libId).apply { mkdirs() }
    val files = listOf(write(dir, "ep 1.mp3", 800), write(dir, "ép 2.mp3", 900), write(dir, "cover.jpg", 40)).map { localFile(it) }
    val media =
            Podcast(PodcastMetadata("Podcast", null, null, mutableListOf(), false), null, mutableListOf(),
                    mutableListOf(episode(files[0], 1), episode(files[1], 2)), false, 2)
    return item(libId, dir, "internal-podcast", "podcast", media, files, files[2])
  }

  /** Adds a downloaded episode file to the item's folder and the item. */
  private fun addEpisode(item: LocalLibraryItem, n: Int) {
    val lf = localFile(write(File(item.absolutePath), "new $n.mp3", 700))
    item.localFiles.add(lf)
    (item.media as Podcast).episodes!!.add(episode(lf, n))
  }

  private fun seed(item: LocalLibraryItem): LocalLibraryItem {
    db.store.save(item)
    return item
  }

  private fun episodes(item: LocalLibraryItem) = (item.media as Podcast).episodes!!

  private fun tracks(item: LocalLibraryItem) = item.media.getAudioTracks()

  /** Every path field relocate rewrites. */
  private fun paths(item: LocalLibraryItem): List<String> {
    val out = mutableListOf(item.absolutePath, item.basePath)
    item.coverAbsolutePath?.let { out.add(it) }
    item.coverContentUrl?.let { out.add(it) }
    item.localFiles.forEach {
      out.add(it.absolutePath)
      out.add(it.contentUrl)
    }
    tracks(item).forEach {
      out.add(it.contentUrl)
      out.add(it.metadata!!.path)
    }
    (item.media as? Book)?.ebookFile?.contentUrl?.let { out.add(it) }
    return out
  }

  private fun treeOf(dir: File): Map<String, Long> =
          dir.walkTopDown().filter { it.isFile }.associate { it.relativeTo(dir).path to it.length() }

  private fun noTmp() = assertTrue("no move copy is left", sdRoot.listFiles()!!.none { it.name.startsWith(".moving-") })

  private fun assertMovedPaths(moved: LocalLibraryItem, libId: String) {
    val dest = File(sdRoot, libId)
    paths(moved).forEach {
      assertFalse("$it still points at the old root", it.contains(inRoot.absolutePath))
      assertTrue("$it points at the new root", it.contains(sdRoot.absolutePath))
    }
    moved.localFiles.forEach {
      assertEquals(File(dest, it.filename!!).absolutePath, it.absolutePath)
      assertEquals(Uri.fromFile(File(dest, it.filename!!)).toString(), it.contentUrl)
    }
  }

  @Test
  fun relocateRewritesAllPaths() {
    val libId = uniq()
    val book = bookItem(libId)
    val saf = LocalFile("saf", "x.mp3", "content://com.android.externalstorage.documents/document/primary%3AX%2Fx.mp3", "", "/storage/emulated/0/X/x.mp3", "audio/mpeg", 5)
    book.localFiles.add(saf)
    val before = mapper.writeValueAsString(book)
    val moved = StorageMover.relocate(book, inRoot, sdRoot, sdFolder("book"))

    assertEquals("the input is not changed", before, mapper.writeValueAsString(book))
    assertEquals(sdFolder("book").id, moved.folderId)
    assertEquals(File(sdRoot, libId).absolutePath, moved.absolutePath)
    assertEquals(File(sdRoot, libId).absolutePath, moved.basePath)
    assertEquals("", moved.contentUrl)
    val movedSaf = moved.localFiles.last()
    assertEquals("a path outside the old root stays", saf, movedSaf)
    moved.localFiles.removeAt(moved.localFiles.size - 1)
    assertMovedPaths(moved, libId)
    assertEquals(Uri.fromFile(File(sdRoot, "$libId/02 Глава é.mp3")).toString(), tracks(moved)[1].contentUrl)
    assertTrue("non-ASCII names are percent-encoded like Uri.fromFile", tracks(moved)[1].contentUrl.contains("%"))
    assertEquals(File(sdRoot, "$libId/02 Глава é.mp3").absolutePath, tracks(moved)[1].metadata!!.path)
    assertEquals(Uri.fromFile(File(sdRoot, "$libId/book.epub")).toString(), (moved.media as Book).ebookFile!!.contentUrl)
    assertEquals(File(sdRoot, "$libId/cover.jpg").absolutePath, moved.coverAbsolutePath)
    assertEquals(Uri.fromFile(File(sdRoot, "$libId/cover.jpg")).toString(), moved.coverContentUrl)
    assertEquals(book.id, moved.id)
    assertEquals(book.localFiles.dropLast(1).map { it.id }, moved.localFiles.map { it.id })
    assertEquals(tracks(book).map { it.localFileId }, tracks(moved).map { it.localFileId })
    assertEquals(tracks(book).map { it.metadata!!.relPath }, tracks(moved).map { it.metadata!!.relPath })
    assertEquals(book.localFiles.map { it.basePath }.dropLast(1), moved.localFiles.map { it.basePath })

    val podId = uniq()
    val pod = podcastItem(podId)
    val podBefore = mapper.writeValueAsString(pod)
    val movedPod = StorageMover.relocate(pod, inRoot, sdRoot, sdFolder("podcast"))
    assertEquals(podBefore, mapper.writeValueAsString(pod))
    assertTrue("still a podcast", movedPod.media is Podcast)
    assertEquals(sdFolder("podcast").id, movedPod.folderId)
    assertMovedPaths(movedPod, podId)
    assertEquals(episodes(pod).map { it.id }, episodes(movedPod).map { it.id })
    assertEquals(tracks(pod).map { it.localFileId }, tracks(movedPod).map { it.localFileId })
    assertEquals(Uri.fromFile(File(sdRoot, "$podId/ép 2.mp3")).toString(), episodes(movedPod)[1].audioTrack!!.contentUrl)
  }

  @Test
  fun movesFilesAndDb() {
    val item = seed(bookItem())
    val libId = item.libraryItemId!!
    val tree = treeOf(File(item.absolutePath))

    assertEquals(MoveResult.Moved, StorageMover.moveOne(item.id, sdFolder("book"), probe, db))

    assertEquals(tree, treeOf(File(sdRoot, libId)))
    assertFalse(File(inRoot, libId).exists())
    noTmp()
    val saved = db.getItem(item.id)!!
    assertEquals(mapper.writeValueAsString(StorageMover.relocate(item, inRoot, sdRoot, sdFolder("book"))), mapper.writeValueAsString(saved))
  }

  @Test
  fun folderNamedDotDotIsNotMoved() {
    val item = seed(bookItem().apply { absolutePath = File(inRoot, "..").path })
    val sentinel = write(probe.sdDir, "keep.bin", 10)

    assertTrue(StorageMover.moveOne(item.id, sdFolder("book"), probe, db) is MoveResult.Failed)
    assertTrue("the SD card's app folder is untouched", sentinel.isFile)
    assertTrue("internal storage is untouched", inRoot.isDirectory)
  }

  @Test
  fun discardWhenEpisodeSavedDuringCopy() {
    val item = seed(podcastItem())
    val result =
            StorageMover.moveOne(item.id, sdFolder("podcast"), probe, db) { s, d ->
              StorageMover.copyDirVerified(s, d)
              val updated = db.getItem(item.id)!!
              addEpisode(updated, 3)
              db.saveItem(updated)
            }

    assertEquals(MoveResult.Discarded("changed during copy"), result)
    val saved = db.getItem(item.id)!!
    assertEquals("the episode saved during the copy is kept", 3, episodes(saved).size)
    assertEquals(item.absolutePath, saved.absolutePath)
    assertEquals(item.folderId, saved.folderId)
    assertTrue("the source keeps the new episode file", File(item.absolutePath, "new 3.mp3").isFile)
    assertTrue(File(item.absolutePath, "ep 1.mp3").isFile)
    assertFalse(File(sdRoot, item.libraryItemId!!).exists())
    noTmp()
  }

  @Test
  fun snapshotTakenUnderLock() {
    val item = seed(podcastItem())
    val plan = StorageMovePlanner.plan(listOf(db.getItem(item.id)!!), listOf(), StorageTarget.Sd(sdUuid), probe, { false }) { Long.MAX_VALUE / 2 }
    assertEquals(1, plan.toMove.size)
    db.store.update(item.id) {
      addEpisode(it, 3)
      ItemUpdate.Save(it)
    }
    assertEquals(MoveResult.Moved, StorageMover.moveOne(item.id, sdFolder("podcast"), probe, db))
    val moved = db.getItem(item.id)!!
    assertEquals("an episode saved after planning moves too", 3, episodes(moved).size)
    assertMovedPaths(moved, item.libraryItemId!!)
    assertTrue(File(sdRoot, "${item.libraryItemId}/new 3.mp3").isFile)

    // A write started right after the snapshot read must wait for the version read, or the move would drop it
    val raced = seed(podcastItem())
    val writer = AtomicReference<Thread>()
    db.afterFirstGet = { id ->
      val t = Thread {
        db.store.update(id) {
          addEpisode(it, 3)
          ItemUpdate.Save(it)
        }
      }
      writer.set(t)
      t.start()
      t.join(300)
    }
    val result = StorageMover.moveOne(raced.id, sdFolder("podcast"), probe, db)
    writer.get().join(5000)

    val after = db.getItem(raced.id)!!
    assertEquals("the racing episode is not lost ($result)", 3, episodes(after).size)
    if (result == MoveResult.Moved) assertMovedPaths(after, raced.libraryItemId!!)
    else assertEquals(raced.absolutePath, after.absolutePath)
    noTmp()
  }

  @Test
  fun discardWhenPinned() {
    val item = seed(bookItem())
    val before = db.json(item.id)
    val tree = treeOf(File(item.absolutePath))
    val result =
            StorageMover.moveOne(item.id, sdFolder("book"), probe, db) { s, d ->
              StorageMover.copyDirVerified(s, d)
              LocalItemLocks.pinForPlayback(item.id)
            }
    assertEquals(MoveResult.Discarded("playing"), result)
    noTmp()
    assertEquals(tree, treeOf(File(item.absolutePath)))
    assertEquals(before, db.json(item.id))
    assertFalse(File(sdRoot, item.libraryItemId!!).exists())

    val copies = AtomicInteger()
    val result2 = StorageMover.moveOne(item.id, sdFolder("book"), probe, db) { _, _ -> copies.incrementAndGet() }
    assertEquals(MoveResult.Discarded("playing"), result2)
    assertEquals("a pinned item is not copied", 0, copies.get())
  }

  @Test
  fun discardWhenQueued() {
    val item = seed(bookItem())
    val before = db.json(item.id)
    val tree = treeOf(File(item.absolutePath))
    val result =
            StorageMover.moveOne(item.id, sdFolder("book"), probe, db) { s, d ->
              StorageMover.copyDirVerified(s, d)
              db.queued.add(item.libraryItemId!!)
            }
    assertEquals(MoveResult.Discarded("downloading"), result)
    noTmp()
    assertEquals(tree, treeOf(File(item.absolutePath)))
    assertEquals(before, db.json(item.id))

    val copies = AtomicInteger()
    val result2 = StorageMover.moveOne(item.id, sdFolder("book"), probe, db) { _, _ -> copies.incrementAndGet() }
    assertEquals(MoveResult.Discarded("downloading"), result2)
    assertEquals("a queued item is not copied", 0, copies.get())
  }

  @Test
  fun enqueueDuringFinalStepSeesNewFolder() {
    val item = seed(bookItem())
    val seen = AtomicReference<String>()
    var readerDoneWhileSaving = true
    lateinit var reader: Thread
    db.beforeSave = {
      reader = Thread { seen.set(LocalItemLocks.withItem(item.id) { db.getItem(item.id)!!.folderId }) }
      reader.start()
      reader.join(100)
      readerDoneWhileSaving = !reader.isAlive
    }
    assertEquals(MoveResult.Moved, StorageMover.moveOne(item.id, sdFolder("book"), probe, db))
    reader.join(5000)
    assertFalse("a reader waits for the final step to finish", readerDoneWhileSaving)
    assertEquals(sdFolder("book").id, seen.get())
  }

  @Test
  fun copyFailureLeavesSourceIntact() {
    val item = seed(bookItem())
    val before = db.json(item.id)
    val tree = treeOf(File(item.absolutePath))
    val result =
            StorageMover.moveOne(item.id, sdFolder("book"), probe, db) { s, d ->
              d.mkdirs()
              s.listFiles()!!.first().copyTo(File(d, "partial"))
              throw IOException("disk full")
            }
    assertTrue(result is MoveResult.Failed)
    assertTrue((result as MoveResult.Failed).message.contains("disk full"))
    noTmp()
    assertEquals(tree, treeOf(File(item.absolutePath)))
    assertEquals(before, db.json(item.id))
  }

  @Test
  fun sizeMismatchFails() {
    val item = seed(bookItem())
    val before = db.json(item.id)
    val tree = treeOf(File(item.absolutePath))
    val shortCopy: (File, File) -> Unit = { s, d -> d.writeBytes(s.readBytes().copyOf((s.length() - 3).toInt())) }
    val result = StorageMover.moveOne(item.id, sdFolder("book"), probe, db) { s, d -> StorageMover.copyDirVerified(s, d, shortCopy) }
    assertTrue(result is MoveResult.Failed)
    noTmp()
    assertEquals(tree, treeOf(File(item.absolutePath)))
    assertEquals(before, db.json(item.id))
    assertFalse(File(sdRoot, item.libraryItemId!!).exists())
  }

  @Test
  fun crashAfterRenameBeforeDbWrite() {
    val item = seed(bookItem())
    val libId = item.libraryItemId!!
    val tree = treeOf(File(item.absolutePath))
    File(sdRoot, libId).mkdirs()
    write(File(sdRoot, libId), "junk.bin", 10)

    StorageMover.cleanOrphans(listOf(inRoot, sdRoot), db)
    assertTrue("the source is owned and stays", File(item.absolutePath).isDirectory)
    assertEquals(MoveResult.Moved, StorageMover.moveOne(item.id, sdFolder("book"), probe, db))
    assertEquals(tree, treeOf(File(sdRoot, libId)))

    val other = seed(bookItem())
    val otherId = other.libraryItemId!!
    val otherTree = treeOf(File(other.absolutePath))
    write(File(sdRoot, otherId).apply { mkdirs() }, "junk.bin", 10)
    assertEquals(MoveResult.Moved, StorageMover.moveOne(other.id, sdFolder("book"), probe, db))
    assertEquals("an unowned leftover at the destination is replaced", otherTree, treeOf(File(sdRoot, otherId)))
  }

  @Test
  fun crashAfterDbWriteBeforeSourceDelete() {
    val item = seed(bookItem())
    val libId = item.libraryItemId!!
    val tree = treeOf(File(item.absolutePath))
    StorageMover.copyDirVerified(File(item.absolutePath), File(sdRoot, libId))
    db.saveItem(StorageMover.relocate(item, inRoot, sdRoot, sdFolder("book")))

    StorageMover.cleanOrphans(listOf(inRoot, sdRoot), db)

    assertFalse("the old source is an orphan", File(inRoot, libId).exists())
    assertEquals(tree, treeOf(File(sdRoot, libId)))
  }

  @Test
  fun crashBeforeSessionHeal() {
    val item = bookItem()
    val moved = StorageMover.relocate(item, inRoot, sdRoot, sdFolder("book"))
    seed(moved)
    val sessionTracks = tracks(item).map { it.copy(metadata = it.metadata!!.copy()) }.toMutableList()
    db.session =
            PlaybackSession(
                    "s1", "user", item.libraryItemId, null, "book", item.media.metadata, DeviceInfo("d", "m", "m", 35, "1"),
                    listOf(), "Book", "Author", null, 20.0, 3, 0L, 0L, 0L, sessionTracks, 5.0, null, item, null, "server", "addr", "exo-player"
            )

    StorageMover.healLastSession(db)

    val s = db.session!!
    assertEquals(1, db.sessionSaves)
    assertEquals(moved.absolutePath, s.localLibraryItem!!.absolutePath)
    assertEquals(moved.folderId, s.localLibraryItem!!.folderId)
    assertEquals(tracks(moved).map { it.contentUrl }, s.audioTracks.map { it.contentUrl })
    assertEquals(tracks(moved).map { it.metadata!!.path }, s.audioTracks.map { it.metadata!!.path })
    assertEquals(5.0, s.currentTime, 0.0)

    StorageMover.healLastSession(db)
    assertEquals("a healed session is not written again", 1, db.sessionSaves)
  }

  @Test
  fun orphansRespectOwnership() {
    val failedDownload = File(sdRoot, "li_failed").apply { mkdirs() }
    write(failedDownload, "part.mp3", 10)
    db.queueFolders.add(failedDownload.absolutePath)
    val owned = seed(bookItem())
    val nobody = File(inRoot, "li_nobody").apply { mkdirs() }
    write(nobody, "a.mp3", 10)
    val moving = File(inRoot, ".moving-x").apply { mkdirs() }
    write(moving, "a.mp3", 10)
    val rootFile = write(inRoot, "stray.bin", 10)

    StorageMover.cleanOrphans(listOf(inRoot, sdRoot, File(temp.root, "missing/downloads")), db)

    assertTrue("a failed download's folder stays", File(failedDownload, "part.mp3").isFile)
    assertTrue("another item's folder stays", File(owned.absolutePath).isDirectory)
    assertNotNull(File(owned.absolutePath).listFiles()?.firstOrNull())
    assertFalse("a folder nobody owns is deleted", nobody.exists())
    assertFalse("a move copy is deleted", moving.exists())
    assertTrue("files in the root stay", rootFile.isFile)
  }

  @Test
  fun orphanCleanupReadsOwnershipOnce() {
    val owned = List(3) { seed(bookItem()) }
    val nobody = File(sdRoot, "li_nobody").apply { mkdirs() }

    StorageMover.cleanOrphans(listOf(inRoot, sdRoot), db)

    assertEquals("one ownership snapshot per cleanup", 1, db.ownedDirsCalls.get())
    assertEquals("only the folder missing from the snapshot is rechecked", 1, db.dirOwnedCalls.get())
    owned.forEach { assertTrue(File(it.absolutePath).isDirectory) }
    assertFalse(nobody.exists())
  }

  @Test
  fun orphanCleanupWaitsForAFinishingDownload() {
    val libId = "li_race"
    val dir = File(sdRoot, libId).apply { mkdirs() }
    write(dir, "01.mp3", 10)
    db.queueFolders.add(dir.absolutePath)
    // A snapshot without the folder, so the decision falls to the locked recheck
    db.ownedSnapshot = emptySet()
    val finisher = AtomicReference<Thread>()
    db.betweenReads = {
      // Like a finishing download: save the item under its lock, then drop the queue entry
      val t = Thread {
        val media = Book(bookMeta(), null, listOf(), null, null, mutableListOf(), null, null, null, null)
        LocalItemLocks.withItem("local_$libId") { db.saveItem(item(libId, dir, sdFolder("book").id, "book", media, listOf(), null)) }
        db.queueFolders.remove(dir.absolutePath)
      }
      finisher.set(t)
      t.start()
      t.join(400)
    }

    StorageMover.cleanOrphans(listOf(inRoot, sdRoot), db)
    finisher.get().join(5000)

    assertFalse("the download finished", finisher.get().isAlive)
    assertNotNull(db.getItem("local_$libId"))
    assertTrue("a download finishing during cleanup keeps its folder", File(dir, "01.mp3").isFile)
  }

  private fun assertCopyFailsWhileUnreadable(src: File, unreadable: File) {
    assertTrue(unreadable.setReadable(false))
    try {
      assumeTrue("this file system lists directories without read permission", unreadable.listFiles() == null)
      try {
        StorageMover.copyDirVerified(src, File(temp.root, "dst-" + uniq()))
        fail("a copy that could not list ${unreadable.name} passed as complete")
      } catch (e: IOException) {
        assertTrue(e.message, e.message!!.contains("could not list"))
      }
    } finally {
      unreadable.setReadable(true)
    }
  }

  @Test
  fun unreadableSourceFailsTheCopy() {
    val src = File(temp.root, "src").apply { mkdirs() }
    write(src, "a.mp3", 10)
    val sub = File(src, "sub").apply { mkdirs() }
    write(sub, "b.mp3", 10)

    assertCopyFailsWhileUnreadable(src, src)
    assertCopyFailsWhileUnreadable(src, sub)
  }

  @Test
  fun unreadableSourceFailsTheMove() {
    val item = seed(bookItem())
    val src = File(item.absolutePath)
    val before = db.json(item.id)
    val tree = treeOf(src)
    assertTrue(src.setReadable(false))
    val result =
            try {
              assumeTrue("this file system lists directories without read permission", src.listFiles() == null)
              StorageMover.moveOne(item.id, sdFolder("book"), probe, db)
            } finally {
              src.setReadable(true)
            }

    assertTrue("$result", result is MoveResult.Failed)
    assertEquals(tree, treeOf(src))
    assertEquals("the database still points at the source", before, db.json(item.id))
    assertFalse(File(sdRoot, item.libraryItemId!!).exists())
    noTmp()
  }
}
