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

// Within this distance two positions are the same position (the server stores the time a sync sends as it is)
export const SAME_POSITION_S = 1

const isTime = (t) => typeof t === 'number' && Number.isFinite(t)

// Where the server's progress for the live streamed session comes from, decided by position and the server's own stamps,
// never by how close the server's stamp is to this phone's clock:
// - 'own': it is a position this phone wrote and the server acknowledged, a sync still in flight (the server may hold
//   it), or, before any sync, the position the server created the session with (nativeState.serverProgressAck,
//   ServerProgressAck.kt). A later move made here while paused is then this phone's newer position.
// - 'handled': a server state this refocus check already dealt with (`handled`: the session and the server's lastUpdate
//   it saw), so a paused move made here after it is not undone by it again.
// - 'remote': anything else, i.e. a position another device (or a server-side change) wrote after this phone's last write.
//   Also when the native side does not report what it wrote, which leaves the server authoritative as upstream.
export function serverProgressOrigin(live, serverProgress, handled) {
  const sessionId = live.playbackSession.id
  const ack = live.serverProgressAck
  if (ack && ack.sessionId === sessionId) {
    const own = [ack.ackedTime, ack.pendingTime].filter(isTime)
    if (own.some((t) => Math.abs(t - serverProgress.currentTime) <= SAME_POSITION_S)) return 'own'
  }
  if (handled && handled.sessionId === sessionId && Number(serverProgress.lastUpdate) <= handled.lastUpdate) return 'handled'
  return 'remote'
}

// Streamed (server) book. Another device's newer progress is applied (seek), as upstream does on refocus; the server
// position this phone wrote itself is not, so a position the native player moved to while paused stands and is
// displayed. When the native player does not hold this session, the server is compared with the displayed time as before.
// The result's `handled` is what the caller passes to the next check for the same session.
export function refocusServerAction(uiSession, nativeState, serverProgress, displayedTime, handled) {
  if (!serverProgress || typeof serverProgress.currentTime !== 'number') return { action: 'none' }
  const live = liveState(uiSession, nativeState)
  if (!live) return Math.abs(serverProgress.currentTime - displayedTime) > SAME_POSITION_S ? { action: 'seek', time: serverProgress.currentTime } : { action: 'none' }
  const origin = serverProgressOrigin(live, serverProgress, handled)
  const seen = Number(serverProgress.lastUpdate) || 0
  const nextHandled = { sessionId: live.playbackSession.id, lastUpdate: handled && handled.sessionId === live.playbackSession.id ? Math.max(handled.lastUpdate, seen) : seen }
  if (origin === 'remote' && Math.abs(serverProgress.currentTime - live.currentTime) > SAME_POSITION_S) return { action: 'seek', time: serverProgress.currentTime, origin, handled: nextHandled }
  return { action: 'display', time: live.currentTime, origin, handled: nextHandled }
}

// The handled record outlives the UI (an Activity recreated while the native player keeps its session): it is kept in the
// WebView's storage. Storage can be unavailable or hold anything, so reads validate and both directions fail quietly.
export const REFOCUS_HANDLED_KEY = 'absplus.refocusServerHandled'

export function readRefocusHandled(storage) {
  try {
    const h = JSON.parse(storage.getItem(REFOCUS_HANDLED_KEY))
    return h && typeof h.sessionId === 'string' && isTime(h.lastUpdate) ? { sessionId: h.sessionId, lastUpdate: h.lastUpdate } : null
  } catch (error) {
    return null
  }
}

export function writeRefocusHandled(storage, handled) {
  try {
    storage.setItem(REFOCUS_HANDLED_KEY, JSON.stringify(handled))
  } catch (error) {}
}
