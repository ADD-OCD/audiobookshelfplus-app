package app.absplus.android.player

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionSyncTimeTest {
  private val created = 1_791_690_351_051L

  @Test
  fun syncerCopyOfTheSameSessionGivesTheLastSyncTime() {
    // The S22 case: the service's session kept its creation time while the syncer's copy synced 13 s later
    assertEquals(created + 13_213, SessionSyncTime.lastSyncedAt("s1", created, "s1", created + 13_213))
  }

  @Test
  fun anotherOrNoSyncerSessionFallsBackToTheSessionsOwnTime() {
    assertEquals(created, SessionSyncTime.lastSyncedAt("s1", created, "s2", created + 60_000))
    assertEquals(created, SessionSyncTime.lastSyncedAt("s1", created, null, null))
    assertEquals(created, SessionSyncTime.lastSyncedAt("s1", created, "s1", null))
  }

  @Test
  fun neverEarlierThanTheSessionsOwnTime() {
    assertEquals(created, SessionSyncTime.lastSyncedAt("s1", created, "s1", created - 5_000))
  }
}
