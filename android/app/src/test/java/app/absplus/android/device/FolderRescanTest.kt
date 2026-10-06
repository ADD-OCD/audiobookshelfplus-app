package app.absplus.android.device

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Rescan Folder's progress, failure and single-scan rules (FolderRescan.kt). */
class FolderRescanTest {
  private data class Checked(val checked: Int, val found: Int, val unmatched: Int, val latest: String?)

  private class Run(
          pending: List<String>,
          known: Set<String>,
          private val serverFails: Set<String> = emptySet(),
          private val filesMissing: Set<String> = emptySet(),
          private val scanThrows: Set<String> = emptySet(),
          private val async: Boolean = false,
          decisions: Map<String, RescanMatch<String>> = emptyMap()
  ) {
    val relinkScans = mutableListOf<String>()
    val progress = mutableListOf<Checked>()
    val outcomes = mutableListOf<RescanOutcome<String>>()
    private val queue = ArrayDeque<() -> Unit>()

    init {
      runRescan(
              pending.map { it to it },
              match = { _, path -> decisions[path] ?: if (path in known) RescanMatch.Link(path, relink = false) else RescanMatch.Unmatched },
              fetchFull = { item, cb -> later { cb(if (item in serverFails) null else item) } },
              scan = { _, item, relink, cb ->
                if (relink) relinkScans.add(item)
                if (item in scanThrows) throw IllegalStateException("bad folder")
                later { cb(if (item in filesMissing) null else "local:$item") }
              },
              onChecked = { checked, matched, notMatched, latest -> progress.add(Checked(checked, matched.size, notMatched, latest)) },
              done = { outcomes.add(it) }
      )
    }

    private fun later(block: () -> Unit) = if (async) queue.addLast(block) else block()

    fun drain(): Run {
      while (queue.isNotEmpty()) queue.removeFirst()()
      return this
    }

    val outcome get() = outcomes.single()
  }

  @Test
  fun countsProgressAndReportsTheLatestMatchedItem() {
    val run = Run(listOf("A/One", "B/Two", "C/Three"), known = setOf("A/One", "C/Three"))
    assertEquals(
            listOf(Checked(1, 1, 0, "local:A/One"), Checked(2, 1, 1, null), Checked(3, 2, 1, "local:C/Three")),
            run.progress
    )
    assertEquals(listOf("local:A/One", "local:C/Three"), run.outcome.matched)
    assertEquals(listOf("B/Two"), run.outcome.unmatched)
    assertNull(run.outcome.error)
  }

  @Test
  fun asynchronousCallbacksCompleteOnceInFolderOrder() {
    val run = Run(listOf("A/One", "B/Two", "C/Three"), known = setOf("A/One", "B/Two", "C/Three"), async = true)
    assertTrue("nothing completes before the callbacks run", run.outcomes.isEmpty())
    run.drain()
    assertEquals(listOf(1, 2, 3), run.progress.map { it.checked })
    assertEquals(listOf("local:A/One", "local:B/Two", "local:C/Three"), run.outcome.matched)
  }

  @Test
  fun anEmptyFolderIsAnEmptySuccess() {
    val run = Run(emptyList(), known = emptySet())
    assertTrue(run.progress.isEmpty())
    assertEquals(RescanOutcome(emptyList<String>(), emptyList(), null), run.outcome)
  }

  @Test
  fun aFolderWhoseFilesDoNotMatchIsUnmatchedNotAnError() {
    val run = Run(listOf("A/One"), known = setOf("A/One"), filesMissing = setOf("A/One"))
    assertEquals(listOf("A/One"), run.outcome.unmatched)
    assertNull(run.outcome.error)
  }

  @Test
  fun aServerFailureStopsTheScanAndKeepsItemsAlreadySaved() {
    val run = Run(listOf("A/One", "B/Two", "C/Three"), known = setOf("A/One", "B/Two", "C/Three"), serverFails = setOf("B/Two"))
    assertEquals(RescanError.SERVER, run.outcome.error)
    assertEquals(listOf("local:A/One"), run.outcome.matched)
    assertEquals("the third folder is never checked", 1, run.progress.size)
  }

  @Test
  fun aThrowingStepTerminatesTheScanOnce() {
    val run = Run(listOf("A/One", "B/Two"), known = setOf("A/One", "B/Two"), scanThrows = setOf("A/One"))
    assertEquals(RescanError.UNEXPECTED, run.outcome.error)
    assertTrue(run.outcome.matched.isEmpty())

    val outcomes = mutableListOf<RescanOutcome<String>>()
    runRescan<String, String, String>(
            listOf("x" to "A/One"),
            match = { _, _ -> throw IllegalStateException("bad index") },
            fetchFull = { item: String, cb -> cb(item) },
            scan = { _, item, _, cb -> cb(item) },
            onChecked = { _, _, _, _ -> },
            done = { outcomes.add(it) }
    )
    assertEquals(RescanError.UNEXPECTED, outcomes.single().error)
  }

