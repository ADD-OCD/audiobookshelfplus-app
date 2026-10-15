package app.absplus.android.managers

import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test

/** Real OkHttp redirect chain against bounded loopback fixtures; no external DNS or credentials. */
class DownloadAuthorizationRedirectTest {
  private fun client(): OkHttpClient {
    val field = InternalDownloadManager::class.java.getDeclaredField("client")
    field.isAccessible = true
    return (field.get(null) as OkHttpClient).newBuilder()
            .retryOnConnectionFailure(false).callTimeout(5, TimeUnit.SECONDS).build()
  }

  private fun listener() = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 5000 }

  private fun respond(server: ServerSocket, location: String?): Map<String, String> =
          server.accept().use { socket ->
            socket.soTimeout = 5000
            val reader = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
            require(reader.readLine().startsWith("GET "))
            val headers = mutableMapOf<String, String>()
            var total = 0
            while (true) {
              val line = reader.readLine() ?: error("Incomplete request")
              total += line.length
              require(total < 16 * 1024)
              if (line.isEmpty()) break
              headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
            }
            val response = if (location == null) "HTTP/1.1 200 OK\r\n" else "HTTP/1.1 302 Found\r\nLocation: $location\r\n"
            socket.getOutputStream().write((response + "Content-Length: 0\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
            socket.getOutputStream().flush()
            headers
          }

  @Test fun differentOriginNeverReceivesDownloadAuthorization() {
    val pool = Executors.newFixedThreadPool(2)
    try {
      listener().use { source -> listener().use { target ->
        val a = pool.submit<Map<String, String>> { respond(source, "http://127.0.0.1:${target.localPort}/landing") }
        val b = pool.submit<Map<String, String>> { respond(target, null) }
        client().newCall(Request.Builder().url("http://127.0.0.1:${source.localPort}/api/items/book")
                .header("Authorization", "Bearer synthetic-A").build()).execute().use { assertEquals(200, it.code) }
        assertEquals("Bearer synthetic-A", a.get(6, TimeUnit.SECONDS)["authorization"])
        assertNull(b.get(6, TimeUnit.SECONDS)["authorization"])
      } }
    } finally { pool.shutdownNow() }
  }

  @Test fun sameOriginRedirectRetainsTheOriginalOwnersAuthorization() {
    val pool = Executors.newSingleThreadExecutor()
    try {
      listener().use { server ->
        val headers = pool.submit<List<Map<String, String>>> {
          listOf(respond(server, "/next"), respond(server, null))
        }
        client().newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/api/items/book")
                .header("Authorization", "Bearer synthetic-A").build()).execute().use { assertEquals(200, it.code) }
        headers.get(6, TimeUnit.SECONDS).forEach { assertEquals("Bearer synthetic-A", it["authorization"]) }
      }
    } finally { pool.shutdownNow() }
  }
}
