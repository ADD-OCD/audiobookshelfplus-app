package app.absplus.android.themeimport

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/**
 * Fixed rules for RICE "Import theme colors" (docs/rice-customization.md, "Linux palette import"). Everything the
 * importer may contact or accept is decided here: one API host, typed GitHub URLs, global-unicast addresses only, and
 * conservative budgets. Nothing in a downloaded file can add hosts, URLs or requests.
 */
object ImportPolicy {
  const val API_HOST = "api.github.com"
  const val MAX_URL_BYTES = 2048
  const val MAX_REQUESTS = 24
  const val MAX_REDIRECTS = 2
  const val MAX_TREE_RESPONSES = 8
  const val MAX_DEPTH = 4
  const val MAX_PATH_COMPONENTS = 8
  const val MAX_CANDIDATES = 32
  const val MAX_SELECTED_FILES = 4
  const val MAX_TREE_BYTES = 256 * 1024
  const val MAX_TREE_ENTRIES = 2000
  const val MAX_PALETTE_BYTES = 64 * 1024
  const val MAX_BLOB_RESPONSE_BYTES = 100 * 1024
  const val MAX_METADATA_BYTES = 64 * 1024
  const val MAX_SESSION_BYTES = 1024 * 1024
  const val CONNECT_TIMEOUT_MS = 5_000L
  const val READ_TIMEOUT_MS = 5_000L
  const val CALL_TIMEOUT_MS = 10_000L
  const val NETWORK_PHASE_MS = 30_000L
  const val SESSION_IDLE_MS = 5 * 60_000L

  private val NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
  private val REF_SEGMENT = Regex("^[A-Za-z0-9._-]{1,100}$")
  private val COMMIT = Regex("^[0-9a-f]{40}$")
  private val SEGMENT = Regex("^[A-Za-z0-9._+@=,~() -]{1,255}$")

  enum class Kind { ROOT, BLOB, TREE, RAW }

  /** A validated GitHub location. [rest] is the URL path after the kind marker: ref segments followed by the path. */
  data class Target(val owner: String, val repo: String, val kind: Kind, val rest: List<String>)

  class Rejected(val reason: String) : Exception(reason)

