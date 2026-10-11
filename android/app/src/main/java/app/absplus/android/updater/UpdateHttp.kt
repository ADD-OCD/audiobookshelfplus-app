package app.absplus.android.updater

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.net.UnknownHostException
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLException

/** Result of a completed download into the partial file */
data class DownloadedFile(val file: File, val size: Long, val sha256: String)

/**
 * The updater's only network access: the release lookup and the APK download, both over HTTPS to the source's allowed
 * hosts. Redirects are followed by hand (at most [MAX_REDIRECTS]) and every hop is checked against the same allow-list;
 * timeouts are bounded; nothing is authenticated (public releases need no GitHub account) and no headers or bodies are
 * logged.
 */
class UpdateHttp(
  private val source: UpdateSource,
  private val connectTimeoutMs: Int = 15_000,
  private val readTimeoutMs: Int = 30_000,
  /** Opens a connection to an already-checked URL; replaced only by unit tests */
  private val opener: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }
) {
  companion object {
    const val MAX_REDIRECTS = 5
    const val MAX_JSON_BYTES = 2_000_000
    private const val USER_AGENT = "Audiobookshelf-Plus-Updater"
    private val APK_MAGIC = byteArrayOf(0x50, 0x4b, 0x03, 0x04)
  }

  @Volatile private var active: HttpURLConnection? = null

  /** Cancel: closes the open connection so a blocked read ends at once (the caller sets its cancel flag first) */
  fun abort() {
    active?.disconnect()
  }

  /** GET the latest-release JSON. Throws [UpdateException] with a user-facing category */
  fun fetchLatestRelease(): String = guard(null) {
    val conn = open(source.latestReleaseUrl, "application/vnd.github+json")
    try {
      conn.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
      val status = conn.responseCode
      when {
        status == 200 -> Unit
        status == 404 -> throw UpdateException(UpdateErrorCode.NO_RELEASE, "no published release")
        (status == 403 || status == 429) && (conn.getHeaderField("X-RateLimit-Remaining") == "0" || conn.getHeaderField("Retry-After") != null) ->
          throw UpdateException(UpdateErrorCode.RATE_LIMITED, conn.getHeaderField("X-RateLimit-Reset") ?: "")
        status in 300..399 -> throw UpdateException(UpdateErrorCode.UNTRUSTED_URL, "unexpected redirect from the release API")
        else -> throw UpdateException(UpdateErrorCode.GITHUB_ERROR, "HTTP $status")
      }
      val type = conn.contentType?.lowercase() ?: ""
      if (!type.startsWith("application/json") && !type.startsWith("application/vnd.github")) throw UpdateException(UpdateErrorCode.UNEXPECTED_CONTENT, "release API returned $type")
      readLimited(conn.inputStream, MAX_JSON_BYTES).toString(Charsets.UTF_8)
    } finally {
      conn.disconnect()
    }
  }

  /** Downloads a small text asset (the .sha256 file) */
  fun fetchText(asset: ReleaseAsset, cancel: AtomicBoolean): String = guard(cancel) {
    val conn = connectFollowingRedirects(asset.downloadUrl, "application/octet-stream", cancel)
    try {
      readLimited(conn.inputStream, ReleaseSelector.MAX_CHECKSUM_BYTES.toInt()).toString(Charsets.UTF_8)
    } finally {
      conn.disconnect()
    }
  }

  /**
   * Streams the APK into [target] (a partial file in private storage), never holding it in memory. Fails when the
   * response is not an APK, is larger or smaller than [asset]'s size, or when [cancel] is set. The caller removes
   * [target] on failure.
   */
  fun download(asset: ReleaseAsset, target: File, cancel: AtomicBoolean, progress: (Long, Long) -> Unit): DownloadedFile = guard(cancel) {
    val conn = connectFollowingRedirects(asset.downloadUrl, "application/octet-stream", cancel)
    try {
      val type = conn.contentType?.lowercase()?.substringBefore(';')?.trim() ?: ""
      if (type != "application/vnd.android.package-archive" && type != "application/octet-stream") throw UpdateException(UpdateErrorCode.UNEXPECTED_CONTENT, "download returned $type")
      val length = conn.contentLengthLong
      if (length >= 0 && length != asset.size) throw UpdateException(UpdateErrorCode.SIZE_MISMATCH, "server reports $length bytes, release says ${asset.size}")
      val digest = MessageDigest.getInstance("SHA-256")
      var total = 0L
      var lastReport = 0L
      conn.inputStream.use { input ->
        FileOutputStream(target).use { out ->
          val buffer = ByteArray(64 * 1024)
          var first = true
          while (true) {
            if (cancel.get()) throw UpdateException(UpdateErrorCode.CANCELLED, "cancelled")
            val n = input.read(buffer)
            if (n < 0) break
            if (first) {
              if (n < 4 || !buffer.copyOfRange(0, 4).contentEquals(APK_MAGIC)) throw UpdateException(UpdateErrorCode.UNEXPECTED_CONTENT, "not an APK")
              first = false
            }
            total += n
            if (total > asset.size) throw UpdateException(UpdateErrorCode.SIZE_MISMATCH, "more data than expected")
            digest.update(buffer, 0, n)
            out.write(buffer, 0, n)
            if (total - lastReport >= 256 * 1024 || total == asset.size) {
              lastReport = total
              progress(total, asset.size)
            }
          }
          out.fd.sync()
        }
      }
      if (cancel.get()) throw UpdateException(UpdateErrorCode.CANCELLED, "cancelled")
      if (total != asset.size) throw UpdateException(UpdateErrorCode.SIZE_MISMATCH, "download ended after $total of ${asset.size} bytes")
      DownloadedFile(target, total, digest.digest().joinToString("") { "%02x".format(it) })
    } finally {
      conn.disconnect()
    }
  }

  private fun connectFollowingRedirects(start: String, accept: String, cancel: AtomicBoolean): HttpURLConnection {
    var url = start
    for (hop in 0..MAX_REDIRECTS) {
      if (cancel.get()) throw UpdateException(UpdateErrorCode.CANCELLED, "cancelled")
      val conn = open(url, accept)
      val status = conn.responseCode
      if (status in 300..399) {
        val location = conn.getHeaderField("Location")
        conn.disconnect()
        if (location.isNullOrBlank()) throw UpdateException(UpdateErrorCode.UNTRUSTED_URL, "redirect without a location")
        url = try {
          URI(url).resolve(location).toString()
        } catch (e: Exception) {
          throw UpdateException(UpdateErrorCode.UNTRUSTED_URL, "invalid redirect")
        }
        continue
      }
      if (status != 200) {
        conn.disconnect()
        throw UpdateException(if (status == 404) UpdateErrorCode.NO_APK else UpdateErrorCode.GITHUB_ERROR, "HTTP $status")
      }
      return conn
    }
    throw UpdateException(UpdateErrorCode.UNTRUSTED_URL, "too many redirects")
  }

  private fun open(url: String, accept: String): HttpURLConnection {
    if (!ReleaseSelector.isAllowedUrl(url, source)) throw UpdateException(UpdateErrorCode.UNTRUSTED_URL, "address outside the trusted update hosts")
    val conn = opener(URL(url))
    conn.instanceFollowRedirects = false
    conn.connectTimeout = connectTimeoutMs
    conn.readTimeout = readTimeoutMs
    conn.useCaches = false
    conn.setRequestProperty("Accept", accept)
    conn.setRequestProperty("User-Agent", USER_AGENT)
    active = conn
    return conn
  }

  private fun readLimited(input: InputStream, max: Int): ByteArray = input.use { stream ->
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val n = stream.read(buffer)
      if (n < 0) break
      if (out.size() + n > max) throw UpdateException(UpdateErrorCode.UNEXPECTED_CONTENT, "response too large")
      out.write(buffer, 0, n)
    }
    out.toByteArray()
  }

  private inline fun <T> guard(cancel: AtomicBoolean?, block: () -> T): T = try {
    block()
  } catch (e: UpdateException) {
    throw e
  } catch (e: IOException) {
    throw when {
      cancel?.get() == true -> UpdateException(UpdateErrorCode.CANCELLED, "cancelled")
      e is SocketTimeoutException -> UpdateException(UpdateErrorCode.TIMEOUT, "timed out")
      e is SSLException -> UpdateException(UpdateErrorCode.TLS, "secure connection failed")
      e is UnknownHostException || e is ConnectException || e is NoRouteToHostException -> UpdateException(UpdateErrorCode.NETWORK, "no connection")
      e.message?.contains("ENOSPC") == true || e.message?.contains("No space") == true -> UpdateException(UpdateErrorCode.STORAGE, "not enough storage")
      else -> UpdateException(UpdateErrorCode.NETWORK, e.javaClass.simpleName)
    }
  }
}
