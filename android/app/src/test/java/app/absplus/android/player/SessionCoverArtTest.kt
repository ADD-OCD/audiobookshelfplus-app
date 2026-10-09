package app.absplus.android.player

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.support.v4.media.MediaMetadataCompat
import androidx.test.core.app.ApplicationProvider
import app.absplus.android.data.DeviceInfo
import app.absplus.android.data.LocalLibraryItem
import app.absplus.android.data.MediaType
import app.absplus.android.data.MediaTypeMetadata
import app.absplus.android.data.PlaybackSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.FileNotFoundException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A downloaded book whose cover can't be decoded still prepares: resolveCoverBitmapAsync never throws into
 * preparePlayer (which runs it for every playback start and restoration), and the MediaSession metadata that
 * feeds the notification and lock screen falls back to the default artwork. Decoder failures are simulated
 * (Robolectric can't decode real images); covers use content:// URIs as device-folder (SAF) downloads do.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SessionCoverArtTest {
  private val ctx: Context = ApplicationProvider.getApplicationContext()
  private val platformDecoder = CoverArt.decoder
  private val bitmap: Bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

  @Before fun setUp() = CoverArt.reset()

  @After fun tearDown() {
    CoverArt.decoder = platformDecoder
    CoverArt.reset()
  }

  private fun localSession(id: String, cover: Uri?): PlaybackSession {
    val item = LocalLibraryItem(
      "local_$id", "internal-book", "", "", "", false, "book", MediaType(MediaTypeMetadata("Book", false), null),
      mutableListOf(), cover?.toString(), null, true, null, null, null, id
    )
    return PlaybackSession(
      "session-$id", null, id, null, "book", MediaTypeMetadata("Book", false), DeviceInfo("d", "m", "x", 35, "0"),
      emptyList(), "Book", "Author", null, 360.0, 3, 0L, 0L, 0L, mutableListOf(), 12.5, null, item, null, null, null, null
    )
  }

  private fun coverFile(id: String): Uri = Uri.parse("content://com.android.externalstorage.documents/document/primary%3AAudiobooks%2F$id%2Fcover.jpg")

  /** Runs resolveCoverBitmapAsync like preparePlayer does and waits for it; returns whether art was resolved. */
  private fun resolve(session: PlaybackSession): Boolean {
    var resolved = false
    val job = session.resolveCoverBitmapAsync(ctx, scope) { resolved = true }
    runBlocking { job?.join() }
    return resolved
  }

  private fun art(session: PlaybackSession) = session.getMediaMetadataCompat(ctx).getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART)
  private fun artUri(session: PlaybackSession) = session.getMediaMetadataCompat(ctx).getString(MediaMetadataCompat.METADATA_KEY_ART_URI)
  private fun iconUri(session: PlaybackSession) = session.getMediaMetadataCompat(ctx).getString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI)

  @Test fun aValidLocalCoverIsStillUsed() {
    CoverArt.decoder = { _, _ -> bitmap }
    val session = localSession("li_1", coverFile("li_1"))
    assertTrue(resolve(session))
    assertNotNull(art(session))
    assertNotEquals(CoverArt.defaultUri().toString(), iconUri(session))
  }

  @Test fun aMissingLocalCoverPreparesWithTheDefaultArtwork() {
    CoverArt.decoder = { _, _ -> throw FileNotFoundException("open failed: ENOENT") }
    val session = localSession("li_2", coverFile("li_2"))
    assertTrue("metadata is refreshed after the failed decode", resolve(session))
    assertNull(art(session))
    assertEquals(CoverArt.defaultUri().toString(), artUri(session))
    assertEquals(CoverArt.defaultUri().toString(), iconUri(session))
    // The rest of the metadata the notification and lock screen use is intact
    assertEquals("Book", session.getMediaMetadataCompat(ctx).getString(MediaMetadataCompat.METADATA_KEY_TITLE))
  }

  @Test fun everyDecoderFailurePreparesWithoutThrowing() {
    listOf(
      FileNotFoundException("missing"), CoverArtTest.DecodeException("corrupt"), SecurityException("revoked"), java.io.IOException("io")
    ).forEachIndexed { i, error ->
      CoverArt.decoder = { _, _ -> throw error }
      val session = localSession("li_err$i", coverFile("li_err$i"))
      assertTrue(resolve(session))
      assertEquals(CoverArt.defaultUri().toString(), artUri(session))
    }
  }

  @Test fun repeatedPlaybackOfTheSameBookDoesNotDecodeAgain() {
    var decodes = 0
    CoverArt.decoder = { _, _ -> decodes++; throw FileNotFoundException("missing") }
    repeat(3) { assertTrue(resolve(localSession("li_3", coverFile("li_3")))) }
    assertEquals(1, decodes)
  }

  @Test fun aNullCoverReferenceUsesTheExistingNoCoverPath() {
    // No local cover reference and no server cover: the existing no-cover artwork, nothing to decode
    var decodes = 0
    CoverArt.decoder = { _, _ -> decodes++; bitmap }
    val session = localSession("li_4", null)
    assertEquals(CoverArt.defaultUri().toString(), iconUri(session))
    assertEquals(0, decodes)
  }

  @Test fun cancellingTheArtJobDuringDecodeDropsTheResultQuietly() {
    val decoding = CountDownLatch(1)
    val release = CountDownLatch(1)
    CoverArt.decoder = { _, _ -> decoding.countDown(); release.await(5, TimeUnit.SECONDS); bitmap }
    val session = localSession("li_5", coverFile("li_5"))
    var resolved = false
    val job = session.resolveCoverBitmapAsync(ctx, scope) { resolved = true }!!
    assertTrue(decoding.await(5, TimeUnit.SECONDS))
    job.cancel() // a new book was prepared, or the service is shutting down
    release.countDown()
    runBlocking { job.join() }
    assertFalse(resolved)
    assertTrue(job.isCancelled)
  }
}
