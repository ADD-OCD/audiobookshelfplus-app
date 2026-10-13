package app.absplus.android.managers

import android.net.Uri
import app.absplus.android.data.Book
import app.absplus.android.data.LocalFolder
import app.absplus.android.data.LocalLibraryItem
import app.absplus.android.data.PlaybackSession
import app.absplus.android.data.Podcast
import app.absplus.android.device.AppStorage
import app.absplus.android.device.VolumeProbe
import app.absplus.android.plugins.AbsLogger
import com.fasterxml.jackson.core.json.JsonReadFeature
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.io.File
import java.io.IOException

/** What [StorageMover] needs from the databases. */
interface MoverDb {
  fun getItem(id: String): LocalLibraryItem?
  /** Must take the item's [LocalItemLocks] lock and bump its version. */
  fun saveItem(item: LocalLibraryItem)
  fun hasQueuedDownload(libraryItemId: String): Boolean
  /** True when any local library item's absolutePath or any download's itemFolderPath (in any state) is [dir]. */
  fun dirOwned(dir: File): Boolean
  /** [AppStorage.normalizedPath]s of every directory [dirOwned] would accept, read as one snapshot. */
  fun ownedDirs(): Set<String>
  fun lastSession(): PlaybackSession?
  fun saveLastSession(s: PlaybackSession)
}

sealed class MoveResult {
  object Moved : MoveResult()
  data class Discarded(val reason: String) : MoveResult()
  data class Failed(val message: String) : MoveResult()
}

/**
 * Moves one app-storage download to another app storage: copy without the item lock, then commit
 * under the lock only if the item did not change meanwhile. The source stays untouched until the
 * database points at the copy.
 */
object StorageMover {
  private const val TAG = "StorageMover"
  private const val TMP_PREFIX = ".moving-"

  private class Snapshot(val item: LocalLibraryItem, val version: Long)

  private val mapper = jacksonObjectMapper().enable(JsonReadFeature.ALLOW_UNESCAPED_CONTROL_CHARS.mappedFeature())

  /** A copy of [item] with every path under [fromRoot] re-pointed to [toRoot]; [item] is not changed. */
  fun relocate(item: LocalLibraryItem, fromRoot: File, toRoot: File, toFolder: LocalFolder): LocalLibraryItem {
    val copy = mapper.readValue(mapper.writeValueAsString(item), LocalLibraryItem::class.java)
    val outside = mutableListOf<String>()

    fun path(p: String?): String? {
      if (p.isNullOrEmpty()) return p
      val moved = movedFile(File(p), fromRoot, toRoot)
      if (moved == null) outside.add(p)
      return moved?.absolutePath ?: p
    }

    fun url(u: String?): String? {
      if (u.isNullOrEmpty()) return u
      val filePath = if (u.startsWith("file:")) Uri.parse(u).path else null
      val moved = filePath?.let { movedFile(File(it), fromRoot, toRoot) }
      if (moved == null) outside.add(u)
      return moved?.let { Uri.fromFile(it).toString() } ?: u
    }

    copy.folderId = toFolder.id
    copy.absolutePath = path(copy.absolutePath)!!
    copy.basePath = path(copy.basePath)!!
    copy.contentUrl = url(copy.contentUrl)!!
    copy.coverAbsolutePath = path(copy.coverAbsolutePath)
    copy.coverContentUrl = url(copy.coverContentUrl)
    copy.localFiles.forEach {
      it.absolutePath = path(it.absolutePath)!!
      it.contentUrl = url(it.contentUrl)!!
    }
    val media = copy.media
    val tracks =
            when (media) {
              is Book -> media.tracks.orEmpty()
              is Podcast -> media.episodes.orEmpty().mapNotNull { it.audioTrack }
              else -> emptyList()
            }
    tracks.forEach { track ->
      track.contentUrl = url(track.contentUrl)!!
      track.metadata?.let { it.path = path(it.path)!! }
    }
    if (media is Book) media.ebookFile?.let { it.contentUrl = url(it.contentUrl) }

    if (outside.isNotEmpty()) {
      AbsLogger.error(TAG, "relocate ${item.id}: ${outside.size} paths outside ${fromRoot.absolutePath} left as they were: $outside")
    }
    return copy
  }

