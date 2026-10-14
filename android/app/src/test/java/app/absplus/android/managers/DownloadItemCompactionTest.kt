package app.absplus.android.managers

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.absplus.android.data.Book
import app.absplus.android.data.BookMetadata
import app.absplus.android.data.LocalFolder
import app.absplus.android.data.MediaType
import app.absplus.android.data.Podcast
import app.absplus.android.data.PodcastEpisode
import app.absplus.android.data.PodcastMetadata
import app.absplus.android.models.DownloadItem
import io.paperdb.Paper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DownloadItemCompactionTest {
  @Before
  fun setUp() {
    Paper.init(ApplicationProvider.getApplicationContext<Context>())
    Paper.book("downloadItems").destroy()
  }

  private fun episode(n: Int) =
          PodcastEpisode("ep-$n", n, "$n", "full", "Episode $n", null, "Show notes $n", null, n.toLong(), null, null, null, 60.0, 1000L, null, null)

  private fun podcast(episodeCount: Int) =
          Podcast(
                  PodcastMetadata("Show", "Host", "https://feed", mutableListOf("Tech"), false),
                  "/covers/show.jpg",
                  mutableListOf("tag"),
                  (1..episodeCount).map(::episode).toMutableList(),
                  false,
                  episodeCount
          )

  private fun item(media: MediaType, mediaType: String = "podcast") =
          DownloadItem(
                  id = "li-ep-1",
                  libraryItemId = "li",
                  episodeId = "ep-1",
                  userMediaProgress = null,
                  serverConnectionConfigId = "server",
                  serverAddress = "http://server",
                  serverUserId = "user",
                  mediaType = mediaType,
                  itemFolderPath = "/final",
                  localFolder = LocalFolder("internal-podcast", "Internal App Storage", "", "", "", "internal", mediaType),
                  itemTitle = "Show",
                  itemSubfolder = "Show",
                  media = media,
                  downloadItemParts = mutableListOf(),
                  ino = "ino",
                  terminalFailureAt = 42L
          )

  @Test
  fun queuedPodcastEpisodeKeepsOnlyThePodcastMetadata() {
    val full = item(podcast(500))

    val compact = full.withoutPodcastEpisodes()

    val media = compact.media as Podcast
    assertTrue("episode list dropped", media.episodes!!.isEmpty())
    assertEquals("Show", media.metadata.title)
    assertEquals("Host", (media.metadata as PodcastMetadata).author)
    assertEquals("/covers/show.jpg", media.coverPath)
    assertEquals(500, media.numEpisodes)
    assertSame("parts are the same list", full.downloadItemParts, compact.downloadItemParts)
    assertEquals(42L, compact.terminalFailureAt)
    assertEquals(full.id, compact.id)
    assertEquals("the caller's podcast is left intact", 500, (full.media as Podcast).episodes!!.size)
  }

  @Test
  fun bookItemIsUnchanged() {
    val book =
            Book(
                    BookMetadata("Book", null, null, null, mutableListOf(), null, null, null, null, null, null, null, false, null, null, null, null, null),
                    null, listOf(), null, null, mutableListOf(), null, null, null, 1
            )
    val full = item(book, "book")

    assertSame(full, full.withoutPodcastEpisodes())
  }

  @Test
  fun restoredQueueDropsEpisodesPersistedByOlderVersions() {
    DbManager().saveDownloadItem(item(podcast(500)))

    val restored = DbManager().getDownloadItems().single()

    assertTrue((restored.media as Podcast).episodes!!.isEmpty())
    assertEquals(42L, restored.terminalFailureAt)
    val onDisk = Paper.book("downloadItems").read<DownloadItem>(restored.id)!!
    assertTrue("old entry is rewritten compact", (onDisk.media as Podcast).episodes!!.isEmpty())
  }
}
