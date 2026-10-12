package app.absplus.android.themeimport

import okhttp3.Call
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.InetAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

/** Rejects every host except the API host, and any lookup that returns a non-global address (DNS rebinding). */
class GuardedDns(private val resolver: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }) : Dns {
  override fun lookup(hostname: String): List<InetAddress> {
    if (hostname != ImportPolicy.API_HOST) throw ImportFailure("host")
    val addresses = resolver(hostname)
    if (addresses.isEmpty() || addresses.any { !ImportPolicy.isGlobalUnicast(it) }) throw ImportFailure("private-address")
    return addresses
  }
}

/** A failure with a reason code the UI explains; never contains response bodies, headers or credentials. */
class ImportFailure(val reason: String, val retryAfterSeconds: Long? = null) : IOException(reason)

/**
 * Request and byte budget for one import session (ImportPolicy limits). Shared by every request in the session, and
 * cancelable: canceling stops the call in flight and fails any later request.
 */
class ImportBudget(private val clock: () -> Long = System::currentTimeMillis) {
  private var requests = 0
  private var bytes = 0L
  private var networkMs = 0L
  @Volatile var canceled = false
    private set
  @Volatile private var current: Call? = null

  @Synchronized
  fun startRequest(call: Call) {
    if (canceled) throw ImportFailure("canceled")
    if (++requests > ImportPolicy.MAX_REQUESTS) throw ImportFailure("request-budget")
    if (networkMs >= ImportPolicy.NETWORK_PHASE_MS) throw ImportFailure("time-budget")
    current = call
  }

  @Synchronized
  fun finishRequest(elapsedMs: Long) {
    current = null
    networkMs += elapsedMs
    if (networkMs > ImportPolicy.NETWORK_PHASE_MS) throw ImportFailure("time-budget")
  }

  @Synchronized
  fun addBytes(n: Int) {
    bytes += n
    if (bytes > ImportPolicy.MAX_SESSION_BYTES) throw ImportFailure("byte-budget")
  }

  fun cancel() {
    canceled = true
    current?.cancel()
  }

  fun now() = clock()

  val requestCount get() = requests
}

/**
 * The importer's own HTTP client: unauthenticated, no cookies, no proxy, no automatic redirects, the guarded DNS, and
 * short timeouts. It shares nothing with the Audiobookshelf server client (no auth headers or token renewal), the
 * updater or downloads. It only ever requests https://api.github.com/<fixed path built from validated values>.
 */
class ThemeImportClient(base: OkHttpClient = OkHttpClient(), dns: Dns = GuardedDns()) {
  private val client: OkHttpClient =
    base.newBuilder()
      .dns(dns)
      .proxy(Proxy.NO_PROXY)
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .connectTimeout(ImportPolicy.CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .readTimeout(ImportPolicy.READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .callTimeout(ImportPolicy.CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .build()

  /**
   * GET https://api.github.com/<segments...>, following at most two redirects that stay on the API host's /repos or
   * /repositories paths. Returns the body bytes, read up to [maxBytes] (counting actual bytes, not Content-Length).
   */
  fun get(segments: List<String>, maxBytes: Int, budget: ImportBudget): ByteArray {
    var url = HttpUrl.Builder().scheme("https").host(ImportPolicy.API_HOST).apply { segments.forEach { addPathSegment(it) } }.build()
    var redirects = 0
    while (true) {
      val request =
        Request.Builder().url(url)
          .header("Accept", "application/vnd.github+json")
          .header("X-GitHub-Api-Version", "2022-11-28")
          .header("User-Agent", "Audiobookshelf-plus-theme-import")
          .header("Accept-Encoding", "identity")
          .build()
      val call = client.newCall(request)
      budget.startRequest(call)
      val started = budget.now()
      try {
        call.execute().use { response ->
          when (response.code) {
            in 200..299 -> {
              val encoding = response.header("Content-Encoding")
              if (encoding != null && !encoding.equals("identity", ignoreCase = true)) throw ImportFailure("compressed")
              return readBounded(response.body?.byteStream() ?: throw ImportFailure("empty"), maxBytes, budget)
            }
            301, 302, 307, 308 -> {
              if (++redirects > ImportPolicy.MAX_REDIRECTS) throw ImportFailure("redirects")
              url = allowedRedirect(response.header("Location")) ?: throw ImportFailure("redirect-host")
            }
            404 -> throw ImportFailure("not-found")
            403, 429 -> {
              val remaining = response.header("X-RateLimit-Remaining")
              val retry = response.header("Retry-After")?.toLongOrNull() ?: response.header("X-RateLimit-Reset")?.toLongOrNull()?.let { maxOf(0, it - budget.now() / 1000) }
              throw ImportFailure(if (response.code == 429 || remaining == "0" || retry != null) "rate-limited" else "forbidden", retry)
            }
            else -> throw ImportFailure("http-${response.code}")
          }
        }
      } catch (e: ImportFailure) {
        throw e
      } catch (e: IOException) {
        throw ImportFailure(if (budget.canceled) "canceled" else "network")
      } finally {
        budget.finishRequest(budget.now() - started)
      }
    }
  }

  private fun allowedRedirect(location: String?): HttpUrl? {
    val target = location?.toHttpUrlOrNull() ?: return null
    if (target.scheme != "https" || target.host != ImportPolicy.API_HOST || target.port != 443) return null
    if (target.username.isNotEmpty() || target.password.isNotEmpty() || target.fragment != null) return null
    val first = target.pathSegments.firstOrNull()
    if (first != "repos" && first != "repositories") return null
    return target
  }

  private fun readBounded(stream: java.io.InputStream, maxBytes: Int, budget: ImportBudget): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    stream.use {
      while (true) {
        if (budget.canceled) throw ImportFailure("canceled")
        val n = it.read(buffer)
        if (n < 0) break
        if (out.size() + n > maxBytes) throw ImportFailure("too-large")
        budget.addBytes(n)
        out.write(buffer, 0, n)
      }
    }
    return out.toByteArray()
  }
}
