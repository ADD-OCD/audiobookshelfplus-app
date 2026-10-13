package app.absplus.android.managers

import org.junit.Assert.assertEquals
import org.junit.Test

class StorageMoveServiceTriggerTest {
  @Test
  fun startDecision() {
    assertEquals("an unfinished pass resumes even with nothing to move", true, StorageMovePass.shouldStart(true, true))
    assertEquals(true, StorageMovePass.shouldStart(false, false))
    assertEquals("nothing to do", false, StorageMovePass.shouldStart(false, true))
    assertEquals(true, StorageMovePass.shouldStart(true, false))
  }
}