  /**
   * Parses a pasted URL into a [Target], or throws [Rejected] with a reason code the UI explains. Only
   * https://github.com/OWNER/REPO[.git][/blob|/tree/REF/PATH] and https://raw.githubusercontent.com/OWNER/REPO/REF/PATH.
   */
  fun parse(input: String): Target {
    val url = input.trim()
    if (url.isEmpty() || url.toByteArray(Charsets.UTF_8).size > MAX_URL_BYTES) throw Rejected("too-long")
    if (url.any { it.code < 0x21 || it.code == 0x7F || it == '\\' }) throw Rejected("bad-characters")
    if (url.any { it.code > 0x7E }) throw Rejected("bad-characters") // no Unicode look-alikes or unescaped text
    if (url.startsWith("https://www.pinterest.") || url.startsWith("https://pinterest.") || url.startsWith("https://pin.it/")) throw Rejected("pinterest")
    if (!url.startsWith("https://")) throw Rejected("not-https")
    val afterScheme = url.removePrefix("https://")
    val authorityEnd = afterScheme.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) afterScheme.length else it }
    val authority = afterScheme.substring(0, authorityEnd)
    if ('@' in authority) throw Rejected("credentials")
    if (':' in authority) throw Rejected("port")
    var remainder = afterScheme.substring(authorityEnd)
    if ('#' in remainder) throw Rejected("fragment")
    val queryAt = remainder.indexOf('?')
    var query: String? = null
    if (queryAt >= 0) {
      query = remainder.substring(queryAt + 1)
      remainder = remainder.substring(0, queryAt)
    }
    if ('%' in remainder) throw Rejected("encoded-path") // no encoded separators, traversal or double encoding
    val segments = remainder.trim('/').split('/').filter { it.isNotEmpty() }
    if (remainder.contains("//")) throw Rejected("bad-path")
    if (segments.any { it == "." || it == ".." || !SEGMENT.matches(it) }) throw Rejected("bad-path")
    return when (authority.lowercase()) {
      "github.com" -> github(segments, query)
      "raw.githubusercontent.com" -> {
        if (query != null) throw Rejected("query")
        if (segments.size < 4) throw Rejected("incomplete")
        Target(name(segments[0]), name(segments[1]), Kind.RAW, segments.drop(2))
      }
      else -> throw Rejected("host")
    }
  }

  private fun github(segments: List<String>, query: String?): Target {
    if (segments.size < 2) throw Rejected("incomplete")
    val owner = name(segments[0])
    val repo = name(segments[1].removeSuffix(".git"))
    if (segments.size == 2) {
      if (query != null) throw Rejected("query")
      return Target(owner, repo, Kind.ROOT, emptyList())
    }
    val kind =
      when (segments[2]) {
        "blob" -> Kind.BLOB
        "tree" -> Kind.TREE
        else -> throw Rejected("unsupported-page")
      }
    // A GitHub page link may carry ?raw=1/true (UI only); anything else is rejected
    if (query != null && !(kind == Kind.BLOB && (query == "raw=1" || query == "raw=true"))) throw Rejected("query")
    if (segments.size < 4 || (kind == Kind.BLOB && segments.size < 5)) throw Rejected("incomplete")
    return Target(owner, repo, kind, segments.drop(3))
  }

  private fun name(value: String): String = if (NAME.matches(value)) value else throw Rejected("bad-name")

  /** Ref + path split. With an explicit ref (which may contain '/'), the URL must start with it; otherwise the first segment is the ref. */
  fun splitRef(target: Target, explicitRef: String?): Pair<String?, List<String>> {
    if (target.kind == Kind.ROOT) return (explicitRef?.let { validRef(it) }) to emptyList()
    if (explicitRef != null) {
      val refSegments = validRef(explicitRef).split('/')
      if (target.rest.size < refSegments.size || target.rest.subList(0, refSegments.size) != refSegments) throw Rejected("ref-mismatch")
      return explicitRef to target.rest.drop(refSegments.size).also { checkPath(it, target.kind) }
    }
    val ref = target.rest.first()
    if (!REF_SEGMENT.matches(ref)) throw Rejected("bad-ref")
    return ref to target.rest.drop(1).also { checkPath(it, target.kind) }
  }

  private fun checkPath(path: List<String>, kind: Kind) {
    if (path.size > MAX_PATH_COMPONENTS) throw Rejected("path-too-deep")
    if ((kind == Kind.BLOB || kind == Kind.RAW) && path.isEmpty()) throw Rejected("incomplete")
  }

  fun validRef(ref: String): String {
    val parts = ref.split('/')
    if (ref.length > 200 || parts.size > MAX_PATH_COMPONENTS || parts.any { !REF_SEGMENT.matches(it) || it == "." || it == ".." }) throw Rejected("bad-ref")
    return ref
  }

  fun isCommit(ref: String) = COMMIT.matches(ref)

  /**
   * True only for public (global unicast) addresses: loopback, private, link-local, multicast, unspecified,
   * carrier-grade NAT, documentation/benchmark/reserved ranges, IPv6 unique-local and IPv4-mapped/compatible forms are
   * all refused.
   */
  fun isGlobalUnicast(address: InetAddress): Boolean {
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
    val b = address.address.map { it.toInt() and 0xFF }
    if (address is Inet4Address) return ipv4Global(b)
    if (address is Inet6Address) {
      // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded IPv4 address
      if (b.subList(0, 10).all { it == 0 } && ((b[10] == 0xFF && b[11] == 0xFF) || (b[10] == 0 && b[11] == 0))) return ipv4Global(b.subList(12, 16))
      if ((b[0] and 0xFE) == 0xFC) return false // fc00::/7 unique local
      if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0D && b[3] == 0xB8) return false // 2001:db8::/32 documentation
      if (b[0] == 0x20 && b[1] == 0x02) return false // 2002::/16 6to4 (embeds arbitrary IPv4)
      if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0 && b[3] == 0) return false // 2001::/32 Teredo
      if (b[0] == 0 && b[1] == 0x64 && b[2] == 0xFF && b[3] == 0x9B) return false // 64:ff9b::/96 NAT64
      return (b[0] and 0xE0) == 0x20 // 2000::/3 global unicast only
    }
    return false
  }

  private fun ipv4Global(b: List<Int>): Boolean {
    val (a, c) = b[0] to b[1]
    return when {
      a == 0 || a == 10 || a == 127 || a >= 224 -> false
      a == 100 && c in 64..127 -> false // carrier-grade NAT
      a == 169 && c == 254 -> false
      a == 172 && c in 16..31 -> false
      a == 192 && c == 168 -> false
      a == 192 && c == 0 && b[2] in setOf(0, 2) -> false // IETF protocol assignments, TEST-NET-1
      a == 198 && (c == 18 || c == 19) -> false // benchmarking
      a == 198 && c == 51 && b[2] == 100 -> false // TEST-NET-2
      a == 203 && c == 0 && b[2] == 113 -> false // TEST-NET-3
      else -> true
    }
  }
}
