package app.absplus.android.updater

import android.content.Context

/**
 * Release builds: the update source is fixed to the official GitHub repository, the production package and the
 * permanent signing certificate ([UpdateSource.Production]). There is no way to change it at runtime.
 */
object UpdaterConfig {
  const val TEST_SOURCES_SUPPORTED = false

  fun source(context: Context): UpdateSource = UpdateSource.Production

  fun setTestSource(context: Context, json: String): String = "Test update sources are not available in release builds"

  fun clearTestSource(context: Context) {}
}
