package app.absplus.android.updater

import android.content.Context
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue

/**
 * Debug builds only (this file is not compiled into release builds).
 *
 * By default a debug build checks the official repository but cannot download: it is not the production package, so a
 * release APK could never be installed over it. For device tests a fixture source can be set (AbsUpdater.setTestSource):
 * a fixture server on 127.0.0.1 (through adb reverse), a disposable test package and its disposable test certificate.
 * Even here the source may not target the production package or this app, and may only use loopback hosts.
 */
object UpdaterConfig {
  const val TEST_SOURCES_SUPPORTED = true
  private const val PREFS = "absplus_updater_debug"
  private const val KEY = "updater-test-source"
  private val mapper = jacksonObjectMapper()

  private data class TestSource(
    val latestReleaseUrl: String,
    val releasePagePrefix: String,
    val downloadUrlPrefix: String,
    val targetPackage: String,
    val trustedSignerSha256: List<String>,
    val installedPlusVersion: String
  )

  fun source(context: Context): UpdateSource {
    val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
    val test = json?.let { parse(context, it) }
    if (test != null) return test
    return UpdateSource.Production.copy(targetPackage = context.packageName, downloadsEnabled = false)
  }

  /** Returns an error, or null when the test source was stored */
  fun setTestSource(context: Context, json: String): String? {
    if (parse(context, json) == null) return "Invalid test source"
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    return null
  }

  fun clearTestSource(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
  }

  private fun parse(context: Context, json: String): UpdateSource? {
    val t = try {
      mapper.readValue<TestSource>(json)
    } catch (e: Exception) {
      return null
    }
    if (t.targetPackage == UpdateSource.PRODUCTION_PACKAGE || t.targetPackage == context.packageName) return null
    if (t.trustedSignerSha256.isEmpty() || t.trustedSignerSha256.any { !Regex("^[0-9a-f]{64}$").matches(it) }) return null
    if (t.trustedSignerSha256.any { it == UpdateSource.PRODUCTION_SIGNER_SHA256 }) return null
    if (PlusVersion.parse(t.installedPlusVersion) == null) return null
    val source = UpdateSource(
      latestReleaseUrl = t.latestReleaseUrl,
      releasePagePrefix = t.releasePagePrefix,
      downloadUrlPrefix = t.downloadUrlPrefix,
      allowedHosts = setOf("127.0.0.1", "localhost"),
      allowCleartextLoopback = true,
      targetPackage = t.targetPackage,
      trustedSignerSha256 = t.trustedSignerSha256.toSet(),
      installedPlusVersionOverride = t.installedPlusVersion,
      isTest = true
    )
    val urls = listOf(t.latestReleaseUrl, t.releasePagePrefix, t.downloadUrlPrefix)
    return if (urls.all { ReleaseSelector.isAllowedUrl(it, source) }) source else null
  }
}
