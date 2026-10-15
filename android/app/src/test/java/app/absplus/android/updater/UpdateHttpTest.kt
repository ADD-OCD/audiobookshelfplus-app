package app.absplus.android.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLHandshakeException
import kotlin.concurrent.thread

/** A scripted response: what one URL answers */
class FakeResponse(val status: Int, val headers: Map<String, String> = emptyMap(), val body: () -> InputStream = { ByteArrayInputStream(ByteArray(0)) })

class FakeConnection(url: URL, private val response: FakeResponse) : HttpURLConnection(url) {
  val requestHeaders = mutableMapOf<String, String>()
  var disconnected = false
  private val stream by lazy { response.body() }
  override fun connect() {}
  override fun disconnect() {
    disconnected = true
    (stream as? BlockingStream)?.release()
  }
  override fun usingProxy() = false
  override fun getResponseCode() = response.status
  override fun getHeaderField(name: String?): String? = response.headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
  override fun getInputStream(): InputStream = stream
  override fun setRequestProperty(key: String, value: String) { requestHeaders[key] = value }
}

/** Sends a little data, then blocks until the connection is closed (a stalled transfer) */
class BlockingStream(private val head: ByteArray) : InputStream() {
  private val released = CountDownLatch(1)
  private var pos = 0
  fun release() = released.countDown()
  override fun read(): Int {
    val b = ByteArray(1)
    return if (read(b, 0, 1) < 0) -1 else b[0].toInt() and 0xff
  }
  override fun read(b: ByteArray, off: Int, len: Int): Int {
    if (pos < head.size) {
      val n = minOf(len, head.size - pos)
      System.arraycopy(head, pos, b, off, n)
      pos += n
      return n
    }
    released.await(10, TimeUnit.SECONDS)
    throw IOException("Socket closed")
  }
}

/** The updater's HTTP layer with scripted responses (no sockets); the device tests cover real networking */
class UpdateHttpTest {
  @get:Rule val tmp = TemporaryFolder()
  private val base = "https://github.com/ADD-OCD/audiobookshelfplus-app/releases/download/v0.14.2-beta-plus-v0.17.0/"
  private val apk = ByteArray(1_200_000) { (it % 251).toByte() }.also { it[0] = 0x50; it[1] = 0x4b; it[2] = 3; it[3] = 4 }
  private val apkSha = MessageDigest.getInstance("SHA-256").digest(apk).joinToString("") { "%02x".format(it) }
  private val routes = mutableMapOf<String, FakeResponse>()
  val opened = mutableListOf<FakeConnection>()

  private fun http(source: UpdateSource = UpdateSource.Production, readTimeoutMs: Int = 30_000) = UpdateHttp(source, readTimeoutMs = readTimeoutMs) { url ->
    val r = routes[url.toString()] ?: FakeResponse(404)
    FakeConnection(url, r).also { opened.add(it) }
  }

  private fun apkResponse(bytes: ByteArray = apk, type: String = "application/vnd.android.package-archive", length: Long? = bytes.size.toLong()) =
    FakeResponse(200, buildMap { put("Content-Type", type); length?.let { put("Content-Length", it.toString()) } }) { ByteArrayInputStream(bytes) }

  private fun redirect(to: String) = FakeResponse(302, mapOf("Location" to to))
  private fun asset(name: String = "audiobookshelf-plus-v0.17.0-release.apk", size: Long = apk.size.toLong()) = ReleaseAsset(name, size, apkSha, base + name)
  private fun target() = File(tmp.root, "download.part")
  private fun download(a: ReleaseAsset = asset(), cancel: AtomicBoolean = AtomicBoolean(false), h: UpdateHttp = http()) = h.download(a, target(), cancel) { _, _ -> }

