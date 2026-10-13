package app.absplus.android.device

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppStorageTest {
  private val internalDir = File("/data/user/0/app.absplus.android/files")
  private val primaryDir = File("/storage/emulated/0/Android/data/app.absplus.android/files")
  private val sdDir = File("/storage/79EC-9B33/Android/data/app.absplus.android/files")

  private class FakeProbe(private val vols: List<AppVolume>, private val internal: File) : VolumeProbe {
    var volumeCalls = 0
    override fun volumes(): List<AppVolume> {
      volumeCalls++
      return vols
    }
    override fun internalFilesDir() = internal
  }

  private fun primary() = AppVolume(null, primaryDir, removable = false, mounted = true, writable = true)
  private fun sd(uuid: String = "79EC-9B33", mounted: Boolean = true, writable: Boolean = true) =
          AppVolume(uuid, sdDir, removable = true, mounted = mounted, writable = writable)
  private fun probe(vararg vols: AppVolume) = FakeProbe(vols.toList(), internalDir)

  private val sdFolder = AppStorage.folderFor(StorageTarget.Sd("79EC-9B33"), "book")
  private val internalFolder = AppStorage.folderFor(StorageTarget.Internal, "book")

  @Test
  fun ownershipCoversInternalAndSd() {
    assertTrue(AppStorage.isAppStorage("internal-podcast"))
    assertTrue(AppStorage.isAppStorage("appsd-79EC-9B33-book"))
    assertFalse(AppStorage.isAppStorage("cHJpbWFyeTpBdWRpb2Jvb2tzL0FCU1RFU1Q="))
  }

  @Test
  fun uuidRoundTrip() {
    assertEquals("79EC-9B33", AppStorage.uuidOf(AppStorage.appsdFolderId("79EC-9B33", "podcast")))
    assertNull(AppStorage.uuidOf("internal-book"))
    assertNull(AppStorage.uuidOf("appsd-book"))
  }

  @Test
  fun availability() {
    val unmounted = probe(primary(), sd(mounted = false, writable = false))
    assertFalse(AppStorage.isAvailable(sdFolder, unmounted))
    assertNull(AppStorage.downloadsRoot(sdFolder, unmounted))

    assertFalse(AppStorage.isAvailable(sdFolder, probe(primary(), sd(writable = false))))
    assertFalse(AppStorage.isAvailable(sdFolder, probe(primary(), sd(uuid = "1111-2222"))))
    assertNull(AppStorage.downloadsRoot(sdFolder, probe(primary(), sd(uuid = "1111-2222"))))

    val mounted = probe(primary(), sd())
    assertTrue(AppStorage.isAvailable(sdFolder, mounted))
    assertEquals(File(sdDir, "downloads"), AppStorage.downloadsRoot(sdFolder, mounted))
    assertEquals(File(sdDir, "download-staging"), AppStorage.stagingRoot(sdFolder, mounted))

    val untouched = probe(sd(mounted = false))
    assertTrue(AppStorage.isAvailable(internalFolder, untouched))
    assertEquals(File(internalDir, "downloads"), AppStorage.downloadsRoot(internalFolder, untouched))
    assertEquals(0, untouched.volumeCalls)
  }

  @Test
  fun storageKeyPerVolume() {
    val p = probe(primary(), sd())
    val onPrimary = AppStorage.storageKey(File(primaryDir, "downloads/a.mp3"), p)
    val onSd = AppStorage.storageKey(File(sdDir, "downloads/a.mp3"), p)
    assertEquals("volume:primary", onPrimary)
    assertEquals("volume:79EC-9B33", onSd)
    assertNotEquals(onPrimary, onSd)
    assertEquals("internal", AppStorage.storageKey(File(internalDir, "downloads/a.mp3"), p))
    assertEquals("other", AppStorage.storageKey(File(internalDir.parentFile, "files2/a.mp3"), p))
    assertFalse(AppStorage.isUnder(File(internalDir.parentFile, "files2"), internalDir))
  }

  @Test
  fun removableVolumeAndFolders() {
    assertEquals(sd(), AppStorage.removableVolume(probe(primary(), sd(mounted = false), sd())))
    assertNull(AppStorage.removableVolume(probe(primary(), sd(mounted = false))))
    assertEquals("appsd-79EC-9B33-book", sdFolder.id)
    assertEquals("appsd", sdFolder.storageType)
    assertEquals("SD card", sdFolder.name)
    assertEquals("internal-book", internalFolder.id)
    assertEquals("internal", internalFolder.storageType)
  }
}
