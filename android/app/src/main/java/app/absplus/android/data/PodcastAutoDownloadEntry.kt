package app.absplus.android.data

/**
 * Auto download state of one podcast on one saved server.
 *
 * Ownership is explicit: only [autoDownloadedEpisodeIds] (episodes the auto download itself queued) may ever be removed
 * by automatic retention. [manualEpisodeIds] are episodes the user requested from the app; a manual request always
 * wins, also for an episode that auto download queued earlier. Episodes on the device that are in neither list (for
 * example downloads made before auto download existed) are treated as the user's own and are never removed.
 */
data class PodcastAutoDownloadEntry(
  var enabled: String, // DEFAULT | ON | OFF
  var keepCount: Int?,
  var autoDownloadedEpisodeIds: MutableList<String>,
  var manualEpisodeIds: MutableList<String> = mutableListOf(),
  // Failed automatic attempts per episode; retried automatically only below AutoDownloadPolicy.MAX_AUTO_ATTEMPTS
  var failedAttempts: MutableMap<String, Int> = mutableMapOf()
) {
  companion object {
    const val ENABLED_DEFAULT = "DEFAULT"
    const val ENABLED_ON = "ON"
    const val ENABLED_OFF = "OFF"
  }
}
