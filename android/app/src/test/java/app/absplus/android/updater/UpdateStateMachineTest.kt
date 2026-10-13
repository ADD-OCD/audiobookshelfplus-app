package app.absplus.android.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateStateMachineTest {
  private fun candidate(tag: String = "v0.14.2-beta-plus-v0.17.0") = UpdateCandidate(tag, PlusVersion(0, 17, 0), "t", "u", null, "", ReleaseAsset("a.apk", 2_000_000, "0".repeat(64), "u"), null)

  private fun available() = UpdateStateMachine().apply { beginCheck(); checkSucceeded(candidate(), newer = true, at = 1) }

  @Test
  fun theHappyPathRunsCheckToInstall() {
    val m = UpdateStateMachine()
    assertTrue(m.beginCheck())
    assertTrue(m.checkSucceeded(candidate(), newer = true, at = 5))
    assertEquals(UpdateState.AVAILABLE, m.snapshot.state)
    assertEquals(5L, m.snapshot.lastCheckAt)
    assertTrue(m.beginDownload())
    assertTrue(m.progress(1_000_000, 2_000_000))
    assertTrue(m.beginVerify())
    assertTrue(m.verified(133))
    assertEquals(UpdateState.READY, m.snapshot.state)
    assertTrue(m.beginInstall())
    assertTrue(m.installSucceeded())
    assertEquals(UpdateNotice.INSTALLED, m.snapshot.notice)
  }

  @Test
  fun upToDateWhenTheLatestReleaseIsNotNewer() {
    val m = UpdateStateMachine().apply { beginCheck(); checkSucceeded(candidate(), newer = false, at = 1) }
    assertEquals(UpdateState.UP_TO_DATE, m.snapshot.state)
    assertFalse(m.beginDownload())
  }

  @Test
  fun repeatedPressesCannotStartParallelWork() {
    val m = UpdateStateMachine()
    assertTrue(m.beginCheck())
    assertFalse(m.beginCheck())
    assertFalse(m.beginDownload())
    m.checkSucceeded(candidate(), newer = true, at = 1)
    assertTrue(m.beginDownload())
    assertFalse(m.beginDownload())
    assertFalse(m.beginCheck())
    assertFalse(m.beginInstall())
    m.beginVerify()
    assertFalse(m.beginInstall())
    assertFalse(m.beginCheck())
    assertFalse(m.progress(5, 10))
  }

  @Test
  fun cancelAndFailureAllowARetryWithTheSameCandidate() {
    val m = available()
    m.beginDownload(); m.progress(500, 2_000_000)
    assertTrue(m.cancelled())
    assertEquals(UpdateState.CANCELLED, m.snapshot.state)
    assertEquals(0L, m.snapshot.downloadedBytes)
    assertTrue(m.beginDownload())
    assertTrue(m.failed(UpdateErrorCode.DIGEST_MISMATCH))
    assertEquals(UpdateErrorCode.DIGEST_MISMATCH, m.snapshot.error)
    assertNull(m.snapshot.readyVersionCode)
    assertTrue(m.beginDownload())
    assertNull(m.snapshot.error)
  }

  @Test
  fun aFailedCheckWithoutACandidateCannotDownload() {
    val m = UpdateStateMachine().apply { beginCheck(); checkFailed(UpdateErrorCode.NETWORK) }
    assertEquals(UpdateState.FAILED, m.snapshot.state)
    assertFalse(m.beginDownload())
    assertTrue(m.beginCheck())
    // Found on the S22: an earlier result (up to date, or available) must not survive a failed check as a download offer
    val upToDate = UpdateStateMachine().apply { beginCheck(); checkSucceeded(candidate(), newer = false, at = 1); beginCheck(); checkFailed(UpdateErrorCode.NOT_STABLE) }
    assertNull(upToDate.snapshot.candidate)
    assertFalse(upToDate.beginDownload())
    val wasAvailable = available().apply { beginCheck(); checkFailed(UpdateErrorCode.RATE_LIMITED) }
    assertNull(wasAvailable.snapshot.candidate)
    assertEquals(1L, wasAvailable.snapshot.lastCheckAt)
  }

  @Test
  fun cancellingAndBlockedInstallsKeepTheVerifiedUpdate() {
    val m = available().apply { beginDownload(); beginVerify(); verified(133); beginInstall() }
    assertTrue(m.installCancelled())
    assertEquals(UpdateState.READY, m.snapshot.state)
    assertEquals(UpdateNotice.INSTALL_CANCELLED, m.snapshot.notice)
    assertTrue(m.beginInstall())
    assertTrue(m.installFailed(UpdateErrorCode.INSTALL_BLOCKED, keepReady = true))
    assertEquals(UpdateState.READY, m.snapshot.state)
    assertTrue(m.beginInstall())
    assertTrue(m.installFailed(UpdateErrorCode.INSTALL_FAILED, keepReady = false))
    assertEquals(UpdateState.FAILED, m.snapshot.state)
    assertNull(m.snapshot.readyVersionCode)
    assertFalse(m.beginInstall())
  }

  @Test
  fun aCheckKeepsAVerifiedUpdateOfTheSameReleaseAndDropsItForAnother() {
    val m = available().apply { beginDownload(); beginVerify(); verified(133) }
    assertTrue(m.beginCheck())
    m.checkSucceeded(candidate(), newer = true, at = 2)
    assertEquals(UpdateState.READY, m.snapshot.state)
    m.beginCheck(); m.checkFailed(UpdateErrorCode.NETWORK)
    assertEquals(UpdateState.READY, m.snapshot.state)
    m.beginCheck(); m.checkSucceeded(candidate("v0.14.2-beta-plus-v0.18.0"), newer = true, at = 3)
    assertEquals(UpdateState.AVAILABLE, m.snapshot.state)
    assertNull(m.snapshot.readyVersionCode)
  }

  @Test
  fun restoreAfterARestart() {
    val m = UpdateStateMachine()
    m.restore(7, candidate() to 133L, null)
    assertEquals(UpdateState.READY, m.snapshot.state)
    assertTrue(m.beginInstall())
    m.restore(7, null, UpdateNotice.INTERRUPTED)
    assertEquals(UpdateState.IDLE, m.snapshot.state)
    assertEquals(UpdateNotice.INTERRUPTED, m.snapshot.notice)
    assertFalse(m.beginDownload())
  }

  @Test
  fun storeManagedCopiesDoNothing() {
    val m = UpdateStateMachine().apply { unsupported() }
    assertFalse(m.beginCheck())
    assertFalse(m.beginDownload())
    assertFalse(m.beginInstall())
  }
}