  @Test
  fun manyUnmatchedFoldersDoNotRecursePerFolder() {
    val pending = (1..20000).map { "Author/Title $it" }
    val run = Run(pending, known = emptySet())
    assertEquals(20000, run.outcome.unmatched.size)
    assertEquals(20000, run.progress.last().checked)
  }

  @Test
  fun theCatalogFailsWhenTheLibraryListOrAnyPageFails() {
    fun load(libraries: List<String>?, failing: Set<String>): Map<String, List<Int>>? {
      var result: Map<String, List<Int>>? = mapOf("unset" to emptyList())
      loadRescanCatalog<String, Int>(
              { cb -> cb(libraries) },
              { it },
              { id, cb -> cb(if (id in failing) null else listOf(id.length)) }
      ) { result = it }
      return result
    }
    assertNull("library list failed", load(null, emptySet()))
    assertNull("a library's items failed", load(listOf("lib1", "lib22"), setOf("lib22")))
    assertEquals(mapOf("lib1" to listOf(4), "lib22" to listOf(5)), load(listOf("lib1", "lib22"), emptySet()))
    assertEquals("no libraries is an empty catalog, not a failure", emptyMap<String, List<Int>>(), load(emptyList(), emptySet()))
  }

  @Test
  fun oneRescanPerFolder() {
    val guard = RescanGuard()
    assertTrue(guard.tryStart("folder-1"))
    assertFalse("a second scan of the same folder is refused", guard.tryStart("folder-1"))
    assertTrue("another folder is independent", guard.tryStart("folder-2"))
    guard.finish("folder-1")
    assertFalse(guard.isRunning("folder-1"))
    assertTrue("released after finishing", guard.tryStart("folder-1"))
  }

  @Test
  fun progressEventsCarryTheirFolderAndNoPercentage() {
    val mapper = jacksonObjectMapper()
    val json = mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(
            RescanProgress("folder-1", RescanPhase.CHECKING, checked = 2, total = 5, found = 1, unmatched = 1, latestTitle = "The Book")
    )
    assertEquals(
            setOf("folderId", "phase", "checked", "total", "found", "unmatched", "latestTitle", "error"),
            json.fieldNames().asSequence().toSet()
    )
    assertEquals("folder-1", json.get("folderId").asText())
    assertEquals("checking", json.get("phase").asText())
    assertEquals(-1, mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(RescanProgress("f", RescanPhase.LOADING)).get("total").asInt())
  }

  // --- Matching policy: the same book in several libraries (the S26 Dungeon Crawler Carl case) ---

  /** A server book copy: its id and the library it was loaded from. */
  private data class Copy(val id: String, val library: String, val authorTitle: String = DCC)

  private val main = Copy("main-dcc1", "lib-main")
  private val dccLib = Copy("dcc-dcc1", "lib-dcc")
  private val kids = Copy("kids-dcc1", "lib-kids")
  private val catalog = listOf(main, dccLib, kids, Copy("main-other", "lib-main", "Other Author/Other Book"))

  private fun resolve(
          coverIds: List<String> = emptyList(),
          saved: Boolean = false,
          savedLinkId: String? = null,
          authorTitle: String = DCC,
          currentLibrary: String? = "lib-main",
          books: List<Copy> = catalog
  ) = resolveRescanMatch(
          coverIds,
          saved,
          savedLinkId,
          authorTitle,
          currentLibrary,
          byId = { id -> books.find { it.id == id } },
          matchesByAuthorTitle = { key -> books.filter { it.authorTitle == key } },
          idOf = { it.id },
          libraryOf = { it.library }
  )

  @Test
  fun coverFileNamesOnlyCoverJpgIds() {
    assertEquals(
            listOf("dcc-dcc1", "li_8x2"),
            coverItemIds(listOf("01 - Part.mp3", "cover-dcc-dcc1.jpg", "cover.jpg", "cover-li_8x2.jpg", "cover-dcc-dcc1.jpg", "cover-x.png"))
    )
  }

  @Test
  fun theCoverFileIdIsAuthoritativeWhateverTheSelectedLibrary() {
    // Downloaded from the Dungeon Crawler Carl library while the main library is selected
    assertEquals(RescanMatch.Link(dccLib, relink = false), resolve(coverIds = listOf("dcc-dcc1"), currentLibrary = "lib-main"))
    assertEquals(RescanMatch.Link(kids, relink = false), resolve(coverIds = listOf("kids-dcc1"), currentLibrary = null))
  }

  @Test
  fun aCoverIdNotOnTheServerFallsBackToTheSelectedLibrary() {
    assertEquals(RescanMatch.Link(main, relink = false), resolve(coverIds = listOf("deleted-or-other-server")))
  }

