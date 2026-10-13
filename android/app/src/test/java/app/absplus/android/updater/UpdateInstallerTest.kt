package app.absplus.android.updater

import android.content.Context
import android.content.pm.PackageInstaller
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UpdateInstallerTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val bytes = ByteArray(4096) { (it % 7).toByte() }
  private val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
  private fun apk() = File(context.cacheDir, "updates/update.apk").apply { parentFile!!.mkdirs(); writeBytes(bytes) }

  @Test
  fun aVerifiedUpdateIsHandedToAnInstallerSessionForTheTargetPackage() {
    val id = UpdateInstaller.commit(context, apk(), bytes.size.toLong(), sha, "app.absplus.android")
    val info = context.packageManager.packageInstaller.getSessionInfo(id)!!
    assertEquals("app.absplus.android", info.appPackageName)
  }

  @Test
  fun changedBytesAreNeverCommitted() {
    try {
      UpdateInstaller.commit(context, apk(), bytes.size.toLong(), "0".repeat(64), "app.absplus.android")
      fail("committed a file that differs from the verified one")
    } catch (e: UpdateException) {
      assertEquals(UpdateErrorCode.DIGEST_MISMATCH, e.code)
    }
    assertTrue(context.packageManager.packageInstaller.allSessions.isEmpty())
  }

  @Test
  fun theInstallerStatusGoesOnlyToThisAppsReceiver() {
    val pending = UpdateInstaller.statusIntent(context, 7)
    val intent = shadowOf(pending).savedIntent
    assertEquals(UpdateManager.ACTION_INSTALL_STATUS, intent.action)
    assertEquals(context.packageName, intent.`package`)
    assertEquals(UpdateInstallReceiver::class.java.name, intent.component!!.className)
    assertTrue(shadowOf(pending).isBroadcast)
  }

  @Test
  fun installerStatusesMapToOutcomes() {
    assertEquals(InstallOutcome.NEEDS_CONFIRMATION, UpdateInstaller.outcome(PackageInstaller.STATUS_PENDING_USER_ACTION))
    assertEquals(InstallOutcome.INSTALLED, UpdateInstaller.outcome(PackageInstaller.STATUS_SUCCESS))
    assertEquals(InstallOutcome.CANCELLED, UpdateInstaller.outcome(PackageInstaller.STATUS_FAILURE_ABORTED))
    assertEquals(InstallOutcome.BLOCKED, UpdateInstaller.outcome(PackageInstaller.STATUS_FAILURE_BLOCKED))
    assertEquals(InstallOutcome.NO_STORAGE, UpdateInstaller.outcome(PackageInstaller.STATUS_FAILURE_STORAGE))
    for (s in listOf(PackageInstaller.STATUS_FAILURE, PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, PackageInstaller.STATUS_FAILURE_INVALID)) {
      assertEquals(InstallOutcome.REJECTED, UpdateInstaller.outcome(s))
    }
  }

  @Test
  fun theManifestDeclaresTheInstallPermissionAndAPrivateReceiver() {
    val manifest = File("src/main/AndroidManifest.xml").readText()
    assertTrue(manifest.contains("<uses-permission android:name=\"android.permission.REQUEST_INSTALL_PACKAGES\" />"))
    assertTrue(Regex("android:name=\"\\.updater\\.UpdateInstallReceiver\"\\s+android:exported=\"false\"").containsMatchIn(manifest))
    // No storage permission was added for updates, and the release manifest queries no other packages
    assertTrue(!manifest.contains("MANAGE_EXTERNAL_STORAGE") && !manifest.contains("<queries>"))
    val security = File("src/main/res/xml/network_security_config.xml").readText()
    assertTrue(Regex("<domain-config cleartextTrafficPermitted=\"false\">[\\s\\S]*api\\.github\\.com[\\s\\S]*<certificates src=\"system\"/>\\s*</trust-anchors>\\s*</domain-config>").containsMatchIn(security))
  }

  @Test
  fun releaseBuildsHaveNoTestSource() {
    val release = File("src/release/java/app/absplus/android/updater/UpdaterConfig.kt").readText()
    assertTrue(release.contains("fun source(context: Context): UpdateSource = UpdateSource.Production"))
    assertTrue(release.contains("const val TEST_SOURCES_SUPPORTED = false"))
    assertTrue(!release.contains("127.0.0.1") && !release.contains("getSharedPreferences"))
  }
}