  private fun movedFile(file: File, fromRoot: File, toRoot: File): File? {
    val rel = AppStorage.relativePath(file, fromRoot) ?: return null
    return if (rel.isEmpty()) toRoot else File(toRoot, rel)
  }

  fun moveOne(
          id: String,
          toFolder: LocalFolder,
          probe: VolumeProbe,
          db: MoverDb,
          copier: (File, File) -> Unit = ::copyDirVerified
  ): MoveResult {
    val toRoot = AppStorage.downloadsRoot(toFolder, probe)
    if (toRoot == null || !AppStorage.isAvailable(toFolder, probe)) return MoveResult.Discarded("unavailable")

    // Snapshot, version and checks under one lock, so no write can slip in between them
    var notStarted: MoveResult? = null
    val locked =
            LocalItemLocks.withItem(id) {
              val item = db.getItem(id)
              notStarted =
                      when {
                        item == null -> MoveResult.Discarded("missing")
                        item.libraryItemId?.let { db.hasQueuedDownload(it) } == true -> MoveResult.Discarded("downloading")
                        LocalItemLocks.isPinned(id) -> MoveResult.Discarded("playing")
                        else -> null
                      }
              if (notStarted == null) Snapshot(item!!, LocalItemLocks.version(id)) else null
            }
    if (locked == null) return notStarted!!
    val snapshot = locked.item
    val serverId = snapshot.libraryItemId
    val v = locked.version

    if (!AppStorage.isAppStorage(snapshot.folderId)) return failed("$id is not in app storage")
    if (snapshot.folderId == toFolder.id) return MoveResult.Discarded("already on target")
    val fromRoot = AppStorage.downloadsRoot(snapshot.folderId, probe)
    if (fromRoot == null || !AppStorage.isAvailable(snapshot.folderId, probe)) return MoveResult.Discarded("unavailable")

    val src = File(snapshot.absolutePath)
    if (snapshot.absolutePath.isEmpty() || src.parentFile?.let { AppStorage.normalizedPath(it) } != AppStorage.normalizedPath(fromRoot)) {
      return failed("$id folder ${snapshot.absolutePath} is not directly in ${fromRoot.absolutePath}")
    }
    val name = src.name
    val tmp = File(toRoot, "$TMP_PREFIX$name")

    try {
      if (tmp.exists()) tmp.deleteRecursively()
      copier(src, tmp)
    } catch (e: Exception) {
      tmp.deleteRecursively()
      return LocalItemLocks.withItem(id) {
        if (LocalItemLocks.version(id) != v || db.getItem(id) == null) MoveResult.Discarded("changed during copy")
        else failed("copy of $id failed: ${e.message}")
      }
    }

    val result =
            LocalItemLocks.withItem(id) {
              val discard =
                      when {
                        LocalItemLocks.version(id) != v -> "changed during copy"
                        LocalItemLocks.isPinned(id) -> "playing"
                        serverId != null && db.hasQueuedDownload(serverId) -> "downloading"
                        else -> null
                      }
              if (discard != null) {
                tmp.deleteRecursively()
                return@withItem MoveResult.Discarded(discard)
              }
              val dest = File(toRoot, name)
              if (dest.exists()) {
                if (db.dirOwned(dest)) {
                  tmp.deleteRecursively()
                  return@withItem failed("${dest.absolutePath} belongs to another item")
                }
                dest.deleteRecursively()
              }
              if (!tmp.renameTo(dest)) {
                tmp.deleteRecursively()
                return@withItem failed("could not rename ${tmp.absolutePath} to ${dest.absolutePath}")
              }
              try {
                db.saveItem(relocate(snapshot, fromRoot, toRoot, toFolder))
              } catch (e: Exception) {
                dest.deleteRecursively()
                return@withItem failed("could not save moved $id: ${e.message}")
              }
              if (!src.deleteRecursively()) {
                AbsLogger.error(TAG, "moved $id but could not delete ${src.absolutePath}; left for orphan cleanup")
              }
              MoveResult.Moved
            }
    if (result is MoveResult.Moved) healLastSession(db)
    return result
  }