  @Test
  fun withoutACoverIdOnlyAUniqueMatchInTheSelectedLibraryLinks() {
    assertEquals(RescanMatch.Link(main, relink = false), resolve(currentLibrary = "lib-main"))
    assertEquals(RescanMatch.Link(dccLib, relink = false), resolve(currentLibrary = "lib-dcc"))
  }

  @Test
  fun aCopyInAnotherLibraryIsNeverPickedByGuess() {
    // Not in the selected library, though it exists elsewhere
    assertEquals(RescanMatch.Ambiguous, resolve(currentLibrary = "lib-podcasts"))
    assertEquals(RescanMatch.Ambiguous, resolve(currentLibrary = null))
    // Even a book in only one other library
    assertEquals(RescanMatch.Ambiguous, resolve(books = listOf(dccLib), currentLibrary = "lib-main"))
    // Twice in the selected library
    assertEquals(RescanMatch.Ambiguous, resolve(books = listOf(main, Copy("main-dcc1-again", "lib-main"))))
    // Cover files naming two different items on the server
    assertEquals(RescanMatch.Ambiguous, resolve(coverIds = listOf("dcc-dcc1", "kids-dcc1")))
    // Not on the server at all
    assertEquals(RescanMatch.Unmatched, resolve(authorTitle = "Nobody/Nothing"))
  }

  @Test
  fun aSavedItemLinkedToTheWrongCopyIsRelinkedOnlyOnCoverProof() {
    // Saved by the earlier last-library-wins matching against the Kids copy; the cover proves the DCC copy
    assertEquals(RescanMatch.Link(dccLib, relink = true), resolve(coverIds = listOf("dcc-dcc1"), saved = true, savedLinkId = "kids-dcc1"))
    // Already linked to the proven copy: nothing to do
    assertEquals(RescanMatch.Keep, resolve(coverIds = listOf("dcc-dcc1"), saved = true, savedLinkId = "dcc-dcc1"))
    // No proof: a saved link is never changed by author/title
    assertEquals(RescanMatch.Keep, resolve(saved = true, savedLinkId = "kids-dcc1"))
    assertEquals(RescanMatch.Keep, resolve(coverIds = listOf("dcc-dcc1", "kids-dcc1"), saved = true, savedLinkId = "kids-dcc1"))
    // A saved local item that is not linked to the server is left alone
    assertEquals(RescanMatch.Keep, resolve(coverIds = listOf("dcc-dcc1"), saved = true, savedLinkId = null))
  }

  @Test
  fun theScanCountsRelinksKeepsAndAmbiguousFolders() {
    val run = Run(
            listOf("A/Relink", "B/Keep", "C/Ambiguous", "D/New", "E/None"),
            known = emptySet(),
            decisions = mapOf(
                    "A/Relink" to RescanMatch.Link("A/Relink", relink = true),
                    "B/Keep" to RescanMatch.Keep,
                    "C/Ambiguous" to RescanMatch.Ambiguous,
                    "D/New" to RescanMatch.Link("D/New", relink = false),
                    "E/None" to RescanMatch.Unmatched
            )
    )
    assertEquals(listOf("A/Relink"), run.relinkScans)
    assertEquals(listOf("local:A/Relink", "local:D/New"), run.outcome.matched)
    assertEquals(listOf("local:A/Relink"), run.outcome.relinked)
    assertEquals(listOf("C/Ambiguous"), run.outcome.ambiguous)
    assertEquals(listOf("E/None"), run.outcome.unmatched)
    // A kept folder is checked but neither matched nor not-matched
    assertEquals(listOf(Checked(1, 1, 0, "local:A/Relink"), Checked(2, 1, 0, null), Checked(3, 1, 1, null), Checked(4, 2, 1, "local:D/New"), Checked(5, 2, 2, null)), run.progress)
  }

  @Test
  fun relinkingKeepsLocalProgressAndOnlyMovesItsServerLink() {
    val progress = app.absplus.android.data.LocalMediaProgress(
            "local_folder", "local_folder", null, 3600.0, 0.5, 1800.0, false, null, null,
            1_700_000_000_000L, 1_690_000_000_000L, null, "config-1", "https://server", "user-1", "kids-dcc1", null
    )
    val result = repointLocalProgress(progress, "dcc-dcc1", "config-1", "https://server", "user-1")
    assertEquals("dcc-dcc1", result.libraryItemId)
    assertEquals(1800.0, result.currentTime, 0.0)
    assertEquals(0.5, result.progress, 0.0)
    assertEquals(1_700_000_000_000L, result.lastUpdate)
    assertEquals("local_folder", result.localLibraryItemId)
    assertFalse(result.isFinished)
  }

  private companion object {
    const val DCC = "Matt Dinniman/Dungeon Crawler Carl"
  }
}
