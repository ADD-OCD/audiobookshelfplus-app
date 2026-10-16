package app.absplus.android.player

import android.content.Context
import android.content.ContextWrapper
import android.support.v4.media.MediaBrowserCompat
import androidx.test.core.app.ApplicationProvider
import app.absplus.android.data.Library
import app.absplus.android.data.LibraryStats
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Android Auto root before and after the server load (Discussion #30). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AutoRootMenuTest {
  private lateinit var service: PlayerNotificationService
  private val ctx get() = ApplicationProvider.getApplicationContext<Context>()

  @Before fun setup() {
    service = PlayerNotificationService()
    ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply { isAccessible = true }
      .invoke(service, ctx)
  }

  private fun library(id: String, audioFiles: Int = 3) = Library(id, "Library $id", mutableListOf(), "audiobookshelf", "book", LibraryStats(1, 1, 1.0, audioFiles))

  @Test fun provisionalRootIsDownloadsOnlyAndBrowsable() {
    val items = service.provisionalAutoRootItems()
    assertEquals(listOf(DOWNLOADS_ROOT), items.map { it.mediaId })
    assertEquals("Downloads", items.single().description.title)
    assertTrue(items.single().isBrowsable)
  }

  @Test fun provisionalRootOffersNothingThatTheFirstLoadGuardWouldRefuse() {
    // Continue, Recent and Libraries are answered with null until firstLoadDone; they must not be offered yet
    val ids = service.provisionalAutoRootItems().map { it.mediaId }
    assertFalse(ids.any { it == CONTINUE_ROOT || it == RECENTLY_ROOT || it == LIBRARIES_ROOT })
  }

  @Test fun loadedRootAddsLibrariesAndKeepsOneDownloadsEntry() {
    val tree = BrowseTree(ctx, emptyList(), listOf(library("a"), library("b"), library("empty", 0)), true)
    val root = tree[AUTO_BROWSE_ROOT]!!.map { it.description.mediaId }
    assertEquals(listOf(RECENTLY_ROOT, LIBRARIES_ROOT, DOWNLOADS_ROOT), root)
    assertEquals(1, root.count { it == DOWNLOADS_ROOT })
    assertEquals(listOf("a", "b"), tree[LIBRARIES_ROOT]!!.map { it.description.mediaId })
  }

  @Test fun failedOrOfflineLoadLeavesTheSameDownloadsRoot() {
    val offline = BrowseTree(ctx, emptyList(), emptyList(), false)[AUTO_BROWSE_ROOT]!!.map { it.description.mediaId }
    assertEquals(service.provisionalAutoRootItems().map { it.mediaId }, offline)
  }

  @Test fun provisionalItemsAreFreshListsForEachRequest() {
    val first = service.provisionalAutoRootItems()
    first.add(MediaBrowserCompat.MediaItem(first[0].description, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE))
    assertEquals(1, service.provisionalAutoRootItems().size)
  }
}
