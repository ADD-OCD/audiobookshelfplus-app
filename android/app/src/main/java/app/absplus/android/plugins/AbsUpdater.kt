package app.absplus.android.plugins

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.lifecycle.Lifecycle
import app.absplus.android.diagnostics.DLog
import app.absplus.android.updater.UpdateManager
import app.absplus.android.updater.UpdateSnapshot
import app.absplus.android.updater.UpdateState
import app.absplus.android.updater.UpdaterConfig
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Settings → Updates. The JS side only reads state and sends the user's button presses; it never passes a URL, file or
 * package: the release source, the trusted certificate and the files are fixed natively (UpdaterConfig, UpdateManager).
 */
@CapacitorPlugin(name = "AbsUpdater")
class AbsUpdater : Plugin() {
  private val main = Handler(Looper.getMainLooper())

  override fun load() {
    UpdateManager.init(context)
    UpdateManager.listener = { snapshot -> notifyListeners("onUpdateState", stateJson(snapshot)) }
    UpdateManager.confirmLauncher = { intent -> main.post { showConfirm(intent) } }
  }

  override fun handleOnResume() {
    super.handleOnResume()
    // Back from Android's installer or from the "Install unknown apps" setting: refresh, and show a confirmation
    // screen that could not be shown while the app was in the background
    UpdateManager.pendingConfirm?.let { if (UpdateManager.snapshot().state == UpdateState.INSTALLING) showConfirm(it) }
    notifyListeners("onUpdateState", stateJson(UpdateManager.snapshot()))
  }

  private fun showConfirm(intent: Intent) {
    val act = activity ?: return
    if (!act.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return
    try {
      act.startActivity(Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
      DLog.w("Updater", "Could not open Android's installer: ${e.javaClass.simpleName}")
    }
  }

  @PluginMethod
  fun getState(call: PluginCall) {
    call.resolve(stateJson(UpdateManager.snapshot()))
  }

  @PluginMethod
  fun checkForUpdates(call: PluginCall) {
    call.resolve(JSObject().put("accepted", UpdateManager.check()))
  }

  @PluginMethod
  fun downloadUpdate(call: PluginCall) {
    call.resolve(JSObject().put("accepted", UpdateManager.download()))
  }

  @PluginMethod
  fun cancelDownload(call: PluginCall) {
    call.resolve(JSObject().put("accepted", UpdateManager.cancelDownload()))
  }

  @PluginMethod
  fun installUpdate(call: PluginCall) {
    val result = UpdateManager.install()
    call.resolve(JSObject().put("result", result.name.lowercase()))
  }

  /** Shows Android's installer confirmation again (left with Home or Recents) while the session still waits for it */
  @PluginMethod
  fun reopenInstaller(call: PluginCall) {
    val pending = UpdateManager.pendingConfirm
    if (pending == null || UpdateManager.snapshot().state != UpdateState.INSTALLING) return call.resolve(JSObject().put("opened", false))
    showConfirm(pending)
    call.resolve(JSObject().put("opened", true))
  }

  /** Android's "Install unknown apps" page for this app, opened only from the user's button */
  @PluginMethod
  fun openInstallPermissionSettings(call: PluginCall) {
    if (Build.VERSION.SDK_INT < 26) return call.resolve(JSObject().put("opened", false))
    try {
      activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
      call.resolve(JSObject().put("opened", true))
    } catch (e: Exception) {
      call.resolve(JSObject().put("opened", false))
    }
  }

  /** Opens the release page of the current candidate (an official GitHub release URL checked by ReleaseSelector) */
  @PluginMethod
  fun openReleaseNotes(call: PluginCall) {
    val url = UpdateManager.snapshot().candidate?.releaseUrl ?: return call.resolve(JSObject().put("opened", false))
    try {
      activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
      call.resolve(JSObject().put("opened", true))
    } catch (e: Exception) {
      call.resolve(JSObject().put("opened", false))
    }
  }

  /** Debug builds only: a loopback fixture source for device tests (refused in release builds) */
  @PluginMethod
  fun setTestSource(call: PluginCall) {
    val error: String? = UpdaterConfig.setTestSource(context, call.getString("source") ?: "")
    if (error != null) call.reject(error) else call.resolve(stateJson(UpdateManager.snapshot()))
  }

  @PluginMethod
  fun clearTestSource(call: PluginCall) {
    UpdaterConfig.clearTestSource(context)
    call.resolve(stateJson(UpdateManager.snapshot()))
  }

  private fun stateJson(s: UpdateSnapshot): JSObject {
    val installed = UpdateManager.installedInfo()
    val source = UpdateManager.source()
    val ret = JSObject()
    ret.put("state", s.state.name)
    ret.put("error", s.error?.name)
    ret.put("notice", s.notice?.name)
    ret.put("downloadedBytes", s.downloadedBytes)
    ret.put("totalBytes", s.totalBytes)
    ret.put("readyVersionCode", s.readyVersionCode)
    ret.put("lastCheckAt", s.lastCheckAt)
    ret.put("installedVersionCode", installed.versionCode)
    ret.put("installedVersion", installed.plusVersion)
    ret.put("storeManaged", installed.storeManaged)
    ret.put("installPermissionNeeded", UpdateManager.needsInstallPermission())
    ret.put("downloadsEnabled", source.downloadsEnabled)
    ret.put("testSource", source.isTest)
    s.candidate?.let { c ->
      val candidate = JSObject()
      candidate.put("version", c.version.toString())
      candidate.put("title", c.title)
      candidate.put("publishedAt", c.publishedAt)
      candidate.put("summary", c.summary)
      candidate.put("size", c.apk.size)
      ret.put("candidate", candidate)
    }
    return ret
  }
}
