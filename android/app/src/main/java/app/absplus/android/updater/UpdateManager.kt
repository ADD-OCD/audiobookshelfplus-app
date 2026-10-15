package app.absplus.android.updater

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.StatFs
import androidx.core.content.pm.PackageInfoCompat
import app.absplus.android.BuildConfig
import app.absplus.android.plugins.AbsLogger
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

data class InstalledInfo(val packageName: String, val versionCode: Long, val plusVersion: String?, val storeManaged: Boolean)

enum class InstallStart { STARTED, NEEDS_PERMISSION, REFUSED, UNSUPPORTED }

/**
 * Runs the in-app updater: CHECK -> AVAILABLE -> DOWNLOAD -> VERIFY -> INSTALL CONFIRMATION.
 *
 * Work runs on one background thread, so there is never more than one check or download. Nothing downloads or installs
 * on its own: every step starts from the user's button in Settings, and the last step is Android's own installer
 * screen, which the user confirms or cancels. The playback service, audiobook downloads and app data are not touched.
 * Diagnostics get event lines at every diagnostic level (AbsLogger; no URLs, file paths, headers or response bodies).
 */
object UpdateManager {
  private const val TAG = "Updater"
  private const val PREFS = "absplus_updater"
  private const val KEY_LAST_CHECK = "lastCheckAt"
  const val ACTION_INSTALL_STATUS = "app.absplus.android.updater.INSTALL_STATUS"

