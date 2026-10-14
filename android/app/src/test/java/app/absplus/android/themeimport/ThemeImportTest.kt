package app.absplus.android.themeimport

import android.util.Base64
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.InetAddress

/**
 * RICE GitHub palette import (docs/rice-customization.md, "Linux palette import"): URL policy, address checks, the
 * dedicated client's redirect/limit/rate-limit/cancel behavior and the commit-pinned resolver. The GitHub API is a fake
 * served by an OkHttp interceptor (no network); repositories and files are synthetic.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ThemeImportTest {
  private fun reason(block: () -> Unit): String =
    try {
      block()
      "accepted"
    } catch (e: ImportPolicy.Rejected) {
      e.reason
    } catch (e: ImportFailure) {
      e.reason
    }

  // --- URL policy ---

  @Test
  fun acceptedGitHubUrlForms() {
    assertEquals(ImportPolicy.Target("owner", "repo", ImportPolicy.Kind.ROOT, emptyList()), ImportPolicy.parse("https://github.com/owner/repo"))
    assertEquals(ImportPolicy.Kind.ROOT, ImportPolicy.parse("https://github.com/owner/repo.git/").kind)
    assertEquals("repo", ImportPolicy.parse("https://github.com/owner/repo.git").repo)
    val blob = ImportPolicy.parse("https://github.com/owner/repo/blob/main/Colors/colors?raw=1")
    assertEquals(ImportPolicy.Kind.BLOB, blob.kind)
    assertEquals(listOf("main", "Colors", "colors"), blob.rest)
    assertEquals(ImportPolicy.Kind.TREE, ImportPolicy.parse("https://github.com/owner/repo/tree/main/themes").kind)
    assertEquals(ImportPolicy.Kind.RAW, ImportPolicy.parse("https://raw.githubusercontent.com/owner/repo/" + "a".repeat(40) + "/Colors/colors").kind)
  }

  @Test
  fun rejectedUrls() {
    val cases = mapOf(
      "http://github.com/owner/repo" to "not-https",
      "https://user:pass@github.com/owner/repo" to "credentials",
      "https://github.com:8443/owner/repo" to "port",
      "https://github.com.evil.example/owner/repo" to "host",
      "https://evilgithub.com/owner/repo" to "host",
      "https://gitlab.com/owner/repo" to "host",
      "https://127.0.0.1/owner/repo" to "host",
      "https://[::1]/owner/repo" to "port",
      "https://github.com/owner/repo/blob/main/%2e%2e/secret" to "encoded-path",
      "https://github.com/owner/repo/blob/main/a%252fb" to "encoded-path",
      "https://github.com/owner/repo/blob/main/../x" to "bad-path",
      "https://github.com/owner/repo/blob/main//x" to "bad-path",
      "https://github.com/owner/repo#readme" to "fragment",
      "https://github.com/owner/repo?tab=readme" to "query",
      "https://github.com/owner/repo/blob/main/colors?token=abc" to "query",
      "https://github.com/owner/repo/issues/1" to "unsupported-page",
      "https://githüb.com/owner/repo" to "bad-characters",
      "https://github.com/owner/repo\\x" to "bad-characters",
      "https://github.com/owner/re po" to "bad-characters",
      "https://www.pinterest.com/pin/773915517250387347/" to "pinterest",
      "https://github.com/owner" to "incomplete",
      "https://github.com/-bad/repo" to "bad-name",
      "https://github.com/owner/repo/blob/main" to "incomplete",
      "https://github.com/owner/repo/blob/" + "x/".repeat(10) + "y" to "path-too-deep"
    )
    for ((url, expected) in cases) assertEquals(url, expected, reason { ImportPolicy.splitRef(ImportPolicy.parse(url), null) })
    assertEquals("too-long", reason { ImportPolicy.parse("https://github.com/owner/" + "r".repeat(2100)) })
  }

  @Test
  fun refsAreNeverGuessed() {
    val target = ImportPolicy.parse("https://github.com/owner/repo/blob/feature/x/Colors/colors")
    assertEquals("feature" to listOf("x", "Colors", "colors"), ImportPolicy.splitRef(target, null))
    assertEquals("feature/x" to listOf("Colors", "colors"), ImportPolicy.splitRef(target, "feature/x"))
    assertEquals("ref-mismatch", reason { ImportPolicy.splitRef(target, "other") })
    assertEquals("bad-ref", reason { ImportPolicy.splitRef(target, "../x") })
    assertTrue(ImportPolicy.isCommit("0123456789abcdef0123456789abcdef01234567"))
  }

  @Test
  fun onlyGlobalUnicastAddresses() {
    val blocked = listOf("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.51.100.7", "203.0.113.9", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2001:db8::1", "ff02::1", "64:ff9b::a00:1", "2002:a00:1::1")
    for (address in blocked) assertFalse(address, ImportPolicy.isGlobalUnicast(InetAddress.getByName(address)))
    for (address in listOf("140.82.112.6", "8.8.8.8", "2606:50c0:8000::154", "::ffff:140.82.112.6")) assertTrue(address, ImportPolicy.isGlobalUnicast(InetAddress.getByName(address)))
  }

  @Test
  fun guardedDnsRejectsOtherHostsPrivateAnswersAndRebinding() {
    val public = GuardedDns { listOf(InetAddress.getByName("140.82.112.6")) }
    assertEquals(1, public.lookup("api.github.com").size)
    assertEquals("host", reason { public.lookup("github.com") })
    assertEquals("private-address", reason { GuardedDns { listOf(InetAddress.getByName("10.0.0.2")) }.lookup("api.github.com") })
    assertEquals("private-address", reason { GuardedDns { listOf(InetAddress.getByName("140.82.112.6"), InetAddress.getByName("127.0.0.1")) }.lookup("api.github.com") })
    assertEquals("private-address", reason { GuardedDns { emptyList() }.lookup("api.github.com") })
  }

  // --- Fake GitHub API ---

  private class FakeGitHub {
    val requests = mutableListOf<Request>()
    val routes = mutableMapOf<String, () -> Response.Builder>()

    fun json(path: String, body: Any, code: Int = 200) {
      routes[path] = { Response.Builder().code(code).message("x").body(body.toString().toResponseBody("application/json".toMediaType())) }
    }

    val client: OkHttpClient =
      OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
        val request = chain.request()
        requests.add(request)
        val route = routes[request.url.encodedPath] ?: { Response.Builder().code(404).message("nf").body("{}".toResponseBody(null)) }
        route().request(request).protocol(Protocol.HTTP_1_1).build()
      }).build()
  }

  private val commit = "1".repeat(40)
  private val tree = "2".repeat(40)
  private val colorsTree = "3".repeat(40)
  private val palette = "#172126\n#FF7D86\n#F5E9C8\n#FEBBA2\n"
  private val paletteSha = GitHubImporter.gitBlobSha(palette.toByteArray())

  private fun entry(path: String, mode: String, type: String, sha: String, size: Int = 10) = JSONObject().put("path", path).put("mode", mode).put("type", type).put("sha", sha).put("size", size)

  private fun repo(private: Boolean = false): FakeGitHub {
    val gh = FakeGitHub()
    gh.json("/repos/owner/dots", JSONObject().put("private", private).put("default_branch", "main"))
    gh.json("/repos/owner/dots/git/ref/heads/main", JSONObject().put("object", JSONObject().put("type", "commit").put("sha", commit)))
    gh.json("/repos/owner/dots/git/commits/$commit", JSONObject().put("sha", commit).put("tree", JSONObject().put("sha", tree)))
    gh.json(
      "/repos/owner/dots/git/trees/$tree",
      JSONObject().put("truncated", false).put(
        "tree",
        JSONArray()
          .put(entry("Colors", "040000", "tree", colorsTree))
          .put(entry("LICENSE", "100644", "blob", "4".repeat(40)))
          .put(entry("README.md", "100644", "blob", "5".repeat(40)))
          .put(entry("theme-link", "120000", "blob", "6".repeat(40)))
          .put(entry("vendor", "160000", "commit", "7".repeat(40)))
      )
    )
    gh.json(
      "/repos/owner/dots/git/trees/$colorsTree",
      JSONObject().put("truncated", false).put(
        "tree",
        JSONArray()
          .put(entry("colors", "100644", "blob", paletteSha, palette.length))
          .put(entry("install.sh", "100755", "blob", "8".repeat(40)))
          .put(entry("colors.json", "120000", "blob", "9".repeat(40)))
          .put(entry("wallpaper.png", "100644", "blob", "a".repeat(40), 9000))
      )
    )
    gh.json("/repos/owner/dots/git/blobs/$paletteSha", JSONObject().put("encoding", "base64").put("content", Base64.encodeToString(palette.toByteArray(), Base64.DEFAULT)))
    return gh
  }

  private fun importer(gh: FakeGitHub) = GitHubImporter(ThemeImportClient(gh.client, GuardedDns { listOf(InetAddress.getByName("140.82.112.6")) }))

  @Test
  fun repositoryRootFindsRegularPaletteFilesPinnedToOneCommit() {
    val gh = repo()
    val budget = ImportBudget()
    val resolved = importer(gh).resolve(ImportPolicy.parse("https://github.com/owner/dots"), null, budget)
    assertEquals(commit, resolved.commit)
    assertEquals(listOf("Colors/colors"), resolved.candidates.map { it.path }) // not the executable, symlink or image
    assertEquals("LICENSE", resolved.licensePath)
    val file = importer(gh).read(resolved, resolved.candidates.single(), budget)
    assertEquals(palette, file.text)
    assertEquals(64, file.sha256.length)
    // Every request went to the API host with fixed headers and no credentials
    for (r in gh.requests) {
      assertEquals("api.github.com", r.url.host)
      assertEquals("https", r.url.scheme)
      assertNull(r.header("Authorization"))
      assertNull(r.header("Cookie"))
      assertEquals("identity", r.header("Accept-Encoding"))
    }
  }

  @Test
  fun directBlobAndRawUrlsWalkOnlyTheNamedPath() {
    for (url in listOf("https://github.com/owner/dots/blob/main/Colors/colors", "https://raw.githubusercontent.com/owner/dots/$commit/Colors/colors")) {
      val gh = repo()
      val resolved = importer(gh).resolve(ImportPolicy.parse(url), null, ImportBudget())
      assertEquals(url, listOf("Colors/colors"), resolved.candidates.map { it.path })
    }
  }

  @Test
  fun symlinksExecutablesSubmodulesAndMissingPathsAreRefused() {
    fun direct(path: String) = reason { importer(repo()).resolve(ImportPolicy.parse("https://github.com/owner/dots/blob/main/$path"), null, ImportBudget()) }
    assertEquals("symlink", direct("theme-link"))
    assertEquals("symlink", direct("Colors/colors.json"))
    assertEquals("executable", direct("Colors/install.sh"))
    assertEquals("submodule", direct("vendor"))
    assertEquals("path-not-found", direct("Colors/nope"))
    assertEquals("not-a-directory", direct("README.md/x"))
  }

  @Test
  fun privateReposUnknownRefsAndTruncatedTreesFailClearly() {
    assertEquals("not-public", reason { importer(repo(private = true)).resolve(ImportPolicy.parse("https://github.com/owner/dots"), null, ImportBudget()) })
    assertEquals("ref-not-found", reason { importer(repo()).resolve(ImportPolicy.parse("https://github.com/owner/dots/blob/nope/Colors/colors"), null, ImportBudget()) })
    val truncated = repo().also { it.json("/repos/owner/dots/git/trees/$tree", JSONObject().put("truncated", true).put("tree", JSONArray())) }
    assertEquals("tree-truncated", reason { importer(truncated).resolve(ImportPolicy.parse("https://github.com/owner/dots"), null, ImportBudget()) })
  }

  @Test
  fun annotatedTagsResolveToTheirCommit() {
    val gh = repo()
    val tagSha = "c".repeat(40)
    gh.json("/repos/owner/dots/git/ref/tags/v1", JSONObject().put("object", JSONObject().put("type", "tag").put("sha", tagSha)))
    gh.json("/repos/owner/dots/git/tags/$tagSha", JSONObject().put("object", JSONObject().put("type", "commit").put("sha", commit)))
    assertEquals(commit, importer(gh).resolve(ImportPolicy.parse("https://github.com/owner/dots/blob/v1/Colors/colors"), null, ImportBudget()).commit)
  }

  @Test
  fun blobsAreVerifiedAgainstTheirGitIdAndMustBeUtf8Text() {
    val gh = repo()
    val budget = ImportBudget()
    val resolved = importer(gh).resolve(ImportPolicy.parse("https://github.com/owner/dots"), null, budget)
    gh.json("/repos/owner/dots/git/blobs/$paletteSha", JSONObject().put("encoding", "base64").put("content", Base64.encodeToString("#000000\n#FFFFFF\n".toByteArray(), Base64.DEFAULT)))
    assertEquals("integrity", reason { importer(gh).read(resolved, resolved.candidates.single(), budget) })
    val bad = byteArrayOf(0xC3.toByte(), 0x28)
    val badSha = GitHubImporter.gitBlobSha(bad)
    gh.json("/repos/owner/dots/git/blobs/$badSha", JSONObject().put("encoding", "base64").put("content", Base64.encodeToString(bad, Base64.DEFAULT)))
    assertEquals("not-utf8", reason { importer(gh).read(resolved, GitHubImporter.Candidate("c9", "x", badSha, 2), budget) })
    val lfs = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n".toByteArray()
    val lfsSha = GitHubImporter.gitBlobSha(lfs)
    gh.json("/repos/owner/dots/git/blobs/$lfsSha", JSONObject().put("encoding", "base64").put("content", Base64.encodeToString(lfs, Base64.DEFAULT)))
    assertEquals("lfs-pointer", reason { importer(gh).read(resolved, GitHubImporter.Candidate("c8", "x", lfsSha, lfs.size), budget) })
  }

  // --- Client limits ---

  private fun client(gh: FakeGitHub) = ThemeImportClient(gh.client, GuardedDns { listOf(InetAddress.getByName("140.82.112.6")) })

  @Test
  fun redirectsStayOnTheApiHostAndAreBounded() {
    val gh = FakeGitHub()
    gh.routes["/repos/old/name"] = { Response.Builder().code(301).message("moved").header("Location", "https://api.github.com/repositories/42").body("".toResponseBody(null)) }
    gh.json("/repositories/42", JSONObject().put("ok", true))
    assertEquals("{\"ok\":true}", String(client(gh).get(listOf("repos", "old", "name"), 1000, ImportBudget())))
    gh.routes["/repos/evil/redirect"] = { Response.Builder().code(302).message("x").header("Location", "https://evil.example/x").body("".toResponseBody(null)) }
    assertEquals("redirect-host", reason { client(gh).get(listOf("repos", "evil", "redirect"), 1000, ImportBudget()) })
    gh.routes["/repos/loop/a"] = { Response.Builder().code(307).message("x").header("Location", "https://api.github.com/repos/loop/a").body("".toResponseBody(null)) }
    assertEquals("redirects", reason { client(gh).get(listOf("repos", "loop", "a"), 1000, ImportBudget()) })
    gh.routes["/repos/creds/a"] = { Response.Builder().code(302).message("x").header("Location", "https://u:p@api.github.com/repos/x/y").body("".toResponseBody(null)) }
    assertEquals("redirect-host", reason { client(gh).get(listOf("repos", "creds", "a"), 1000, ImportBudget()) })
  }

  @Test
  fun sizeCompressionRateLimitsAndBudgetsAreEnforced() {
    val gh = FakeGitHub()
    gh.json("/repos/big/body", "x".repeat(5000))
    assertEquals("too-large", reason { client(gh).get(listOf("repos", "big", "body"), 1000, ImportBudget()) })
    gh.routes["/repos/zip/body"] = { Response.Builder().code(200).message("ok").header("Content-Encoding", "gzip").body("x".toResponseBody(null)) }
    assertEquals("compressed", reason { client(gh).get(listOf("repos", "zip", "body"), 1000, ImportBudget()) })
    gh.routes["/repos/rate/limited"] = { Response.Builder().code(403).message("x").header("X-RateLimit-Remaining", "0").header("Retry-After", "120").body("{}".toResponseBody(null)) }
    val limited = try {
      client(gh).get(listOf("repos", "rate", "limited"), 1000, ImportBudget())
      null
    } catch (e: ImportFailure) {
      e
    }
    assertEquals("rate-limited", limited!!.reason)
    assertEquals(120L, limited.retryAfterSeconds)
    gh.json("/repos/many/calls", JSONObject())
    val budget = ImportBudget()
    repeat(ImportPolicy.MAX_REQUESTS) { client(gh).get(listOf("repos", "many", "calls"), 1000, budget) }
    assertEquals("request-budget", reason { client(gh).get(listOf("repos", "many", "calls"), 1000, budget) })
    val total = ImportBudget()
    gh.json("/repos/half/meg", "y".repeat(600 * 1024))
    client(gh).get(listOf("repos", "half", "meg"), 700 * 1024, total)
    assertEquals("byte-budget", reason { client(gh).get(listOf("repos", "half", "meg"), 700 * 1024, total) })
  }

  @Test
  fun aCanceledSessionMakesNoFurtherRequests() {
    val gh = repo()
    val budget = ImportBudget()
    budget.cancel()
    assertEquals("canceled", reason { importer(gh).resolve(ImportPolicy.parse("https://github.com/owner/dots"), null, budget) })
    assertTrue(gh.requests.isEmpty())
  }

  @Test
  fun theNetworkPhaseIsTimeBounded() {
    var now = 0L
    val gh = FakeGitHub().also { it.json("/repos/slow/x", JSONObject()) }
    val budget = ImportBudget { now.also { now += 16_000 } }
    try {
      client(gh).get(listOf("repos", "slow", "x"), 1000, budget)
      client(gh).get(listOf("repos", "slow", "x"), 1000, budget)
      fail("expected time budget")
    } catch (e: ImportFailure) {
      assertEquals("time-budget", e.reason)
    }
  }

  @Test
  fun paletteFileNameHints() {
    assertTrue(GitHubImporter.looksLikePalette("colors", true))
    assertTrue(GitHubImporter.looksLikePalette("theme.conf", false))
    assertTrue(GitHubImporter.looksLikePalette("base16-ocean.yaml", false))
    assertFalse(GitHubImporter.looksLikePalette("install.sh", true))
    assertFalse(GitHubImporter.looksLikePalette("wallpaper.png", true))
    assertFalse(GitHubImporter.looksLikePalette("README.md", false))
  }
}
