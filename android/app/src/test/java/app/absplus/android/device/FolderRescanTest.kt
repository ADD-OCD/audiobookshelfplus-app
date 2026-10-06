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
          private val async: Boolean = false
  ) {
    val progress = mutableListOf<Checked>()
    val outcomes = mutableListOf<RescanOutcome<String>>()
    private val queue = ArrayDeque<() -> Unit>()

    init {
      runRescan(
              pending.map { it to it },
              match = { path -> if (path in known) path else null },
              fetchFull = { item, cb -> later { cb(if (item in serverFails) null else item) } },
              scan = { _, item, cb ->
                if (item in scanThrows) throw IllegalStateException("bad folder")
                later { cb(if (item in filesMissing) null else "local:$item") }
              },
              onChecked = { checked, matched, unmatched, latest -> progress.add(Checked(checked, matched.size, unmatched.size, latest)) },
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
            match = { throw IllegalStateException("bad index") },
            fetchFull = { item: String, cb -> cb(item) },
            scan = { _, item, cb -> cb(item) },
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
}
