package app.absplus.android.updater

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI

/** An Audiobookshelf+ public version (the "v0.16.0" in a release tag), compared numerically */
data class PlusVersion(val major: Int, val minor: Int, val patch: Int) : Comparable<PlusVersion> {
  override fun compareTo(other: PlusVersion): Int = compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch })
  override fun toString() = "$major.$minor.$patch"

  companion object {
    private val REGEX = Regex("^v?(\\d{1,4})\\.(\\d{1,4})\\.(\\d{1,4})$")
    fun parse(text: String?): PlusVersion? {
      val m = REGEX.matchEntire(text?.trim() ?: return null) ?: return null
      return PlusVersion(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
    }
  }
}

data class ReleaseAsset(
  val name: String,
  val size: Long,
  /** Lowercase hex SHA-256 from GitHub's asset metadata, when GitHub provides it */
  val sha256: String?,
  val downloadUrl: String
)

data class UpdateCandidate(
  val tag: String,
  val version: PlusVersion,
  val title: String,
  val releaseUrl: String,
  val publishedAt: String?,
  val summary: String,
  val apk: ReleaseAsset,
  /** The release's "<apk>.sha256" file, when present; checked against the APK as a second published digest */
  val checksumAsset: ReleaseAsset?
)

enum class UpdateErrorCode {
  NETWORK, TIMEOUT, TLS, RATE_LIMITED, GITHUB_ERROR, NO_RELEASE, MALFORMED, NOT_STABLE, NO_APK, AMBIGUOUS_APK, BAD_ASSET,
  UNTRUSTED_URL, UNEXPECTED_CONTENT, SIZE_MISMATCH, DIGEST_MISMATCH, STORAGE, CANCELLED, INVALID_APK, WRONG_PACKAGE,
  NOT_NEWER, DEBUGGABLE, UNSIGNED, UNTRUSTED_SIGNER, MULTIPLE_SIGNERS, PERMISSION_REQUIRED, INSTALL_FAILED,
  INSTALL_BLOCKED, UNSUPPORTED, BUSY
}

class UpdateException(val code: UpdateErrorCode, message: String) : Exception(message)

sealed class SelectResult {
  data class Found(val candidate: UpdateCandidate) : SelectResult()
  data class Rejected(val code: UpdateErrorCode, val detail: String) : SelectResult()
}

/**
 * Picks the production APK of the latest stable release from a GitHub "get the latest release" response.
 *
 * GitHub's /releases/latest already leaves out drafts and prereleases; the flags are checked again anyway. The tag
 * must be an Audiobookshelf+ release tag (`v<upstream>-plus-vX.Y.Z`), which also leaves out the temporary device-test
 * releases. Exactly one asset may be named `audiobookshelf-plus-vX.Y.Z-release.apk` for the tag's version; it must be an
 * uploaded APK of a plausible size whose download URL is exactly the official one for this tag. Names alone prove
 * nothing: the downloaded file is still verified (size, digests, package, version code, signing certificate).
 */
object ReleaseSelector {
  private val TAG = Regex("^v\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}(?:-[0-9A-Za-z]+(?:\\.[0-9A-Za-z]+)*)?-plus-v(\\d{1,4}\\.\\d{1,4}\\.\\d{1,4})$")
  private val APK = Regex("^audiobookshelf-plus-v(\\d{1,4}\\.\\d{1,4}\\.\\d{1,4})-release\\.apk$")
  private val DIGEST = Regex("^sha256:([0-9a-f]{64})$")
  private val APK_TYPES = setOf("application/vnd.android.package-archive", "application/octet-stream")
  const val MIN_APK_BYTES = 1_000_000L
  const val MAX_APK_BYTES = 200_000_000L
  const val MAX_CHECKSUM_BYTES = 1024L
  private const val SUMMARY_CHARS = 240

  private val mapper = ObjectMapper()

