package app.absplus.android.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatePolicyTest {
  private val d = "5db2ed02ecabbd3a119094e12cb2b944aa97981d83b0bda77adcd35886dde5a8"
  private val apk = "audiobookshelf-plus-v0.16.0-release.apk"

  @Test
  fun checksumFilesInSha256sumFormat() {
    assertEquals(d, UpdatePolicy.parseChecksumFile("$d  $apk\n", apk))
    assertEquals(d, UpdatePolicy.parseChecksumFile(d.uppercase() + " *" + apk, apk))
    assertNull(UpdatePolicy.parseChecksumFile("$d  other.apk", apk))
    assertNull(UpdatePolicy.parseChecksumFile("$d  $apk\n$d  $apk", apk))
    assertNull(UpdatePolicy.parseChecksumFile("<html></html>", apk))
    assertNull(UpdatePolicy.parseChecksumFile("", apk))
  }

  @Test
  fun everyPublishedDigestMustMatch() {
    assertTrue(UpdatePolicy.digestsAgree(d, d, d))
    assertTrue(UpdatePolicy.digestsAgree(d, d, null))
    assertTrue(UpdatePolicy.digestsAgree(d, null, d.uppercase()))
    assertFalse(UpdatePolicy.digestsAgree(d, "0".repeat(64), d))
    assertFalse(UpdatePolicy.digestsAgree(d, d, "0".repeat(64)))
  }

  @Test
  fun playInstalledCopiesAreLeftToTheStore() {
    assertTrue(UpdatePolicy.isStoreManaged("com.android.vending"))
    assertFalse(UpdatePolicy.isStoreManaged(null))
    assertFalse(UpdatePolicy.isStoreManaged("com.android.shell"))
    assertFalse(UpdatePolicy.isStoreManaged("com.google.android.packageinstaller"))
  }

  @Test
  fun installPermissionOnlyFromAndroid8WhenNotGranted() {
    assertFalse(UpdatePolicy.needsInstallPermission(24, false))
    assertTrue(UpdatePolicy.needsInstallPermission(26, false))
    assertFalse(UpdatePolicy.needsInstallPermission(36, true))
    assertTrue(UpdatePolicy.needsInstallPermission(36, false))
  }

  @Test
  fun storageNeedsTwiceTheUpdatePlusAMargin() {
    val size = 15_000_000L
    assertTrue(UpdatePolicy.hasRoomFor(size, size * 2 + UpdatePolicy.STORAGE_MARGIN_BYTES))
    assertFalse(UpdatePolicy.hasRoomFor(size, size * 2 + UpdatePolicy.STORAGE_MARGIN_BYTES - 1))
  }

  @Test
  fun newerIsNumeric() {
    assertTrue(UpdatePolicy.isNewer(PlusVersion(0, 17, 0), PlusVersion(0, 16, 0)))
    assertFalse(UpdatePolicy.isNewer(PlusVersion(0, 16, 0), PlusVersion(0, 16, 0)))
    assertFalse(UpdatePolicy.isNewer(PlusVersion(0, 9, 0), PlusVersion(0, 10, 0)))
    assertTrue(UpdatePolicy.isNewer(PlusVersion(0, 16, 0), null))
  }
}