  private fun expectError(code: UpdateErrorCode, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: UpdateException) {
      assertEquals(e.message, code, e.code)
    }
  }

  private val latest = UpdateSource.Production.latestReleaseUrl

  @Test
  fun latestReleaseJsonAndItsErrors() {
    routes[latest] = FakeResponse(200, mapOf("Content-Type" to "application/json; charset=utf-8")) { ByteArrayInputStream("{\"ok\":1}".toByteArray()) }
    assertEquals("{\"ok\":1}", http().fetchLatestRelease())
    assertEquals("application/vnd.github+json", opened.last().requestHeaders["Accept"])
    assertTrue(opened.last().requestHeaders.keys.none { it.equals("Authorization", ignoreCase = true) })
    assertFalse(opened.last().instanceFollowRedirects)
    routes[latest] = FakeResponse(404)
    expectError(UpdateErrorCode.NO_RELEASE) { http().fetchLatestRelease() }
    routes[latest] = FakeResponse(403, mapOf("X-RateLimit-Remaining" to "0", "X-RateLimit-Reset" to "1791752674"))
    expectError(UpdateErrorCode.RATE_LIMITED) { http().fetchLatestRelease() }
    routes[latest] = FakeResponse(429, mapOf("Retry-After" to "60"))
    expectError(UpdateErrorCode.RATE_LIMITED) { http().fetchLatestRelease() }
    routes[latest] = FakeResponse(403)
    expectError(UpdateErrorCode.GITHUB_ERROR) { http().fetchLatestRelease() }
    routes[latest] = FakeResponse(502, mapOf("Content-Type" to "text/html"))
    expectError(UpdateErrorCode.GITHUB_ERROR) { http().fetchLatestRelease() }
    routes[latest] = FakeResponse(200, mapOf("Content-Type" to "text/html")) { ByteArrayInputStream("<html>captive portal</html>".toByteArray()) }
    expectError(UpdateErrorCode.UNEXPECTED_CONTENT) { http().fetchLatestRelease() }
    routes[latest] = FakeResponse(200, mapOf("Content-Type" to "application/json")) { ByteArrayInputStream(ByteArray(UpdateHttp.MAX_JSON_BYTES + 1)) }
    expectError(UpdateErrorCode.UNEXPECTED_CONTENT) { http().fetchLatestRelease() }
    routes[latest] = redirect("https://api.github.com/elsewhere")
    expectError(UpdateErrorCode.UNTRUSTED_URL) { http().fetchLatestRelease() }
  }

  @Test
  fun downloadsStreamThroughAllowedRedirectsWithTheRightDigest() {
    routes[asset().downloadUrl] = redirect("https://release-assets.githubusercontent.com/github-production-release-asset/1/b?sp=r&sig=x")
    routes["https://release-assets.githubusercontent.com/github-production-release-asset/1/b?sp=r&sig=x"] = apkResponse()
    val reports = mutableListOf<Long>()
    val result = http().download(asset(), target(), AtomicBoolean(false)) { done, _ -> reports.add(done) }
    assertEquals(apkSha, result.sha256)
    assertEquals(apk.size.toLong(), target().length())
    assertEquals(apk.size.toLong(), reports.last())
    assertTrue(reports.size > 1)
    assertTrue(opened.all { it.disconnected })
  }

  @Test
  fun redirectsOutsideTheAllowedHostsOrTooManyHopsAreRefused() {
    routes[asset().downloadUrl] = redirect("https://evil.example/a.apk")
    expectError(UpdateErrorCode.UNTRUSTED_URL) { download() }
    routes[asset().downloadUrl] = redirect("http://release-assets.githubusercontent.com/a.apk")
    expectError(UpdateErrorCode.UNTRUSTED_URL) { download() }
    routes[asset().downloadUrl] = redirect("https://release-assets.githubusercontent.com.evil.example/a.apk")
    expectError(UpdateErrorCode.UNTRUSTED_URL) { download() }
    routes[asset().downloadUrl] = redirect(asset().downloadUrl)
    expectError(UpdateErrorCode.UNTRUSTED_URL) { download() }
    routes[asset().downloadUrl] = FakeResponse(302)
    expectError(UpdateErrorCode.UNTRUSTED_URL) { download() }
    // Only the allowed hosts were ever contacted
    assertTrue(opened.all { it.url.host in UpdateSource.Production.allowedHosts })
  }

  @Test
  fun htmlOrNonApkBytesAreRefused() {
    routes[asset().downloadUrl] = apkResponse("<html>sign in</html>".toByteArray(), "text/html; charset=utf-8")
    expectError(UpdateErrorCode.UNEXPECTED_CONTENT) { download() }
    routes[asset().downloadUrl] = apkResponse(apk.copyOf().also { it[0] = '<'.code.toByte() }, "application/octet-stream")
    expectError(UpdateErrorCode.UNEXPECTED_CONTENT) { download() }
    routes[asset().downloadUrl] = FakeResponse(404)
    expectError(UpdateErrorCode.NO_APK) { download() }
    routes[asset().downloadUrl] = FakeResponse(500)
    expectError(UpdateErrorCode.GITHUB_ERROR) { download() }
  }

  @Test
  fun truncatedOversizedAndMislabelledDownloadsAreRefused() {
    routes[asset().downloadUrl] = apkResponse()
    expectError(UpdateErrorCode.SIZE_MISMATCH) { download(asset(size = apk.size + 10L)) }
    routes[asset().downloadUrl] = apkResponse(apk.copyOf(apk.size - 1000), length = null)
    expectError(UpdateErrorCode.SIZE_MISMATCH) { download() }
    routes[asset().downloadUrl] = apkResponse(apk + ByteArray(5000), length = null)
    expectError(UpdateErrorCode.SIZE_MISMATCH) { download() }
    // A connection that drops half way through a declared length
    routes[asset().downloadUrl] = FakeResponse(200, mapOf("Content-Type" to "application/octet-stream", "Content-Length" to apk.size.toString())) {
      object : InputStream() {
        private val inner = ByteArrayInputStream(apk, 0, apk.size / 2)
        override fun read() = inner.read().let { if (it < 0) throw IOException("unexpected end of stream") else it }
        override fun read(b: ByteArray, off: Int, len: Int) = inner.read(b, off, len).let { if (it < 0) throw IOException("unexpected end of stream") else it }
      }
    }
    expectError(UpdateErrorCode.NETWORK) { download() }
  }

  @Test
  fun cancelStopsAStalledDownloadPromptly() {
    routes[asset().downloadUrl] = FakeResponse(200, mapOf("Content-Type" to "application/octet-stream", "Content-Length" to apk.size.toString())) { BlockingStream(apk.copyOf(100_000)) }
    val cancel = AtomicBoolean(false)
    val h = http()
    thread {
      Thread.sleep(200)
      cancel.set(true)
      h.abort()
    }
    val started = System.currentTimeMillis()
    expectError(UpdateErrorCode.CANCELLED) { download(cancel = cancel, h = h) }
    assertTrue("cancel took too long", System.currentTimeMillis() - started < 3000)
    // Cancelled before any connection: nothing is contacted
    val before = opened.size
    expectError(UpdateErrorCode.CANCELLED) { download(cancel = AtomicBoolean(true)) }
    assertEquals(before, opened.size)
  }

  @Test
  fun networkFailuresAreCategorised() {
    fun failing(e: IOException) = UpdateHttp(UpdateSource.Production) { throw e }
    expectError(UpdateErrorCode.NETWORK) { failing(ConnectException("refused")).fetchLatestRelease() }
    expectError(UpdateErrorCode.NETWORK) { failing(java.net.UnknownHostException("api.github.com")).fetchLatestRelease() }
    expectError(UpdateErrorCode.TIMEOUT) { failing(SocketTimeoutException("connect timed out")).fetchLatestRelease() }
    expectError(UpdateErrorCode.TLS) { failing(SSLHandshakeException("bad certificate")).fetchLatestRelease() }
    expectError(UpdateErrorCode.STORAGE) { failing(IOException("write failed: ENOSPC (No space left on device)")).fetchLatestRelease() }
    routes[asset().downloadUrl] = FakeResponse(200, mapOf("Content-Type" to "application/octet-stream", "Content-Length" to apk.size.toString())) {
      object : InputStream() {
        override fun read(): Int = throw SocketTimeoutException("Read timed out")
      }
    }
    expectError(UpdateErrorCode.TIMEOUT) { download() }
  }

  @Test
  fun productionRulesRefuseNonGithubAndCleartextAddressesBeforeConnecting() {
    expectError(UpdateErrorCode.UNTRUSTED_URL) { download(ReleaseAsset("a.apk", apk.size.toLong(), apkSha, "http://127.0.0.1:18765/a.apk")) }
    expectError(UpdateErrorCode.UNTRUSTED_URL) { download(ReleaseAsset("a.apk", apk.size.toLong(), apkSha, "https://example.com/a.apk")) }
    assertTrue(opened.isEmpty())
    assertFalse(target().exists())
  }
}
