package app.absplus.android.diagnostics

import android.util.Log
import app.absplus.android.plugins.AbsLogger
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/**
 * Raw logcat is readable over adb and ends up in bug reports, so the app's logcat copies (DLog, AbsLogger)
 * are sanitized like the diagnostic log. All credentials here are synthetic.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LogcatRedactionTest {
  private val jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJzeW50aGV0aWMifQ.c3ludGhldGljc2ln"
  private val secrets = listOf(jwt, "c3ludGhldGljc2ln", "syntheticuser", "synthetic-refresh")

  @Before fun clear() = ShadowLog.reset()

  private fun logcat(): String = ShadowLog.getLogs().joinToString("\n") { "${it.tag}: ${it.msg}" }

  private fun assertNoSecrets(out: String) = secrets.forEach { assertFalse("leaked $it in $out", out.contains(it)) }

  @Test fun dlogRedactsTokensInEveryLevel() {
    val msg = """request {"headers":{"Authorization":"Bearer $jwt","x-refresh-token":"synthetic-refresh"}} cover?token=$jwt"""
    DLog.v("T", msg); DLog.d("T", msg); DLog.i("T", msg); DLog.w("T", msg); DLog.w("T", msg, RuntimeException("x")); DLog.e("T", msg)
    val out = logcat()
    assertNoSecrets(out)
    assertTrue(out.contains("[REDACTED"))
    assertTrue("non-sensitive context is kept", out.contains("request"))
  }

  @Test fun dlogRedactsAServerConnectionConfig() {
    DLog.d("T", """setCurrentServerConnectionConfig {"name":"http://abs.example.com:13378 (syntheticuser)","username":"syntheticuser","token":"$jwt"}""")
    assertNoSecrets(logcat())
  }

  @Test fun absLoggerLogcatCopyHidesTheUsernameInServerNames() {
    AbsLogger.info("default", "attemptConnection: Successful connection to last saved server config (http://localhost:13378 (syntheticuser))")
    AbsLogger.error("default", "sync failed token=$jwt")
    val out = logcat()
    assertNoSecrets(out)
    assertTrue(out.contains("attemptConnection"))
  }

  @Test fun ordinaryMessagesAreUnchanged() {
    DLog.i("PlaybackRestore", "Session rebuilt for li_1 | position=12.5s | rate=1.5")
    assertTrue(ShadowLog.getLogsForTag("PlaybackRestore").single().msg == "Session rebuilt for li_1 | position=12.5s | rate=1.5")
    assertTrue(ShadowLog.getLogsForTag("PlaybackRestore").single().type == Log.INFO)
  }
}