  fun select(json: String, source: UpdateSource): SelectResult {
    val root = try {
      mapper.readTree(json)
    } catch (e: Exception) {
      null
    }
    if (root == null || !root.isObject) return SelectResult.Rejected(UpdateErrorCode.MALFORMED, "response is not a JSON object")
    val draft = root.get("draft")
    val prerelease = root.get("prerelease")
    if (draft?.isBoolean != true || prerelease?.isBoolean != true) return SelectResult.Rejected(UpdateErrorCode.MALFORMED, "release flags missing")
    if (draft.booleanValue() || prerelease.booleanValue()) return SelectResult.Rejected(UpdateErrorCode.NOT_STABLE, "draft or prerelease")

    val tag = text(root, "tag_name") ?: return SelectResult.Rejected(UpdateErrorCode.MALFORMED, "tag missing")
    val tagMatch = TAG.matchEntire(tag) ?: return SelectResult.Rejected(UpdateErrorCode.NOT_STABLE, "not an Audiobookshelf+ release tag")
    val version = PlusVersion.parse(tagMatch.groupValues[1]) ?: return SelectResult.Rejected(UpdateErrorCode.MALFORMED, "tag version")

    val releaseUrl = text(root, "html_url")
    if (releaseUrl == null || releaseUrl != source.releasePagePrefix + tag) return SelectResult.Rejected(UpdateErrorCode.UNTRUSTED_URL, "release page is not the official one")

    val assets = root.get("assets")
    if (assets == null || !assets.isArray) return SelectResult.Rejected(UpdateErrorCode.MALFORMED, "assets missing")
    val apkAssets = assets.filter { a -> text(a, "name")?.let { APK.matches(it) } == true }
    if (apkAssets.isEmpty()) return SelectResult.Rejected(UpdateErrorCode.NO_APK, "no release APK")
    if (apkAssets.size > 1) return SelectResult.Rejected(UpdateErrorCode.AMBIGUOUS_APK, "${apkAssets.size} release APKs")
    val apkNode = apkAssets[0]
    val apkName = text(apkNode, "name")!!
    if (APK.matchEntire(apkName)!!.groupValues[1] != version.toString()) return SelectResult.Rejected(UpdateErrorCode.BAD_ASSET, "APK version differs from the tag")
    val apk = asset(apkNode, tag, source, MIN_APK_BYTES, MAX_APK_BYTES, requireApkType = true)
      ?: return SelectResult.Rejected(UpdateErrorCode.BAD_ASSET, "APK asset metadata")
    if (apk.downloadUrl != source.downloadUrlPrefix + tag + "/" + apkName) return SelectResult.Rejected(UpdateErrorCode.UNTRUSTED_URL, "APK download URL is not the official one")

    val checksumNodes = assets.filter { text(it, "name") == "$apkName.sha256" }
    if (checksumNodes.size > 1) return SelectResult.Rejected(UpdateErrorCode.AMBIGUOUS_APK, "several checksum files")
    val checksum = checksumNodes.firstOrNull()?.let {
      asset(it, tag, source, 64, MAX_CHECKSUM_BYTES, requireApkType = false)
        ?: return SelectResult.Rejected(UpdateErrorCode.BAD_ASSET, "checksum asset metadata")
    }
    if (checksum != null && checksum.downloadUrl != source.downloadUrlPrefix + tag + "/" + checksum.name) return SelectResult.Rejected(UpdateErrorCode.UNTRUSTED_URL, "checksum URL is not the official one")

    return SelectResult.Found(
      UpdateCandidate(
        tag = tag,
        version = version,
        title = (text(root, "name") ?: "Audiobookshelf+ v$version").take(120),
        releaseUrl = releaseUrl,
        publishedAt = text(root, "published_at"),
        summary = summary(text(root, "body")),
        apk = apk,
        checksumAsset = checksum
      )
    )
  }

  private fun asset(node: JsonNode, tag: String, source: UpdateSource, minBytes: Long, maxBytes: Long, requireApkType: Boolean): ReleaseAsset? {
    val name = text(node, "name") ?: return null
    if (text(node, "state") != "uploaded") return null
    val type = text(node, "content_type")?.lowercase()
    if (requireApkType && type !in APK_TYPES) return null
    val sizeNode = node.get("size")
    if (sizeNode == null || !sizeNode.canConvertToLong()) return null
    val size = sizeNode.asLong()
    if (size < minBytes || size > maxBytes) return null
    val digestText = text(node, "digest")
    val sha256 = if (digestText == null) null else DIGEST.matchEntire(digestText.lowercase())?.groupValues?.get(1) ?: return null
    val url = text(node, "browser_download_url") ?: return null
    if (!url.startsWith(source.downloadUrlPrefix + tag + "/")) return null
    return ReleaseAsset(name, size, sha256, url)
  }

  private fun text(node: JsonNode, field: String): String? = node.get(field)?.takeIf { it.isTextual }?.textValue()?.takeIf { it.isNotBlank() }

  /** The first paragraph of the release notes as plain text (no Markdown, no links), shortened */
  fun summary(body: String?): String {
    if (body.isNullOrBlank()) return ""
    val paragraph = body.replace("\r\n", "\n").split(Regex("\n\\s*\n")).map { it.trim() }.firstOrNull { p ->
      p.isNotEmpty() && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("**Install") && !p.startsWith("**Checksum")
    } ?: return ""
    val plain = paragraph
      .replace(Regex("!?\\[([^\\]]*)]\\([^)]*\\)"), "$1")
      .replace(Regex("[*_`>#]"), "")
      .replace(Regex("<[^>]*>"), "")
      .replace(Regex("\\s+"), " ")
      .trim()
    return if (plain.length <= SUMMARY_CHARS) plain else plain.take(SUMMARY_CHARS - 1).trimEnd() + "…"
  }

  /** True when [url] is an https (or, for test sources, loopback http) URL to an allowed host, without credentials */
  fun isAllowedUrl(url: String, source: UpdateSource): Boolean {
    val uri = try {
      URI(url)
    } catch (e: Exception) {
      return false
    }
    val host = uri.host?.lowercase() ?: return false
    if (uri.rawUserInfo != null) return false
    return when (uri.scheme?.lowercase()) {
      "https" -> host in source.allowedHosts && (uri.port == -1 || uri.port == 443)
      "http" -> source.allowCleartextLoopback && (host == "127.0.0.1" || host == "localhost") && host in source.allowedHosts
      else -> false
    }
  }
}
