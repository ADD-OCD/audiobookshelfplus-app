package app.absplus.android.server

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Single-flight refresh of a saved server's tokens (docs/authentication.md). The server is an OkHttp interceptor that
 * answers /auth/refresh like Audiobookshelf (rotating the refresh token) and can hold its answer until the test lets it
 * go, so overlapping callers are deterministic. Synthetic ids and tokens only. Robolectric supplies org.json.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenRefresherTest {
  private val serverA = "server-a"
  private val serverB = "server-b"

  private class MemoryStore(initial: Map<String, String>) : RefreshTokenStore {
    val tokens = Collections.synchronizedMap(HashMap(initial))
    override fun getRefreshToken(serverConnectionId: String) = tokens[serverConnectionId]
    override fun replaceRefreshToken(serverConnectionId: String, expected: String, newToken: String) =
            synchronized(tokens) {
              if (tokens[serverConnectionId] != expected) false else { tokens[serverConnectionId] = newToken; true }
            }
    override fun removeRefreshTokenIf(serverConnectionId: String, expected: String) =
            synchronized(tokens) {
              if (tokens[serverConnectionId] != expected) false else { tokens.remove(serverConnectionId); true }
            }
  }

  /** A fake /auth/refresh: answers with [answer] once [release] opens, counting the calls it receives. */
  private class FakeServer(var answer: (refreshToken: String, n: Int) -> Pair<Int, String>) {
    val calls = AtomicInteger()
    val arrived = CountDownLatch(1)
    var release = CountDownLatch(0)
    val sentHeaders = Collections.synchronizedList(mutableListOf<String?>())
    val client: OkHttpClient = OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
      val n = calls.incrementAndGet()
      val request = chain.request()
      sentHeaders.add(request.header("Authorization"))
      arrived.countDown()
      release.await(5, TimeUnit.SECONDS)
      val (code, body) = answer(request.header("x-refresh-token").orEmpty(), n)
      if (code == -1) throw IOException("offline")
      Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fake")
              .body(body.toResponseBody("application/json".toMediaType())).build()
    }).build()
  }

  private fun rotating(): (String, Int) -> Pair<Int, String> = { _, n ->
    200 to """{"user":{"accessToken":"access-$n","refreshToken":"refresh-$n"}}"""
  }

  private class Harness(store: RefreshTokenStore, configs: MutableSet<String>) {
    val rotated = Collections.synchronizedList(mutableListOf<Pair<String, String>>())
    val rejected = Collections.synchronizedList(mutableListOf<String>())
    val logs = Collections.synchronizedList(mutableListOf<String>())
    val refresher = TokenRefresher(
            store,
            addressFor = { id -> if (id in configs) "https://$id.test.invalid" else null },
            onRotated = { id, token -> rotated.add(id to token) },
            onRejected = { id -> rejected.add(id) },
            log = { logs.add(it) },
            flight = SingleFlight())
  }

  private fun collect(harness: Harness, server: FakeServer, ids: List<String>): List<RefreshResult> {
    val results = Collections.synchronizedList(mutableListOf<RefreshResult>())
    val done = CountDownLatch(ids.size)
    ids.forEach { id -> harness.refresher.refresh(id, server.client) { results.add(it); done.countDown() } }
    return results.also { server.release.countDown(); assertTrue("callers settle", done.await(5, TimeUnit.SECONDS)) }
  }

  @Test
  fun concurrentCallersShareOneRefresh() {
    val store = MemoryStore(mapOf(serverA to "refresh-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    val server = FakeServer(rotating()).apply { release = CountDownLatch(1) }

    val results = collect(harness, server, List(8) { serverA })

    assertEquals("one /auth/refresh for eight callers", 1, server.calls.get())
    assertEquals(List(8) { RefreshResult.Success("access-1") }, results)
    assertEquals("refresh-1", store.tokens[serverA])
    assertEquals(listOf(serverA to "access-1"), harness.rotated)
  }

  @Test
  fun callersArrivingDuringTheRefreshJoinIt() {
    val store = MemoryStore(mapOf(serverA to "refresh-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    val server = FakeServer(rotating()).apply { release = CountDownLatch(1) }
    val results = Collections.synchronizedList(mutableListOf<RefreshResult>())
    val done = CountDownLatch(2)

    harness.refresher.refresh(serverA, server.client) { results.add(it); done.countDown() }
    assertTrue(server.arrived.await(5, TimeUnit.SECONDS))
    // The refresh is on the wire now; this caller must wait for it, not start another one.
    harness.refresher.refresh(serverA, server.client) { results.add(it); done.countDown() }
    server.release.countDown()

    assertTrue(done.await(5, TimeUnit.SECONDS))
    assertEquals(1, server.calls.get())
    assertEquals(List(2) { RefreshResult.Success("access-1") }, results)
  }

  @Test
  fun aLaterCallerStartsAFreshRefreshWithTheRotatedToken() {
    val store = MemoryStore(mapOf(serverA to "refresh-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    val seen = Collections.synchronizedList(mutableListOf<String>())
    val server = FakeServer { token, n -> seen.add(token); rotating()(token, n) }

    collect(harness, server, listOf(serverA))
    collect(harness, server, listOf(serverA))

    assertEquals(listOf("refresh-0", "refresh-1"), seen)
    assertEquals("refresh-2", store.tokens[serverA])
  }

  @Test
  fun rejectionReachesEveryCallerAndSignsOutOnce() {
    val store = MemoryStore(mapOf(serverA to "refresh-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    val server = FakeServer { _, _ -> 401 to """{"error":"Invalid refresh token"}""" }.apply { release = CountDownLatch(1) }

    val results = collect(harness, server, List(5) { serverA })

    assertEquals(1, server.calls.get())
    assertEquals(List(5) { RefreshResult.Rejected }, results)
    assertEquals(listOf(serverA), harness.rejected)
    assertNull(store.tokens[serverA])
  }

  @Test
  fun aFailedRefreshIsNotRememberedAndRecoversLater() {
    val store = MemoryStore(mapOf(serverA to "refresh-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    var online = false
    val server = FakeServer { token, n -> if (!online) -1 to "" else rotating()(token, n) }

    assertEquals(List(3) { RefreshResult.Transient }, collect(harness, server, List(3) { serverA }))
    assertEquals("offline keeps the credentials", "refresh-0", store.tokens[serverA])
    assertTrue(harness.rejected.isEmpty())

    online = true
    assertEquals(listOf(RefreshResult.Success("access-2")), collect(harness, server, listOf(serverA)))
    assertEquals(2, server.calls.get())
  }

  @Test
  fun serverErrorsAndMalformedAnswersAreTransient() {
    for (answer in listOf(500 to "oops", 200 to "not json", 200 to """{"user":{}}""")) {
      val store = MemoryStore(mapOf(serverA to "refresh-0"))
      val harness = Harness(store, mutableSetOf(serverA))
      val server = FakeServer { _, _ -> answer }
      assertEquals(listOf(RefreshResult.Transient), collect(harness, server, listOf(serverA)))
      assertEquals("refresh-0", store.tokens[serverA])
      assertTrue(harness.rotated.isEmpty() && harness.rejected.isEmpty())
    }
  }

  @Test
  fun missingRefreshTokenOrServerIsRejectedWithoutARequest() {
    val server = FakeServer(rotating())
    val noToken = Harness(MemoryStore(emptyMap()), mutableSetOf(serverA))
    assertEquals(listOf(RefreshResult.Rejected), collect(noToken, server, listOf(serverA)))
    val noServer = Harness(MemoryStore(mapOf(serverA to "refresh-0")), mutableSetOf())
    assertEquals(listOf(RefreshResult.Rejected), collect(noServer, server, listOf(serverA)))
    assertEquals(0, server.calls.get())
  }

  @Test
  fun aLateRotationDoesNotOverwriteANewLogin() {
    val store = MemoryStore(mapOf(serverA to "refresh-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    val server = FakeServer(rotating()).apply { release = CountDownLatch(1) }
    val results = Collections.synchronizedList(mutableListOf<RefreshResult>())
    val done = CountDownLatch(1)

    harness.refresher.refresh(serverA, server.client) { results.add(it); done.countDown() }
    assertTrue(server.arrived.await(5, TimeUnit.SECONDS))
    store.tokens[serverA] = "refresh-new-login" // signed in again while the refresh was running
    server.release.countDown()

    assertTrue(done.await(5, TimeUnit.SECONDS))
    assertEquals(listOf(RefreshResult.Transient), results)
    assertEquals("refresh-new-login", store.tokens[serverA])
    assertTrue("the old result is not applied", harness.rotated.isEmpty())
  }

  @Test
  fun aLateRejectionDoesNotSignOutANewLogin() {
    val store = MemoryStore(mapOf(serverA to "refresh-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    val server = FakeServer { _, _ -> 401 to "{}" }.apply { release = CountDownLatch(1) }
    val done = CountDownLatch(1)
    val results = Collections.synchronizedList(mutableListOf<RefreshResult>())

    harness.refresher.refresh(serverA, server.client) { results.add(it); done.countDown() }
    assertTrue(server.arrived.await(5, TimeUnit.SECONDS))
    store.tokens[serverA] = "refresh-new-login"
    server.release.countDown()

    assertTrue(done.await(5, TimeUnit.SECONDS))
    assertEquals(listOf(RefreshResult.Transient), results)
    assertEquals("refresh-new-login", store.tokens[serverA])
    assertTrue(harness.rejected.isEmpty())
  }

  @Test
  fun aRotationAfterLogoutFromServerOrRemovalIsDiscarded() {
    // Logged out from the server: the refresh token was cleared during the refresh.
    val cleared = MemoryStore(mapOf(serverA to "refresh-0"))
    val clearedHarness = Harness(cleared, mutableSetOf(serverA))
    val server1 = FakeServer { token, n -> cleared.tokens.remove(serverA); rotating()(token, n) }
    assertEquals(listOf(RefreshResult.Transient), collect(clearedHarness, server1, listOf(serverA)))
    assertNull("not resurrected", cleared.tokens[serverA])

    // The saved server was removed during the refresh.
    val configs = mutableSetOf(serverA)
    val removed = MemoryStore(mapOf(serverA to "refresh-0"))
    val removedHarness = Harness(removed, configs)
    val server2 = FakeServer { token, n -> configs.remove(serverA); rotating()(token, n) }
    assertEquals(listOf(RefreshResult.Transient), collect(removedHarness, server2, listOf(serverA)))
    assertEquals("refresh-0", removed.tokens[serverA])
    assertTrue(clearedHarness.rotated.isEmpty() && removedHarness.rotated.isEmpty())
  }

  @Test
  fun differentServersAndAccountsRefreshIndependently() {
    val store = MemoryStore(mapOf(serverA to "refresh-a", serverB to "refresh-b"))
    val harness = Harness(store, mutableSetOf(serverA, serverB))
    val server = FakeServer { token, n -> 200 to """{"user":{"accessToken":"access-$token","refreshToken":"$token-$n"}}""" }
            .apply { release = CountDownLatch(1) }

    val results = collect(harness, server, listOf(serverA, serverB, serverA, serverB))

    assertEquals(2, server.calls.get())
    assertEquals(setOf(RefreshResult.Success("access-refresh-a"), RefreshResult.Success("access-refresh-b")), results.toSet())
    assertEquals(setOf(serverA to "access-refresh-a", serverB to "access-refresh-b"), harness.rotated.toSet())
  }

  @Test
  fun refreshSendsOnlyTheRefreshTokenAndLogsNoCredentials() {
    val store = MemoryStore(mapOf(serverA to "refresh-secret-0"))
    val harness = Harness(store, mutableSetOf(serverA))
    val server = FakeServer { _, _ -> 401 to "{}" }

    collect(harness, server, listOf(serverA))

    assertEquals(listOf<String?>(null), server.sentHeaders)
    assertTrue(harness.logs.isNotEmpty())
    assertFalse(harness.logs.any { "secret" in it || "https://" in it })
  }
}

class SingleFlightTest {
  @Test
  fun aThrowingStartSettlesEveryCaller() {
    val flight = SingleFlight<String, String>()
    val results = mutableListOf<String>()
    flight.run("k", "error", { throw IllegalStateException("boom") }) { results.add(it) }
    assertEquals(listOf("error"), results)
    assertFalse(flight.isRunning("k"))
  }

  @Test
  fun aThrowingCallerDoesNotBlockTheOthers() {
    val errors = mutableListOf<Exception>()
    val flight = SingleFlight<String, String>(onCallbackError = { errors.add(it) })
    var complete: ((String) -> Unit)? = null
    val results = mutableListOf<String>()
    assertTrue(flight.run("k", "error", { complete = it }) { throw IllegalStateException("caller") })
    assertFalse(flight.run("k", "error", { error("not started twice") }) { results.add(it) })
    complete!!("ok")
    complete!!("again")
    assertEquals(listOf("ok"), results)
    assertEquals(1, errors.size)
    assertFalse(flight.isRunning("k"))
  }

  @Test
  fun renewalActionRetriesWithANewerTokenAndOtherwiseRefreshes() {
    assertEquals(RenewalAction.RetryWith("access-2"), renewalAction("access-1", "access-2"))
    assertEquals(RenewalAction.Refresh, renewalAction("access-1", "access-1"))
    assertEquals(RenewalAction.Refresh, renewalAction("access-1", null))
    assertEquals(RenewalAction.Refresh, renewalAction("access-1", ""))
  }
}
