package app.absplus.android.updater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/**
 * Receives Android's installer status for an update session (not exported: only this app's own PendingIntent, which
 * the system fires, reaches it). The confirmation screen in a STATUS_PENDING_USER_ACTION status is Android's own
 * installer activity; it is shown to the user from the app's activity, never accepted on the user's behalf.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != UpdateManager.ACTION_INSTALL_STATUS) return
    UpdateManager.init(context)
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val confirm = if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
    } else null
    UpdateManager.onInstallStatus(status, confirm)
  }
}
