package app.absplus.android.updater

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseSelectorTest {
  private val mapper = ObjectMapper()
  private val src = UpdateSource.Production
  private val tag = "v0.14.2-beta-plus-v0.17.0"
  private val base = "https://github.com/ADD-OCD/audiobookshelfplus-app/releases/download/$tag/"
  private val digest = "5db2ed02ecabbd3a119094e12cb2b944aa97981d83b0bda77adcd35886dde5a8"

  private fun apkAsset(name: String = "audiobookshelf-plus-v0.17.0-release.apk") = mapper.createObjectNode().apply {
    put("name", name); put("content_type", "application/vnd.android.package-archive"); put("state", "uploaded")
    put("size", 15_007_956L); put("digest", "sha256:$digest"); put("browser_download_url", base + name)
  }

  private fun checksumAsset(name: String = "audiobookshelf-plus-v0.17.0-release.apk.sha256") = mapper.createObjectNode().apply {
    put("name", name); put("content_type", "application/octet-stream"); put("state", "uploaded"); put("size", 106)
    put("digest", "sha256:beb85d6ec0fb794179c88d4e3294822d726d258fe436a145ff110a21bc406e25"); put("browser_download_url", base + name)
  }

  private fun release(edit: ObjectNode.() -> Unit = {}): String = mapper.createObjectNode().apply {
    put("tag_name", tag); put("name", "Audiobookshelf+ v0.17.0 (upstream v0.14.2-beta)"); put("draft", false); put("prerelease", false)
    put("html_url", "https://github.com/ADD-OCD/audiobookshelfplus-app/releases/tag/$tag"); put("published_at", "2026-11-01T10:00:00Z")
    put("body", "# Audiobookshelf+ v0.17.0\n\nAn **unofficial** Android fork. This release adds [in-app updates](https://example.com).\n\n**Install:** download")
    putArray("assets").add(apkAsset()).add(checksumAsset())
    edit()
  }.toString()

  private fun rejected(json: String) = ReleaseSelector.select(json, src) as SelectResult.Rejected

  @Test
  fun selectsTheReleaseApkAndChecksumOfALatestStableRelease() {
    val c = (ReleaseSelector.select(release(), src) as SelectResult.Found).candidate
    assertEquals(PlusVersion(0, 17, 0), c.version)
    assertEquals("audiobookshelf-plus-v0.17.0-release.apk", c.apk.name)
    assertEquals(15_007_956L, c.apk.size)
    assertEquals(digest, c.apk.sha256)
    assertEquals("audiobookshelf-plus-v0.17.0-release.apk.sha256", c.checksumAsset!!.name)
    assertEquals("An unofficial Android fork. This release adds in-app updates.", c.summary)
  }

  @Test
  fun theRealV0160ResponseShapeIsAccepted() {
    val json = """{"url":"x","html_url":"https://github.com/ADD-OCD/audiobookshelfplus-app/releases/tag/v0.14.2-beta-plus-v0.16.0","id":1,"tag_name":"v0.14.2-beta-plus-v0.16.0","target_commitish":"plus","name":"Audiobookshelf+ v0.16.0 (upstream v0.14.2-beta)","draft":false,"immutable":false,"prerelease":false,"published_at":"2026-10-11T19:23:50Z","assets":[{"name":"audiobookshelf-plus-v0.16.0-release.apk","content_type":"application/vnd.android.package-archive","state":"uploaded","size":15007956,"digest":"sha256:$digest","browser_download_url":"https://github.com/ADD-OCD/audiobookshelfplus-app/releases/download/v0.14.2-beta-plus-v0.16.0/audiobookshelf-plus-v0.16.0-release.apk"},{"name":"audiobookshelf-plus-v0.16.0-release.apk.sha256","content_type":"application/octet-stream","state":"uploaded","size":106,"digest":"sha256:beb85d6ec0fb794179c88d4e3294822d726d258fe436a145ff110a21bc406e25","browser_download_url":"https://github.com/ADD-OCD/audiobookshelfplus-app/releases/download/v0.14.2-beta-plus-v0.16.0/audiobookshelf-plus-v0.16.0-release.apk.sha256"}],"body":"# x"}"""
    assertEquals(PlusVersion(0, 16, 0), (ReleaseSelector.select(json, src) as SelectResult.Found).candidate.version)
  }

  @Test
  fun draftsPrereleasesAndDeviceTestReleasesAreNotStable() {
    assertEquals(UpdateErrorCode.NOT_STABLE, rejected(release { put("draft", true) }).code)
    assertEquals(UpdateErrorCode.NOT_STABLE, rejected(release { put("prerelease", true) }).code)
    assertEquals(UpdateErrorCode.NOT_STABLE, rejected(release { put("tag_name", "playback-diagnostics-device-test-v129") }).code)
    assertEquals(UpdateErrorCode.NOT_STABLE, rejected(release { put("tag_name", "v0.17.0") }).code)
    assertEquals(UpdateErrorCode.MALFORMED, rejected(release { remove("prerelease") }).code)
    assertEquals(UpdateErrorCode.MALFORMED, rejected(release { put("draft", "false") }).code)
  }

  @Test
  fun invalidOrUnexpectedMetadataIsMalformed() {
    assertEquals(UpdateErrorCode.MALFORMED, rejected("<html>rate limited</html>").code)
    assertEquals(UpdateErrorCode.MALFORMED, rejected("[]").code)
    assertEquals(UpdateErrorCode.MALFORMED, rejected("").code)
    assertEquals(UpdateErrorCode.MALFORMED, rejected(release { remove("tag_name") }).code)
    assertEquals(UpdateErrorCode.MALFORMED, rejected(release { put("assets", "none") }).code)
  }

  @Test
  fun missingDebugOnlyAndAmbiguousApksAreRejected() {
    assertEquals(UpdateErrorCode.NO_APK, rejected(release { putArray("assets") }).code)
    assertEquals(UpdateErrorCode.NO_APK, rejected(release { putArray("assets").add(apkAsset("audiobookshelf-plus-v0.17.0-debug.apk")).add(apkAsset("app-release.apk")) }).code)
    assertEquals(UpdateErrorCode.AMBIGUOUS_APK, rejected(release { (get("assets") as ArrayNode).add(apkAsset()) }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(release { putArray("assets").add(apkAsset("audiobookshelf-plus-v0.16.0-release.apk")) }).code)
    // Unrelated attachments are ignored
    val withExtras = release { (get("assets") as ArrayNode).add(apkAsset("audiobookshelf-plus-v0.17.0-debug.apk")).add(checksumAsset("notes.txt")) }
    assertTrue(ReleaseSelector.select(withExtras, src) is SelectResult.Found)
  }

  @Test
  fun assetMetadataMustDescribeAPlausibleUploadedApk() {
    fun withApk(edit: ObjectNode.() -> Unit) = release { putArray("assets").add(apkAsset().apply(edit)) }
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("content_type", "text/html") }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("state", "starter") }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("size", 0) }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("size", 999_999) }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("size", 200_000_001L) }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { remove("size") }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("digest", "md5:abc") }).code)
    assertNull((ReleaseSelector.select(withApk { remove("digest") }, src) as SelectResult.Found).candidate.apk.sha256)
  }

  @Test
  fun downloadAndReleaseUrlsMustBeTheOfficialOnes() {
    fun withApk(edit: ObjectNode.() -> Unit) = release { putArray("assets").add(apkAsset().apply(edit)) }
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("browser_download_url", "https://github.com/someone/fork/releases/download/$tag/audiobookshelf-plus-v0.17.0-release.apk") }).code)
    assertEquals(UpdateErrorCode.BAD_ASSET, rejected(withApk { put("browser_download_url", "https://evil.example/audiobookshelf-plus-v0.17.0-release.apk") }).code)
    assertEquals(UpdateErrorCode.UNTRUSTED_URL, rejected(withApk { put("browser_download_url", base + "other/audiobookshelf-plus-v0.17.0-release.apk") }).code)
    assertEquals(UpdateErrorCode.UNTRUSTED_URL, rejected(release { put("html_url", "https://github.com/someone/fork/releases/tag/$tag") }).code)
    assertEquals(UpdateErrorCode.AMBIGUOUS_APK, rejected(release { (get("assets") as ArrayNode).add(checksumAsset()) }).code)
  }

  @Test
  fun versionsCompareNumericallyNotAsText() {
    assertTrue(PlusVersion.parse("v0.10.0")!! > PlusVersion.parse("v0.9.0")!!)
    assertTrue(PlusVersion.parse("1.0.0")!! > PlusVersion.parse("0.99.99")!!)
    assertTrue(PlusVersion.parse("0.17.0")!! > PlusVersion.parse("0.16.12")!!)
    assertEquals(0, PlusVersion.parse("v0.16.0")!!.compareTo(PlusVersion.parse("0.16.0")!!))
    assertNull(PlusVersion.parse("0.16"))
    assertNull(PlusVersion.parse("0.16.0-beta"))
    assertNull(PlusVersion.parse(null))
  }

  @Test
  fun onlyHttpsToTheAllowedHostsIsAllowed() {
    assertTrue(ReleaseSelector.isAllowedUrl("https://github.com/x", src))
    assertTrue(ReleaseSelector.isAllowedUrl("https://release-assets.githubusercontent.com/a?b=c", src))
    assertFalse(ReleaseSelector.isAllowedUrl("http://github.com/x", src))
    assertFalse(ReleaseSelector.isAllowedUrl("https://github.com.evil.example/x", src))
    assertFalse(ReleaseSelector.isAllowedUrl("https://user:pw@github.com/x", src))
    assertFalse(ReleaseSelector.isAllowedUrl("https://github.com:8443/x", src))
    assertFalse(ReleaseSelector.isAllowedUrl("http://127.0.0.1:8080/x", src))
    assertFalse(ReleaseSelector.isAllowedUrl("file:///data/x.apk", src))
    assertFalse(ReleaseSelector.isAllowedUrl("not a url", src))
    val test = src.copy(allowedHosts = setOf("127.0.0.1"), allowCleartextLoopback = true)
    assertTrue(ReleaseSelector.isAllowedUrl("http://127.0.0.1:18765/x", test))
    assertFalse(ReleaseSelector.isAllowedUrl("http://10.0.0.2/x", test))
  }
}