  private lateinit var appContext: Context
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "Updater").apply { isDaemon = true } }
  private val machine = UpdateStateMachine()
  private val lock = Any()
  private val cancel = AtomicBoolean(false)
  @Volatile private var http: UpdateHttp? = null
  @Volatile private var initialized = false

  /** Called with every state change (any thread) */
  @Volatile var listener: ((UpdateSnapshot) -> Unit)? = null
  /** Called when Android's installer needs the user's confirmation (any thread); the plugin shows it from the activity */
  @Volatile var confirmLauncher: ((Intent) -> Unit)? = null
  /** The installer's confirmation screen, kept until the session reports back so it can be reopened */
  @Volatile var pendingConfirm: Intent? = null
    private set

  fun init(context: Context) {
    synchronized(lock) {
      if (initialized) return
      appContext = context.applicationContext
      initialized = true
    }
    executor.execute {
      val store = store()
      val installed = installedInfo()
      val result = store.reconcile(installed.versionCode)
      val ready = result.ready
      val notice = when {
        result.obsoleteRemoved -> UpdateNotice.OBSOLETE_REMOVED
        result.interruptedRemoved -> UpdateNotice.INTERRUPTED
        else -> null
      }
      if (result.interruptedRemoved) AbsLogger.info(TAG, "Cleanup: removed an interrupted download")
      if (result.damagedRemoved) AbsLogger.error(TAG, "Cleanup: removed a damaged verified update")
      if (result.obsoleteRemoved) AbsLogger.info(TAG, "Cleanup: removed a verified update that is no longer newer than the installed version")
      synchronized(lock) {
        if (installed.storeManaged) machine.unsupported()
        else machine.restore(lastCheckAt(), ready?.let { it.candidate to it.versionCode }, notice)
      }
      emit()
    }
  }

  fun snapshot(): UpdateSnapshot = synchronized(lock) { machine.snapshot }

  fun source(): UpdateSource = UpdaterConfig.source(appContext)

  fun installedInfo(): InstalledInfo {
    val source = source()
    val pm = appContext.packageManager
    val versionCode = try {
      PackageInfoCompat.getLongVersionCode(pm.getPackageInfo(source.targetPackage, 0))
    } catch (e: PackageManager.NameNotFoundException) {
      0L
    }
    val installer = try {
      if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(appContext.packageName).installingPackageName
      else @Suppress("DEPRECATION") pm.getInstallerPackageName(appContext.packageName)
    } catch (e: Exception) {
      null
    }
    return InstalledInfo(source.targetPackage, versionCode, source.installedPlusVersionOverride ?: BuildConfig.PLUS_VERSION, UpdatePolicy.isStoreManaged(installer))
  }

  fun needsInstallPermission(): Boolean =
    UpdatePolicy.needsInstallPermission(Build.VERSION.SDK_INT, Build.VERSION.SDK_INT < 26 || appContext.packageManager.canRequestPackageInstalls())

  fun check(): Boolean {
    synchronized(lock) { if (!machine.beginCheck()) return false }
    emit()
    AbsLogger.info(TAG, "Check started")
    executor.execute {
      val source = source()
      try {
        val json = UpdateHttp(source).fetchLatestRelease()
        when (val selected = ReleaseSelector.select(json, source)) {
          is SelectResult.Rejected -> throw UpdateException(selected.code, selected.detail)
          is SelectResult.Found -> {
            val candidate = selected.candidate
            val installed = installedInfo()
            val newer = UpdatePolicy.isNewer(candidate.version, PlusVersion.parse(installed.plusVersion))
            val now = System.currentTimeMillis()
            appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_LAST_CHECK, now).apply()
            synchronized(lock) {
              // A verified update for another release is obsolete once a different release is the latest
              val ready = machine.snapshot.candidate
              if (machine.snapshot.readyVersionCode != null && (ready?.tag != candidate.tag || !newer)) store().clearAll()
              machine.checkSucceeded(candidate, newer, now)
            }
            AbsLogger.info(TAG, "Check completed: latest release v${candidate.version} (${if (newer) "newer than" else "not newer than"} installed v${installed.plusVersion})")
          }
        }
      } catch (e: UpdateException) {
        AbsLogger.error(TAG, "Check failed: ${e.code}")
        synchronized(lock) { machine.checkFailed(e.code) }
      } catch (e: Exception) {
        AbsLogger.error(TAG, "Check failed: ${e.javaClass.simpleName}")
        synchronized(lock) { machine.checkFailed(UpdateErrorCode.MALFORMED) }
      }
      emit()
    }
    return true
  }

  fun download(): Boolean {
    val source = source()
    val candidate: UpdateCandidate
    synchronized(lock) {
      if (!source.downloadsEnabled || machine.snapshot.state == UpdateState.UNSUPPORTED) return false
      candidate = machine.snapshot.candidate ?: return false
      if (!machine.beginDownload()) return false
      cancel.set(false)
    }
    emit()
    AbsLogger.info(TAG, "Download started: v${candidate.version} (${candidate.apk.size} bytes)")
    executor.execute {
      val store = store()
      val client = UpdateHttp(source)
      http = client
      try {
        store.clearIncomplete()
        val partial = store.prepare()
        if (!UpdatePolicy.hasRoomFor(candidate.apk.size, StatFs(store.dir.path).availableBytes)) throw UpdateException(UpdateErrorCode.STORAGE, "not enough storage")
        val file = client.download(candidate.apk, partial, cancel) { done, total ->
          if (synchronized(lock) { machine.progress(done, total) }) emit()
        }
        val checksumDigest = candidate.checksumAsset?.let { asset ->
          UpdatePolicy.parseChecksumFile(client.fetchText(asset, cancel), candidate.apk.name) ?: throw UpdateException(UpdateErrorCode.DIGEST_MISMATCH, "checksum file does not name this APK")
        }
        if (candidate.apk.sha256 == null && checksumDigest == null) throw UpdateException(UpdateErrorCode.DIGEST_MISMATCH, "the release publishes no digest")
        if (!UpdatePolicy.digestsAgree(file.sha256, candidate.apk.sha256, checksumDigest)) throw UpdateException(UpdateErrorCode.DIGEST_MISMATCH, "digest does not match")
        AbsLogger.info(TAG, "Download completed: size and published digest match")
        synchronized(lock) {
          if (cancel.get()) throw UpdateException(UpdateErrorCode.CANCELLED, "cancelled")
          machine.beginVerify()
        }
        emit()
        val staged = store.stageForVerification()
        val installed = installedInfo()
        when (val verdict = ApkVerifier.evaluate(ApkVerifier.readFacts(appContext, staged), ApkExpectation(source.targetPackage, installed.versionCode, source.trustedSignerSha256))) {
          is ApkVerdict.Rejected -> throw UpdateException(verdict.code, verdict.detail)
          is ApkVerdict.Accepted -> {
            store.promote(ReadyUpdate(candidate, verdict.versionCode, file.size, file.sha256, System.currentTimeMillis()))
            synchronized(lock) { machine.verified(verdict.versionCode) }
            AbsLogger.info(TAG, "Verification succeeded: version code ${verdict.versionCode}, trusted signer${if (verdict.rotatedFromTrusted) " (rotated from the trusted key)" else ""}")
          }
        }
      } catch (e: UpdateException) {
        store.clearIncomplete()
        synchronized(lock) { if (e.code == UpdateErrorCode.CANCELLED) machine.cancelled() else machine.failed(e.code) }
        if (e.code == UpdateErrorCode.CANCELLED) AbsLogger.info(TAG, "Download cancelled; partial data removed")
        else AbsLogger.error(TAG, "Download or verification failed: ${e.code} (${e.message}); partial data removed")
      } catch (e: Exception) {
        store.clearIncomplete()
        synchronized(lock) { machine.failed(UpdateErrorCode.INVALID_APK) }
        AbsLogger.error(TAG, "Download or verification failed: ${e.javaClass.simpleName}; partial data removed")
      } finally {
        http = null
      }
      emit()
    }
    return true
  }

  fun cancelDownload(): Boolean {
    synchronized(lock) { if (machine.snapshot.state != UpdateState.DOWNLOADING) return false }
    cancel.set(true)
    http?.abort()
    return true
  }

  /** Hands the verified update to Android's installer; the user confirms or cancels on Android's screen */
  fun install(): InstallStart {
    if (installedInfo().storeManaged) return InstallStart.UNSUPPORTED
    synchronized(lock) { if (machine.snapshot.state != UpdateState.READY) return InstallStart.REFUSED }
    if (needsInstallPermission()) {
      AbsLogger.info(TAG, "Install needs the 'Install unknown apps' permission")
      return InstallStart.NEEDS_PERMISSION
    }
    synchronized(lock) { if (!machine.beginInstall()) return InstallStart.REFUSED }
    emit()
    executor.execute {
      val store = store()
      try {
        val ready = store.loadReady() ?: throw UpdateException(UpdateErrorCode.INVALID_APK, "verified update missing or changed")
        val source = source()
        val installed = installedInfo()
        // Verified again right before installing: the file or the installed version may have changed since
        val verdict = ApkVerifier.evaluate(ApkVerifier.readFacts(appContext, store.readyFile()), ApkExpectation(source.targetPackage, installed.versionCode, source.trustedSignerSha256))
        if (verdict is ApkVerdict.Rejected) throw UpdateException(verdict.code, verdict.detail)
        UpdateInstaller.commit(appContext, store.readyFile(), ready.size, ready.sha256, source.targetPackage)
        AbsLogger.info(TAG, "Installer requested for version code ${ready.versionCode}")
      } catch (e: UpdateException) {
        store.clearAll()
        synchronized(lock) { machine.installFailed(e.code, keepReady = false) }
        AbsLogger.error(TAG, "Install not started: ${e.code}; verified update removed")
      } catch (e: Exception) {
        synchronized(lock) { machine.installFailed(UpdateErrorCode.INSTALL_FAILED, keepReady = true) }
        AbsLogger.error(TAG, "Install not started: ${e.javaClass.simpleName}")
      }
      emit()
    }
    return InstallStart.STARTED
  }

  /** From [UpdateInstallReceiver]: Android's installer reports back */
  fun onInstallStatus(status: Int, confirm: Intent?) {
    when (UpdateInstaller.outcome(status)) {
      InstallOutcome.NEEDS_CONFIRMATION -> {
        if (confirm == null) {
          synchronized(lock) { machine.installFailed(UpdateErrorCode.INSTALL_FAILED, keepReady = true) }
        } else {
          pendingConfirm = confirm
          AbsLogger.info(TAG, "Installer confirmation requested")
          confirmLauncher?.invoke(confirm)
        }
      }
      InstallOutcome.INSTALLED -> {
        pendingConfirm = null
        store().clearAll()
        synchronized(lock) { machine.installSucceeded() }
        AbsLogger.info(TAG, "Installer returned: installed")
      }
      InstallOutcome.CANCELLED -> {
        pendingConfirm = null
        synchronized(lock) { machine.installCancelled() }
        AbsLogger.info(TAG, "Installer returned: cancelled by the user; verified update kept")
      }
      InstallOutcome.BLOCKED -> {
        pendingConfirm = null
        synchronized(lock) { machine.installFailed(UpdateErrorCode.INSTALL_BLOCKED, keepReady = true) }
        AbsLogger.error(TAG, "Installer returned: blocked")
      }
      InstallOutcome.NO_STORAGE -> {
        pendingConfirm = null
        synchronized(lock) { machine.installFailed(UpdateErrorCode.STORAGE, keepReady = true) }
        AbsLogger.error(TAG, "Installer returned: not enough storage")
      }
      InstallOutcome.REJECTED -> {
        // Conflict, incompatible, invalid: this file will not install; it is removed
        pendingConfirm = null
        store().clearAll()
        synchronized(lock) { machine.installFailed(UpdateErrorCode.INSTALL_FAILED, keepReady = false) }
        AbsLogger.error(TAG, "Installer returned: failed (status $status); verified update removed")
      }
    }
    emit()
  }

  private fun lastCheckAt(): Long? = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_CHECK, 0L).takeIf { it > 0 }

  private fun store() = UpdateStore(File(appContext.cacheDir, "updates"))

  private fun emit() {
    listener?.invoke(snapshot())
  }
}
