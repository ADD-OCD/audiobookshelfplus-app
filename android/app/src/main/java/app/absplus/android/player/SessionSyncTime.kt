package app.absplus.android.player

/**
 * The time the current playback session last synced its progress.
 *
 * Syncs update the progress syncer's own copy of the session (`MediaProgressSyncer.currentPlaybackSession`); the
 * service's session keeps the time it was created. The UI's refocus check compares server progress with this time to
 * tell another device's newer update from this device's own sync, so it reads the syncer's copy when it is the same
 * session, and the session's own time otherwise (for example before the session ever played).
 */
object SessionSyncTime {
  fun lastSyncedAt(sessionId: String, sessionUpdatedAt: Long, syncerSessionId: String?, syncerUpdatedAt: Long?): Long =
    if (syncerSessionId == sessionId && syncerUpdatedAt != null) maxOf(syncerUpdatedAt, sessionUpdatedAt) else sessionUpdatedAt
}
