// Refocus while paused (AudioPlayerContainer.deviceFocused). The native player is authoritative for the session it has
// loaded: its position can move while the UI is in the background (the notification, a widget, a headset), and a move
// while paused reaches saved and server progress only at the next sync (MediaProgressSyncer.seek updates the session in
// memory). Display and seek decisions therefore start from the native session when it is the UI's session.

// The native state when it holds the UI's session and reports a usable position, otherwise null
function liveState(uiSession, nativeState) {
  const live = nativeState && nativeState.playbackSession
  const time = nativeState && nativeState.currentTime
  if (uiSession && uiSession.id && live && live.id === uiSession.id && typeof time === 'number' && Number.isFinite(time) && time >= 0) return nativeState
  return null
}

// Downloaded book: the live time for the matching loaded session; with another session, none, or no answer, the saved
// local progress as before. Display only: the caller never seeks or writes progress with the result.
export function refocusDisplayTime(uiSession, nativeState, savedTime) {
  const live = liveState(uiSession, nativeState)
  if (live) return { time: live.currentTime, source: 'live' }
  return { time: savedTime, source: 'saved' }
}

// Server progress counts as another device's update only when it is newer than this session's last update by more than
// this margin. A sync stamps the server copy a moment after the device stamps its session (latency, small clock skew), so
// without the margin our own last sync would look newer than a later move made here while paused
export const REMOTE_UPDATE_MARGIN_MS = 10000

// Streamed (server) book. As before, the server's progress is applied (seek) when it is another device's update, i.e. newer
// than the session's last sync (the rule PlayerNotificationService.checkCurrentSessionProgress uses, plus the margin), or
// when the native player does not hold this session (then compared with the displayed time, as before). The last sync is
// the native state's lastSyncedAt: the service's session copy keeps its creation time as updatedAt (SessionSyncTime.kt).
// Otherwise the native position stands and is displayed: no seek back to a stale server position.
export function refocusServerAction(uiSession, nativeState, serverProgress, displayedTime) {
  if (!serverProgress || typeof serverProgress.currentTime !== 'number') return { action: 'none' }
  const live = liveState(uiSession, nativeState)
  if (!live) return Math.abs(serverProgress.currentTime - displayedTime) > 1 ? { action: 'seek', time: serverProgress.currentTime } : { action: 'none' }
  const sessionUpdatedAt = Number(live.lastSyncedAt ?? live.playbackSession.updatedAt) || 0
  const remoteUpdate = Number(serverProgress.lastUpdate) > sessionUpdatedAt + REMOTE_UPDATE_MARGIN_MS
  if (remoteUpdate && Math.abs(serverProgress.currentTime - live.currentTime) > 1) return { action: 'seek', time: serverProgress.currentTime }
  return { action: 'display', time: live.currentTime }
}
