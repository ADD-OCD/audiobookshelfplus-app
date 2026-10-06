package app.absplus.android.device

import app.absplus.android.data.LocalFolder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * FolderAccess: the one "can the app still write to this device folder" rule, shared by the
 * downloader and the Local Folders permission check.
 */
class FolderAccessTest {
  private val url = "content://com.android.externalstorage.documents/tree/primary%3AAudiobooks%2FABSTEST/document/primary%3AAudiobooks%2FABSTEST"
  private val path = "/storage/emulated/0/Audiobooks/ABSTEST"
  private val abstest = LocalFolder("cHJpbWFyeTpBdWRpb2Jvb2tzL0FCU1RFU1Q=", "ABSTEST", url, "Audiobooks/ABSTEST", path, "PRIMARY", "book")

  /** Records what each check was given; models SimpleStorage, which only understands file paths. */
  private class FakeProbe(
          val pathOk: Boolean = true,
          val grant: Boolean = false,
          val writable: Boolean = true
  ) : FolderAccess.Probe {
    val pathsAsked = mutableListOf<String>()
    override fun pathAccess(path: String): Boolean {
      pathsAsked.add(path)
      return pathOk && path.startsWith("/")
    }
    override fun treeGrant(contentUrl: String) = grant
    override fun folderWritable(contentUrl: String) = writable
  }

  @Test
  fun aValidDeviceFolderPassesThroughItsFilePath() {
    val probe = FakeProbe()
    assertTrue(FolderAccess.canWrite(abstest, probe))
    // The path-based check never receives the content:// URL (the bug that made every check fail)
    assertEquals(listOf(path), probe.pathsAsked)
  }

  @Test
  fun aFolderWithoutAResolvablePathUsesItsPersistedTreeGrant() {
    val pathless = abstest.copy(absolutePath = "")
    assertTrue(FolderAccess.canWrite(pathless, FakeProbe(grant = true)))
    assertFalse(FolderAccess.canWrite(pathless, FakeProbe(grant = false)))
    assertTrue(FakeProbe().also { FolderAccess.canWrite(pathless, it) }.pathsAsked.isEmpty())
  }

  @Test
  fun lostOrDeletedFoldersStillFail() {
    // Grant revoked
    assertFalse(FolderAccess.canWrite(abstest, FakeProbe(pathOk = false, grant = false)))
    // Grant still there but the folder was deleted or is read-only
    assertFalse(FolderAccess.canWrite(abstest, FakeProbe(pathOk = true, writable = false)))
    assertFalse(FolderAccess.canWrite(abstest, FakeProbe(grant = true, pathOk = false, writable = false)))
    // No folder address at all
    assertFalse(FolderAccess.canWrite(abstest.copy(contentUrl = ""), FakeProbe()))
  }

  @Test
  fun internalAppStorageNeedsNoDeviceAccess() {
    val internal = LocalFolder("internal-book", "Internal App Storage", "", "", "", "internal", "book")
    val probe = FakeProbe(pathOk = false, grant = false, writable = false)
    assertTrue(FolderAccess.canWrite(internal, probe))
    assertTrue(probe.pathsAsked.isEmpty())
  }

  @Test
  fun thePermissionCheckUsesTheSavedFolderForItsUrl() {
    val other = abstest.copy(id = "other", contentUrl = "content://other", absolutePath = "/storage/emulated/0/Other")
    // Existing folder ids and records are used as they are, so the check gets the real file path
    assertEquals(abstest, FolderAccess.folderForUrl(url, listOf(other, abstest)))
    // An unsaved URL becomes a path-less stand-in, judged by its tree grant
    val unsaved = FolderAccess.folderForUrl("content://new", listOf(abstest))
    assertEquals("", unsaved.absolutePath)
    assertFalse(FolderAccess.canWrite(unsaved, FakeProbe(grant = false)))
  }
}
