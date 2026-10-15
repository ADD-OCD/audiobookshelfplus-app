package app.absplus.android.plugins

import app.absplus.android.diagnostics.DLog
import app.absplus.android.themeimport.GitHubImporter
import app.absplus.android.themeimport.ImportBudget
import app.absplus.android.themeimport.ImportFailure
import app.absplus.android.themeimport.ImportPolicy
import app.absplus.android.themeimport.ThemeImportClient
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.UUID
import java.util.concurrent.Executors

/**
 * RICE "Import theme colors" bridge (docs/rice-customization.md). Three fixed operations: start a session for a pasted
 * GitHub URL, read one of the candidate files that session found, cancel. There is no generic fetch, path or URL
 * method: a candidate id only reaches a regular blob already listed in that active session. One session at a time; a
 * new start cancels the previous one, and results of a canceled or replaced session are discarded.
 */
@CapacitorPlugin(name = "AbsThemeImport")
class AbsThemeImport : Plugin() {
  private val worker = Executors.newSingleThreadExecutor()
  private val importer by lazy { GitHubImporter(ThemeImportClient()) }

  private class Session(val id: String, val budget: ImportBudget) {
    var resolved: GitHubImporter.Resolved? = null
    var reads = 0
    @Volatile var lastUsed = System.currentTimeMillis()
  }

  @Volatile private var session: Session? = null

  @PluginMethod
  fun start(call: PluginCall) {
    val url = call.getString("url") ?: return call.reject("missing-url")
    val explicitRef = call.getString("ref")?.trim()?.takeIf { it.isNotEmpty() }
    session?.budget?.cancel()
    val next = Session(UUID.randomUUID().toString(), ImportBudget())
    session = next
    worker.execute {
      try {
        val target = ImportPolicy.parse(url)
        val resolved = importer.resolve(target, explicitRef, next.budget)
        if (session !== next || next.budget.canceled) return@execute call.reject("canceled", "canceled")
        next.resolved = resolved
        next.lastUsed = System.currentTimeMillis()
        val candidates = JSArray()
        resolved.candidates.forEach { candidates.put(JSObject().put("id", it.id).put("path", it.path).put("size", it.size)) }
        call.resolve(
          JSObject()
            .put("sessionId", next.id)
            .put("owner", resolved.owner)
            .put("repo", resolved.repo)
            .put("commit", resolved.commit)
            .put("projectUrl", resolved.projectUrl)
            .put("licensePath", resolved.licensePath ?: JSObject.NULL)
            .put("candidates", candidates)
            .put("truncated", resolved.truncated)
        )
      } catch (e: ImportPolicy.Rejected) {
        call.reject(e.reason, e.reason)
      } catch (e: ImportFailure) {
        reject(call, e)
      } catch (e: Exception) {
        DLog.w(TAG, "Theme import failed: ${e.javaClass.simpleName}")
        call.reject("failed", "failed")
      }
    }
  }

  @PluginMethod
  fun readCandidate(call: PluginCall) {
    val current = session
    val sessionId = call.getString("sessionId")
    val candidateId = call.getString("candidateId")
    if (current == null || current.id != sessionId || current.budget.canceled) return call.reject("no-session", "no-session")
    if (System.currentTimeMillis() - current.lastUsed > ImportPolicy.SESSION_IDLE_MS) {
      current.budget.cancel()
      return call.reject("expired", "expired")
    }
    val resolved = current.resolved ?: return call.reject("no-session", "no-session")
    val candidate = resolved.candidates.firstOrNull { it.id == candidateId } ?: return call.reject("unknown-candidate", "unknown-candidate")
    if (++current.reads > ImportPolicy.MAX_SELECTED_FILES) return call.reject("file-budget", "file-budget")
    worker.execute {
      try {
        val file = importer.read(resolved, candidate, current.budget)
        if (session !== current || current.budget.canceled) return@execute call.reject("canceled", "canceled")
        current.lastUsed = System.currentTimeMillis()
        call.resolve(JSObject().put("path", file.path).put("text", file.text).put("sha256", file.sha256).put("blobSha", file.blobSha).put("commit", resolved.commit))
      } catch (e: ImportFailure) {
        reject(call, e)
      } catch (e: Exception) {
        DLog.w(TAG, "Theme import read failed: ${e.javaClass.simpleName}")
        call.reject("failed", "failed")
      }
    }
  }

  @PluginMethod
  fun cancel(call: PluginCall) {
    val current = session
    if (current != null && (call.getString("sessionId") == null || call.getString("sessionId") == current.id)) {
      current.budget.cancel()
      session = null
    }
    call.resolve()
  }

  override fun handleOnDestroy() {
    session?.budget?.cancel()
    session = null
    super.handleOnDestroy()
  }

  private fun reject(call: PluginCall, e: ImportFailure) {
    val data = JSObject()
    e.retryAfterSeconds?.let { data.put("retryAfterSeconds", it) }
    call.reject(e.reason, e.reason, data)
  }

  companion object {
    private const val TAG = "ThemeImport"
  }
}
