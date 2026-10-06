package app.absplus.android.device

import java.util.concurrent.ConcurrentHashMap

/**
 * Rescan Folder progress, sent to the folder page as the AbsFileSystem "onRescanProgress" event.
 *
 * [phase] is one of [RescanPhase]. [total] is the number of local author/title folders still to
 * check; it is -1 while the server catalog loads, before the total is known. [latestTitle] is the
 * title of the item just matched; that item is already saved, so it is final. [error] is one of
 * [RescanError], set only with [RescanPhase.FAILED].
 */
data class RescanProgress(
        val folderId: String,
        val phase: String,
        val checked: Int = 0,
        val total: Int = -1,
        val found: Int = 0,
        val unmatched: Int = 0,
        val latestTitle: String? = null,
        val error: String? = null
)

object RescanPhase {
  const val LOADING = "loading"
  const val CHECKING = "checking"
  const val COMPLETE = "complete"
  const val FAILED = "failed"
}

object RescanError {
  /** A library list or a page of a library's items could not be loaded. */
  const val CATALOG = "catalog"
  /** The local folder could not be opened or listed (e.g. permission lost). */
  const val FOLDER = "folder"
  /** A matched item could not be fetched from the server. */
  const val SERVER = "server"
  /** Anything else that went wrong mid-scan. */
  const val UNEXPECTED = "unexpected"
  /** Rescan supports book folders only. */
  const val UNSUPPORTED = "unsupported"
  /** A rescan of the same folder is already running. */
  const val RUNNING = "running"
}

/** At most one rescan per folder; rescans of different folders are independent. */
class RescanGuard {
  private val active = ConcurrentHashMap.newKeySet<String>()

  fun tryStart(folderId: String): Boolean = active.add(folderId)

  fun finish(folderId: String) {
    active.remove(folderId)
  }

  fun isRunning(folderId: String): Boolean = folderId in active
}

/**
 * Loads every library's items for matching. Fails (null) if the library list or any page of any
 * library fails: matching against an incomplete catalog would report real books as unmatched.
 */
fun <L, I> loadRescanCatalog(
        getLibraries: ((List<L>?) -> Unit) -> Unit,
        libraryId: (L) -> String,
        getAllItems: (String, (List<I>?) -> Unit) -> Unit,
        callback: (Map<String, List<I>>?) -> Unit
) {
  getLibraries { libraries ->
    if (libraries == null) {
      callback(null)
      return@getLibraries
    }
    val itemsByLibrary = mutableMapOf<String, List<I>>()
    fun fetchNext(index: Int) {
      if (index >= libraries.size) {
        callback(itemsByLibrary)
        return
      }
      val id = libraryId(libraries[index])
      getAllItems(id) { items ->
        if (items == null) {
          callback(null)
          return@getAllItems
        }
        itemsByLibrary[id] = items
        fetchNext(index + 1)
      }
    }
    fetchNext(0)
  }
}

/** The outcome of matching: [error] (a [RescanError]) is set when the run stopped early. */
data class RescanOutcome<R>(val matched: List<R>, val unmatched: List<String>, val error: String?)

/**
 * Checks [pending] local folders one at a time: [match] finds the server item by its author/title
 * path, [fetchFull] loads it, and [scan] builds and saves the local item (null when the folder's
 * files don't match). [onChecked] runs after every folder with the count checked so far and the
 * item just matched, if any. [done] runs exactly once, also when a step throws.
 */
fun <F, M, R> runRescan(
        pending: List<Pair<F, String>>,
        match: (String) -> M?,
        fetchFull: (M, (M?) -> Unit) -> Unit,
        scan: (F, M, (R?) -> Unit) -> Unit,
        onChecked: (checked: Int, matched: List<R>, unmatched: List<String>, latest: R?) -> Unit,
        done: (RescanOutcome<R>) -> Unit
) {
  val matched = mutableListOf<R>()
  val unmatched = mutableListOf<String>()
  var finished = false
  fun finish(error: String?) {
    if (finished) return
    finished = true
    done(RescanOutcome(matched.toList(), unmatched.toList(), error))
  }

  fun processFrom(start: Int) {
    var index = start
    try {
      // Unmatched folders resolve synchronously: loop over them instead of recursing per folder
      while (index < pending.size) {
        val (folder, relPath) = pending[index]
        val item = match(relPath)
        if (item != null) {
          val next = index + 1
          fetchFull(item) { full ->
            if (full == null) {
              finish(RescanError.SERVER)
              return@fetchFull
            }
            try {
              scan(folder, full) { result ->
                if (result != null) matched.add(result) else unmatched.add(relPath)
                try {
                  onChecked(next, matched, unmatched, result)
                } catch (e: Exception) {
                  finish(RescanError.UNEXPECTED)
                  return@scan
                }
                processFrom(next)
              }
            } catch (e: Exception) {
              finish(RescanError.UNEXPECTED)
            }
          }
          return
        }
        unmatched.add(relPath)
        index++
        onChecked(index, matched, unmatched, null)
      }
      finish(null)
    } catch (e: Exception) {
      finish(RescanError.UNEXPECTED)
    }
  }
  processFrom(0)
}
