package app.absplus.android.player

/**
 * The server progress this phone knows it caused for a streamed session, so the UI's refocus check can tell this phone's
 * own write from another device's change by position instead of by how close two timestamps are.
 *
 * - [ackedTime]: the position of the last sync the server acknowledged; before any sync, the position the server gave
 *   the session when it was created (the server's progress at that moment). [ackedAt] is null until a sync is acknowledged.
 * - [pendingTime]: a sync that was sent and not (yet) acknowledged. The server may hold it (a reply lost or still on its
 *   way), so it also counts as this phone's write; a later acknowledged sync of the same position clears it.
 */
data class ServerProgressAck(
  val sessionId: String,
  val ackedTime: Double,
  val ackedAt: Long?,
  val pendingTime: Double?
) {
  fun sent(sessionId: String, time: Double): ServerProgressAck =
    if (sessionId == this.sessionId) copy(pendingTime = time) else this

  fun acknowledged(sessionId: String, time: Double, at: Long): ServerProgressAck =
    if (sessionId == this.sessionId) copy(ackedTime = time, ackedAt = at, pendingTime = pendingTime?.takeIf { it != time }) else this

  companion object {
    fun sessionStart(sessionId: String, currentTime: Double) = ServerProgressAck(sessionId, currentTime, null, null)
  }
}
