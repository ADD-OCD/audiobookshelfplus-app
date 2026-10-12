package app.absplus.android.themeimport

import android.util.Base64
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

/**
 * Resolves a pasted GitHub location to one immutable commit and a bounded list of candidate palette files, and reads
 * a chosen file. Uses only the public Git data API (repos, git/refs, git/commits, git/trees, git/blobs) through
 * [ThemeImportClient]: a branch or tag is resolved once and everything after is fetched by SHA, so a moving branch
 * can't change what a session reads. Only regular files (mode 100644) are accepted: symlinks, submodules, executables,
 * LFS pointers and oversized blobs are refused. File contents are returned as text for the JS parsers; nothing is
 * interpreted here.
 */
class GitHubImporter(private val client: ThemeImportClient) {
  data class Candidate(val id: String, val path: String, val sha: String, val size: Int)

  data class Resolved(
    val owner: String,
    val repo: String,
    val commit: String,
    val candidates: List<Candidate>,
    val truncated: Boolean,
    val licensePath: String?
  ) {
    val projectUrl get() = "https://github.com/$owner/$repo"
  }

  data class FileText(val path: String, val text: String, val sha256: String, val blobSha: String)

  private data class Entry(val name: String, val mode: String, val type: String, val sha: String, val size: Int)

  fun resolve(target: ImportPolicy.Target, explicitRef: String?, budget: ImportBudget): Resolved {
    val (requestedRef, path) = ImportPolicy.splitRef(target, explicitRef)
    val repoInfo = json(listOf("repos", target.owner, target.repo), ImportPolicy.MAX_METADATA_BYTES, budget)
    if (repoInfo.optBoolean("private", false)) throw ImportFailure("not-public")
    val ref = requestedRef ?: repoInfo.optString("default_branch").takeIf { it.isNotEmpty() }?.let { ImportPolicy.validRef(it) } ?: throw ImportFailure("no-default-branch")
    val commit = resolveCommit(target, ref, budget)
    val commitInfo = json(listOf("repos", target.owner, target.repo, "git", "commits", commit), ImportPolicy.MAX_METADATA_BYTES, budget)
    val rootTree = commitInfo.optJSONObject("tree")?.optString("sha")?.takeIf { SHA.matches(it) } ?: throw ImportFailure("bad-response")

    var trees = 0
    fun tree(sha: String): List<Entry> {
      if (++trees > ImportPolicy.MAX_TREE_RESPONSES) throw ImportFailure("tree-budget")
      val body = json(listOf("repos", target.owner, target.repo, "git", "trees", sha), ImportPolicy.MAX_TREE_BYTES, budget)
      if (body.optBoolean("truncated", false)) throw ImportFailure("tree-truncated")
      val array = body.optJSONArray("tree") ?: throw ImportFailure("bad-response")
      if (array.length() > ImportPolicy.MAX_TREE_ENTRIES) throw ImportFailure("tree-too-large")
      return (0 until array.length()).mapNotNull { i ->
        val e = array.optJSONObject(i) ?: return@mapNotNull null
        val sha = e.optString("sha").takeIf { SHA.matches(it) } ?: return@mapNotNull null
        Entry(e.optString("path"), e.optString("mode"), e.optString("type"), sha, e.optInt("size", -1))
      }
    }

    val root = tree(rootTree)
    val licensePath = root.firstOrNull { it.type == "blob" && LICENSE.matches(it.name) }?.name

    // Walk the named path through its trees (each component one tree response)
    var entries = root
    var dirPath = emptyList<String>()
    val walk = if (target.kind == ImportPolicy.Kind.BLOB || target.kind == ImportPolicy.Kind.RAW) path.dropLast(1) else path
    for (component in walk) {
      val dir = entries.firstOrNull { it.name == component } ?: throw ImportFailure("path-not-found")
      if (dir.type != "tree" || dir.mode != "040000") throw ImportFailure("not-a-directory")
      entries = tree(dir.sha)
      dirPath = dirPath + component
    }

    if (target.kind == ImportPolicy.Kind.BLOB || target.kind == ImportPolicy.Kind.RAW) {
      val file = entries.firstOrNull { it.name == path.last() } ?: throw ImportFailure("path-not-found")
      checkRegular(file)
      val full = (dirPath + file.name).joinToString("/")
      return Resolved(target.owner, target.repo, commit, listOf(Candidate("c0", full, file.sha, file.size)), false, licensePath)
    }

    // Repository or folder: rank likely palette files breadth-first within the tree budget
    val candidates = mutableListOf<Candidate>()
    var truncated = false
    val queue = ArrayDeque<Triple<List<String>, List<Entry>, Int>>()
    queue.add(Triple(dirPath, entries, 0))
    while (queue.isNotEmpty()) {
      val (dir, list, depth) = queue.removeFirst()
      val likelyDir = dir.isNotEmpty() && LIKELY_DIRS.matches(dir.last())
      for (e in list.sortedBy { it.name }) {
        if (e.type == "blob" && e.mode == "100644" && e.size in 1..ImportPolicy.MAX_PALETTE_BYTES && looksLikePalette(e.name, likelyDir || target.kind == ImportPolicy.Kind.TREE && dir == dirPath)) {
          if (candidates.size >= ImportPolicy.MAX_CANDIDATES) truncated = true
          else candidates.add(Candidate("c${candidates.size}", (dir + e.name).joinToString("/"), e.sha, e.size))
        }
      }
      if (depth >= ImportPolicy.MAX_DEPTH) continue
      for (e in list.filter { it.type == "tree" && it.mode == "040000" && LIKELY_DIRS.matches(it.name) }.sortedBy { it.name }) {
        if (trees >= ImportPolicy.MAX_TREE_RESPONSES) {
          truncated = true
          break
        }
        queue.add(Triple(dir + e.name, tree(e.sha), depth + 1))
      }
    }
    return Resolved(target.owner, target.repo, commit, candidates, truncated, licensePath)
  }

