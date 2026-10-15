package app.absplus.android.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ServerProgressAckTest {
  private val at = 1_791_690_351_051L

  @Test
  fun sessionStartIsTheServersPositionWithNothingAcknowledged() {
    assertEquals(ServerProgressAck("s1", 1269.279, null, null), ServerProgressAck.sessionStart("s1", 1269.279))
  }

  @Test
  fun aSentSyncIsPendingUntilAcknowledged() {
    val sent = ServerProgressAck.sessionStart("s1", 1269.279).sent("s1", 1278.232)
    assertEquals(ServerProgressAck("s1", 1269.279, null, 1278.232), sent)
    assertEquals(ServerProgressAck("s1", 1278.232, at, null), sent.acknowledged("s1", 1278.232, at))
  }

  @Test
  fun aFailedSyncStaysPendingBesideTheLastAcknowledgedOne() {
    // The server may have applied it although the reply never arrived
    val failed = ServerProgressAck("s1", 1278.232, at, null).sent("s1", 1290.5)
    assertEquals(1278.232, failed.ackedTime, 0.0)
    assertEquals(1290.5, failed.pendingTime!!, 0.0)
  }

  @Test
  fun anOlderAcknowledgementKeepsANewerPendingSync() {
    val twoInFlight = ServerProgressAck.sessionStart("s1", 10.0).sent("s1", 25.0).sent("s1", 40.0)
    val acked = twoInFlight.acknowledged("s1", 25.0, at)
    assertEquals(25.0, acked.ackedTime, 0.0)
    assertEquals(40.0, acked.pendingTime!!, 0.0)
    assertNull(acked.acknowledged("s1", 40.0, at + 15_000).pendingTime)
  }

  @Test
  fun anotherSessionsSyncChangesNothing() {
    val state = ServerProgressAck("s1", 1278.232, at, null)
    assertSame(state, state.sent("s2", 5.0))
    assertSame(state, state.acknowledged("s2", 5.0, at))
  }
}
