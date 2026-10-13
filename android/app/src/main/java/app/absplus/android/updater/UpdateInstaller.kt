package app.absplus.android.updater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/** What the app does with an installer status */
enum class InstallOutcome { NEEDS_CONFIRMATION, INSTALLED, CANCELLED, BLOCKED, NO_STORAGE, REJECTED }

/**
 * Android's installer for a verified update: a PackageInstaller session (no file:// URI and no file sharing; the APK
 * never leaves app-private storage). The session requires the user's confirmation on Android's own screen (from
 * Android 12 explicitly, USER_ACTION_REQUIRED), and Android verifies the APK's signature again and refuses an update not
 * signed like the installed app.
 */
object UpdateInstaller {
  fun outcome(status: Int): InstallOutcome = when (status) {
    PackageInstaller.STATUS_PENDING_USER_ACTION -> InstallOutcome.NEEDS_CONFIRMATION
    PackageInstaller.STATUS_SUCCESS -> InstallOutcome.INSTALLED
    PackageInstaller.STATUS_FAILURE_ABORTED -> InstallOutcome.CANCELLED
    PackageInstaller.STATUS_FAILURE_BLOCKED -> InstallOutcome.BLOCKED
    PackageInstaller.STATUS_FAILURE_STORAGE -> InstallOutcome.NO_STORAGE
    else -> InstallOutcome.REJECTED
  }

  fun sessionParams(targetPackage: String, size: Long): PackageInstaller.SessionParams =
    PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(targetPackage)
      setSize(size)
      if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }

  /** The installer's status goes to this app's own non-exported receiver */
  fun statusIntent(context: Context, sessionId: Int): PendingIntent {
    val intent = Intent(UpdateManager.ACTION_INSTALL_STATUS).setClass(context, UpdateInstallReceiver::class.java).setPackage(context.packageName)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    return PendingIntent.getBroadcast(context, sessionId, intent, flags)
  }

  /** Writes [apk] into a new session while hashing it, and commits only when the bytes are exactly the verified ones */
  fun commit(context: Context, apk: File, size: Long, sha256: String, targetPackage: String): Int {
    val installer = context.packageManager.packageInstaller
    val sessionId = installer.createSession(sessionParams(targetPackage, size))
    val session = installer.openSession(sessionId)
    try {
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(apk).use { input ->
        session.openWrite("base.apk", 0, size).use { out ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
            out.write(buffer, 0, n)
          }
          session.fsync(out)
        }
      }
      if (digest.digest().joinToString("") { "%02x".format(it) } != sha256) throw UpdateException(UpdateErrorCode.DIGEST_MISMATCH, "verified update changed")
      session.commit(statusIntent(context, sessionId).intentSender)
      return sessionId
    } catch (e: Exception) {
      session.abandon()
      throw e
    } finally {
      session.close()
    }
  }
}