  private fun resolveCommit(target: ImportPolicy.Target, ref: String, budget: ImportBudget): String {
    if (ImportPolicy.isCommit(ref)) return ref
    val base = listOf("repos", target.owner, target.repo, "git", "ref")
    val refPath = ref.split('/')
    val obj =
      try {
        json(base + "heads" + refPath, ImportPolicy.MAX_METADATA_BYTES, budget)
      } catch (e: ImportFailure) {
        if (e.reason != "not-found") throw e
        try {
          json(base + "tags" + refPath, ImportPolicy.MAX_METADATA_BYTES, budget)
        } catch (e2: ImportFailure) {
          throw if (e2.reason == "not-found") ImportFailure("ref-not-found") else e2
        }
      }.optJSONObject("object") ?: throw ImportFailure("bad-response")
    val sha = obj.optString("sha").takeIf { SHA.matches(it) } ?: throw ImportFailure("bad-response")
    return when (obj.optString("type")) {
      "commit" -> sha
      // Annotated tag: one more hop to the commit it names
      "tag" -> json(listOf("repos", target.owner, target.repo, "git", "tags", sha), ImportPolicy.MAX_METADATA_BYTES, budget).optJSONObject("object")?.takeIf { it.optString("type") == "commit" }?.optString("sha")?.takeIf { SHA.matches(it) } ?: throw ImportFailure("bad-ref")
      else -> throw ImportFailure("bad-ref")
    }
  }

  /** Reads a candidate blob by SHA: bounded, Base64-decoded, verified against its Git blob id, strict UTF-8. */
  fun read(resolved: Resolved, candidate: Candidate, budget: ImportBudget): FileText {
    val body = json(listOf("repos", resolved.owner, resolved.repo, "git", "blobs", candidate.sha), ImportPolicy.MAX_BLOB_RESPONSE_BYTES, budget)
    if (body.optString("encoding") != "base64") throw ImportFailure("bad-response")
    val encoded = body.optString("content").replace("\n", "")
    if (encoded.length > (ImportPolicy.MAX_PALETTE_BYTES / 3 + 1) * 4) throw ImportFailure("too-large")
    val bytes = runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull() ?: throw ImportFailure("bad-response")
    if (bytes.size > ImportPolicy.MAX_PALETTE_BYTES) throw ImportFailure("too-large")
    if (gitBlobSha(bytes) != candidate.sha) throw ImportFailure("integrity")
    if (bytes.size >= 7 && String(bytes, 0, 7, Charsets.US_ASCII) == "version" && String(bytes, Charsets.US_ASCII).startsWith("version https://git-lfs")) throw ImportFailure("lfs-pointer")
    val text = strictUtf8(bytes)
    if ('\u0000' in text) throw ImportFailure("binary")
    return FileText(candidate.path, text, sha256(bytes), candidate.sha)
  }

  private fun json(segments: List<String>, maxBytes: Int, budget: ImportBudget): JSONObject {
    val bytes = client.get(segments, maxBytes, budget)
    return runCatching { JSONObject(strictUtf8(bytes)) }.getOrNull() ?: throw ImportFailure("bad-response")
  }

  private fun checkRegular(e: Entry) {
    when {
      e.mode == "120000" -> throw ImportFailure("symlink")
      e.mode == "160000" || e.type == "commit" -> throw ImportFailure("submodule")
      e.mode == "100755" -> throw ImportFailure("executable")
      e.mode != "100644" || e.type != "blob" -> throw ImportFailure("not-a-file")
      e.size > ImportPolicy.MAX_PALETTE_BYTES -> throw ImportFailure("too-large")
    }
  }

  companion object {
    private val SHA = Regex("^[0-9a-f]{40}$")
    private val LICENSE = Regex("^(LICEN[CS]E|COPYING)(\\.(md|txt))?$", RegexOption.IGNORE_CASE)
    private val LIKELY_DIRS = Regex("^(\\.?colou?rs?|themes?|palettes?|schemes?|base16|base24|kitty|kitty-themes|wal|\\.cache|\\.config|pywal)$", RegexOption.IGNORE_CASE)
    private val PALETTE_NAME = Regex("(colou?r|theme|palette|scheme|wal|kitty|base16|base24)", RegexOption.IGNORE_CASE)
    private val EXTENSIONS = setOf("", "json", "conf", "yaml", "yml", "txt", "colors", "theme")

    fun looksLikePalette(name: String, inLikelyDir: Boolean): Boolean {
      val ext = name.substringAfterLast('.', "").lowercase().takeIf { name.contains('.') && !name.startsWith(".") } ?: ""
      if (ext !in EXTENSIONS) return false
      return inLikelyDir || PALETTE_NAME.containsMatchIn(name)
    }

    fun gitBlobSha(bytes: ByteArray): String {
      val md = MessageDigest.getInstance("SHA-1")
      md.update("blob ${bytes.size}\u0000".toByteArray(Charsets.US_ASCII))
      return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun strictUtf8(bytes: ByteArray): String =
      try {
        Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
      } catch (e: CharacterCodingException) {
        throw ImportFailure("not-utf8")
      }
  }
}
