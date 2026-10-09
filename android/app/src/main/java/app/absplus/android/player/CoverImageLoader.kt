package app.absplus.android.player

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import app.absplus.android.BuildConfig
import app.absplus.android.R
import app.absplus.android.diagnostics.DLog
import com.bumptech.glide.Glide
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val TAG = "CoverImageLoader"

/**
 * Loads [uri] as a bitmap via Glide, falling back to the app icon if the load fails. Never throws for a cover
 * that can't be loaded (the callers run in coroutine scopes without an exception handler); cancellation still
 * propagates. The URI isn't logged: it can carry a server address or a device path.
 */
suspend fun resolveUriAsBitmap(context: Context, uri: Uri): Bitmap? {
  return withContext(Dispatchers.IO) {
    try {
      Glide.with(context)
        .asBitmap()
        .load(uri)
        .placeholder(R.drawable.icon)
        .error(R.drawable.icon)
        .submit()
        .get()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      DLog.w(TAG, "Cover art unavailable (${uri.scheme}, ${e.javaClass.simpleName}) - using default artwork")
      try {
        Glide.with(context)
          .asBitmap()
          .load(Uri.parse("android.resource://${BuildConfig.APPLICATION_ID}/" + R.drawable.icon))
          .submit()
          .get()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        null
      }
    }
  }
}