  private fun failed(message: String): MoveResult.Failed {
    AbsLogger.error(TAG, message)
    return MoveResult.Failed(message)
  }

  /** Re-points the saved last session to the item's current files, so a restored session does not play the old paths. */
  fun healLastSession(db: MoverDb) {
    val s = db.lastSession() ?: return
    val lli = s.localLibraryItem ?: return
    val cur = db.getItem(lli.id) ?: return
    val curTracks = cur.media.getAudioTracks().filter { it.localFileId != null }.associateBy { it.localFileId }
    val stale =
            lli.absolutePath != cur.absolutePath ||
                    lli.folderId != cur.folderId ||
                    s.audioTracks.any { t -> curTracks[t.localFileId]?.let { it.contentUrl != t.contentUrl } == true }
    if (!stale) return
    s.localLibraryItem = cur
    s.audioTracks.forEach { t ->
      val match = curTracks[t.localFileId] ?: return@forEach
      t.contentUrl = match.contentUrl
      t.metadata = match.metadata?.copy()
    }
    db.saveLastSession(s)
  }

  /**
   * Deletes leftover move copies and item folders no item or download refers to. Must not run
   * concurrently with [moveOne], whose copy is not referenced by anything until it commits.
   */
  fun cleanOrphans(roots: List<File>, db: MoverDb) {
    val owned = db.ownedDirs()
    for (root in roots) {
      if (!root.isDirectory) continue
      root.listFiles()?.filter { it.isDirectory }?.forEach { child ->
        if (child.name.startsWith(TMP_PREFIX)) {
          deleteOrphan(child)
        } else if (AppStorage.normalizedPath(child) !in owned) {
          // A download finishing between dirOwned's item and queue reads saves its item under this lock
          LocalItemLocks.withItem("local_${child.name}") { if (!db.dirOwned(child)) deleteOrphan(child) }
        }
      }
    }
  }

  private fun deleteOrphan(dir: File) {
    AbsLogger.info(TAG, "Deleting orphaned download folder ${dir.absolutePath}")
    if (!dir.deleteRecursively()) AbsLogger.error(TAG, "Could not delete ${dir.absolutePath}")
  }

  fun copyDirVerified(src: File, dst: File) = copyDirVerified(src, dst) { s, d -> s.copyTo(d, overwrite = true) }

  /** Copies the [src] tree into [dst] and checks every file arrived with its full length. */
  fun copyDirVerified(src: File, dst: File, copyFile: (File, File) -> Unit) {
    if (!src.isDirectory) throw IOException("${src.absolutePath} is not a directory")
    if (!dst.isDirectory && !dst.mkdirs()) throw IOException("could not create ${dst.absolutePath}")
    // An unreadable directory would otherwise look empty, and an empty copy would pass the check below
    val walk = src.walkTopDown().onFail { f, e -> throw IOException("could not list ${f.absolutePath}", e) }
    val copied = mutableListOf<File>()
    walk.forEach { f ->
      if (f == src) return@forEach
      val target = File(dst, f.relativeTo(src).path)
      if (f.isDirectory) {
        if (!target.isDirectory && !target.mkdirs()) throw IOException("could not create ${target.absolutePath}")
      } else {
        copyFile(f, target)
        copied += f
      }
    }
    if (!src.isDirectory) throw IOException("${src.absolutePath} disappeared during the copy")
    copied.forEach { f ->
      val target = File(dst, f.relativeTo(src).path)
      if (!target.isFile || target.length() != f.length()) {
        throw IOException("copy of ${f.absolutePath} is incomplete (${target.length()} of ${f.length()} bytes)")
      }
    }
  }
}
