package app.absplus.android.data

data class PodcastAutoDownloadEntry(
  var enabled: String, // DEFAULT | ON | OFF
  var keepCount: Int?,
  var autoDownloadedEpisodeIds: MutableList<String>
) {
  companion object {
    const val ENABLED_DEFAULT = "DEFAULT"
    const val ENABLED_ON = "ON"
    const val ENABLED_OFF = "OFF"
  }
}
