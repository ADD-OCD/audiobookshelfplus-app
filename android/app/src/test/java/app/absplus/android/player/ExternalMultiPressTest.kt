package app.absplus.android.player

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.view.KeyEvent
import androidx.test.core.app.ApplicationProvider
import app.absplus.android.data.*
import app.absplus.android.device.DeviceManager
import app.absplus.android.managers.DbManager
import com.google.android.exoplayer2.Player
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Actual callback -> recognizer -> service navigation/seek; only the clock and player are synthetic. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ExternalMultiPressTest {
  private class Clock : ExternalPressScheduler {
    data class Task(val due: Long, val action: () -> Unit, var cancelled: Boolean = false)
    var time = 1000L
    val tasks = mutableListOf<Task>()
    override fun now() = time
    override fun after(delayMs: Long, action: () -> Unit): () -> Unit {
      val task = Task(time + delayMs, action); tasks.add(task)
      return { task.cancelled = true }
    }
    fun advance(ms: Long, deliver: Boolean = true, includeCancelled: Boolean = false) {
      time += ms
      if (deliver) {
        val due = tasks.filter { it.due <= time }.sortedBy { it.due }
        tasks.removeAll(due.toSet())
        due.filter { includeCancelled || !it.cancelled }.forEach { it.action() }
      }
    }
  }
  private lateinit var service: PlayerNotificationService
  private lateinit var callback: MediaSessionCallback
  private val clock = Clock()
  private var position = 50_000L
  private var index = 0
  private var playing = false
  private var keyTime = 1000L
  private val actions = mutableListOf<String>()
  private val settings get() = DeviceManager.deviceData.deviceSettings!!
  private val session get() = service.currentPlaybackSession!!
  private fun current() = position + session.getTrackStartOffsetMs(index)

  @Before fun setup() {
    DbManager.initialize(ApplicationProvider.getApplicationContext<Context>())
    DeviceManager.deviceData = DeviceData(mutableListOf(), null, DeviceSettings.default(), null)
    settings.externalMediaMultiPressEnabled = true
    settings.jumpForwardTime = 30; settings.jumpBackwardsTime = 15
    service = PlayerNotificationService()
    ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply { isAccessible = true }
      .invoke(service, ApplicationProvider.getApplicationContext<Context>())
    service.externalPressScheduler = clock
    val tracks = mutableListOf(
      AudioTrack(1, 0.0, 90.0, "One", "", "audio/wav", null, true, "one", 1),
      AudioTrack(2, 90.0, 90.0, "Two", "", "audio/wav", null, true, "two", 2))
    service.currentPlaybackSession = PlaybackSession("synthetic", null, "book", null, "book", MediaTypeMetadata("Fixture", false),
      DeviceInfo("fixture", "fixture", "fixture", 35, "0"),
      listOf(BookChapter(1, 0.0, 60.0, "One"), BookChapter(2, 60.0, 120.0, "Two"), BookChapter(3, 120.0, 180.0, "Three")),
      "Fixture", null, null, 180.0, 0, 0L, 0L, 0L, tracks, 50.0, null, null, null, null, null, null)
    service.currentPlayer = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, args ->
      when (method.name) {
        "getMediaItemCount" -> session.audioTracks.size
        "getCurrentMediaItemIndex" -> index
        "getCurrentPosition" -> position
        "isPlaying", "getPlayWhenReady" -> playing
        "setVolume" -> null
        "play" -> { playing = true; actions.add("play"); null }
        "pause" -> { playing = false; actions.add("pause"); null }
        "seekTo" -> {
          if (args!!.size == 2) { index = args[0] as Int; position = args[1] as Long } else position = args[0] as Long
          actions.add("seek:${current()}"); null
        }
        else -> throw UnsupportedOperationException(method.name)
      }
    } as Player
    callback = MediaSessionCallback(service)
  }

  private fun event(code: Int, action: Int, down: Long, at: Long = down + 20, repeat: Int = 0, flags: Int = 0): Intent =
    Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(down, at, action, code, repeat, 0, 7, 0, flags))

  private fun press(forward: Boolean, duplicates: Boolean = false) {
    val code = if (forward) KeyEvent.KEYCODE_MEDIA_NEXT else KeyEvent.KEYCODE_MEDIA_PREVIOUS
    keyTime += 30
    assertTrue(callback.onMediaButtonEvent(event(code, KeyEvent.ACTION_DOWN, keyTime)))
    val up = event(code, KeyEvent.ACTION_UP, keyTime)
    assertTrue(callback.onMediaButtonEvent(up))
    if (duplicates) callback.onMediaButtonEvent(up)
  }
  private fun reset(at: Long) {
    service.cancelExternalPresses(); clock.advance(1000)
    index = if (at >= 90_000) 1 else 0; position = at - index * 90_000
    actions.clear()
  }
  private fun gesture(forward: Boolean, count: Int) {
    repeat(count) {
      press(forward)
      if (it < 2) assertTrue("No single/double action before recognition", actions.isEmpty())
      clock.advance(50)
    }
    clock.advance(350)
  }

  @Test fun allSixDefaultGesturesExecuteExactlyOneRealNavigationAction() {
    for ((forward, expected) in listOf(true to listOf(80_000L, 60_000L, 90_000L), false to listOf(100_000L, 60_000L, 0L))) {
      for (count in 1..3) {
        reset(if (forward) 50_000 else 115_000)
        gesture(forward, count)
        assertEquals("$forward/$count", listOf("seek:${expected[count - 1]}"), actions)
        assertFalse(playing)
      }
    }
  }

  @Test fun allSixAssignmentsAreIndependentAndCanReverseDirection() {
    settings.externalMediaForwardSingle = "skip_backward"; settings.externalMediaForwardDouble = "previous_chapter"; settings.externalMediaForwardTriple = "previous_file"
    settings.externalMediaBackwardSingle = "skip_forward"; settings.externalMediaBackwardDouble = "next_chapter"; settings.externalMediaBackwardTriple = "next_file"
    for ((forward, expected) in listOf(true to listOf(100_000L, 60_000L, 0L), false to listOf(80_000L, 60_000L, 90_000L))) {
      for (count in 1..3) {
        reset(if (forward) 115_000 else 50_000); gesture(forward, count)
        assertEquals(listOf("seek:${expected[count - 1]}"), actions)
      }
    }
  }

  @Test fun duplicateDeliveryDoesNotConsumeATapAndVeryFastDistinctPressesDo() {
    press(true, true); clock.advance(1); press(true, true)
    assertTrue(actions.isEmpty()); clock.advance(350)
    assertEquals(listOf("seek:60000"), actions)
    reset(50_000); repeat(3) { press(true, true); clock.advance(1) }
    assertEquals(listOf("seek:90000"), actions)
    press(true); clock.advance(350) // extra press after a triple is suppressed
    assertEquals(1, actions.size)
  }

  @Test fun holdsRepeatsAndCancelledKeysDoNotBecomeTaps() {
    val code = KeyEvent.KEYCODE_MEDIA_NEXT
    callback.onMediaButtonEvent(event(code, KeyEvent.ACTION_DOWN, 2000))
    callback.onMediaButtonEvent(event(code, KeyEvent.ACTION_DOWN, 2000, 2100, repeat = 1, flags = KeyEvent.FLAG_LONG_PRESS))
    val up = event(code, KeyEvent.ACTION_UP, 2000, 2120)
    callback.onMediaButtonEvent(up); callback.onMediaButtonEvent(up)
    callback.onMediaButtonEvent(event(code, KeyEvent.ACTION_UP, 3000, 3800))
    callback.onMediaButtonEvent(event(code, KeyEvent.ACTION_UP, 4000, flags = KeyEvent.FLAG_CANCELED))
    clock.advance(2000); assertTrue(actions.isEmpty())
  }

  @Test fun alternatingDirectionsHaveIndependentTimersAndCounts() {
    press(true); clock.advance(50); press(false); clock.advance(50); press(true)
    clock.advance(299); assertTrue(actions.isEmpty())
    clock.advance(1); assertEquals(listOf("seek:35000"), actions)
    clock.advance(50); assertEquals(listOf("seek:35000", "seek:60000"), actions)
  }

  @Test fun expiredTimersDoNotTurnALaterPressIntoADoubleWhenMainThreadWasBusy() {
    press(true); clock.advance(351, deliver = false); press(true)
    assertEquals(listOf("seek:80000"), actions)
    clock.advance(350); assertEquals(listOf("seek:80000", "seek:110000"), actions)
  }

  @Test fun sessionReplacementRemovalCancellationAndMappingChangesInvalidatePendingWork() {
    press(true); service.currentPlaybackSession = session.clone(); clock.advance(350, includeCancelled = true)
    assertTrue(actions.isEmpty())
    press(true); val old = session; service.currentPlaybackSession = null
    clock.advance(350, includeCancelled = true); assertTrue(actions.isEmpty())
    service.currentPlaybackSession = old; press(true); service.cancelExternalPresses()
    clock.advance(350, includeCancelled = true); assertTrue(actions.isEmpty())
    press(true); settings.externalMediaForwardSingle = "next_file"
    clock.advance(350); assertTrue(actions.isEmpty())
  }

  @Test fun aKeyHeldAcrossAMediaChangeCannotNavigateTheReplacementSession() {
    val code = KeyEvent.KEYCODE_MEDIA_NEXT
    callback.onMediaButtonEvent(event(code, KeyEvent.ACTION_DOWN, 5000))
    service.currentPlaybackSession = session.clone()
    val up = event(code, KeyEvent.ACTION_UP, 5000)
    callback.onMediaButtonEvent(up); callback.onMediaButtonEvent(up)
    clock.advance(350); assertTrue(actions.isEmpty())
  }

  @Test fun anonymousTransportCommandsUseSingleOnlyWithConservativeMixedRouteGuard() {
    callback.onSkipToNext(); callback.onSkipToNext(); press(true)
    assertEquals(listOf("seek:80000"), actions)
    clock.advance(350); assertEquals(1, actions.size)
    reset(50_000); press(true); callback.onSkipToNext(); callback.onCustomAction(CUSTOM_ACTION_SKIP_FORWARD, null)
    clock.advance(350); assertEquals(listOf("seek:80000"), actions)
    clock.advance(350); callback.onSkipToNext(); assertEquals(listOf("seek:80000", "seek:110000"), actions)
    reset(50_000)
    // Timestamp-free commands (including synthetic widget commands) cannot supply a tap identity.
    repeat(2) { callback.onMediaButtonEvent(event(KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.ACTION_UP, 0, 0)) }
    clock.advance(350); assertEquals(listOf("seek:80000"), actions)
  }

  @Test fun disabledModeIsImmediatePreservesNavigationModesAndDoesNotDebounceTransport() {
    settings.externalMediaMultiPressEnabled = false
    listOf("time" to 80_000L, "chapters" to 60_000L, "files" to 90_000L).forEach { (mode, expected) ->
      settings.externalMediaNavigation = mode; reset(50_000); press(true)
      assertEquals(listOf("seek:$expected"), actions)
      clock.advance(350); assertEquals(1, actions.size)
    }
    settings.externalMediaNavigation = "time"; reset(50_000)
    callback.onSkipToNext(); callback.onSkipToNext(); assertEquals(listOf("seek:80000", "seek:110000"), actions)
  }

  @Test fun dedicatedFastForwardRewindAndNotificationJumpsRemainImmediateTimeActions() {
    settings.externalMediaForwardSingle = "none"
    callback.onFastForward(); callback.onRewind()
    service.notificationControls(service.currentPlayer).seekForward()
    assertEquals(listOf("seek:80000", "seek:65000", "seek:95000"), actions)
    clock.advance(350); assertEquals(3, actions.size)
  }

  @Test fun explicitUnavailableChapterOrFileActionsAndItemBoundariesDoNothing() {
    settings.externalMediaForwardSingle = "next_chapter"
    session.chapters = emptyList(); gesture(true, 1); assertTrue(actions.isEmpty())
    reset(50_000); settings.externalMediaForwardSingle = "next_file"; session.playMethod = PLAYMETHOD_TRANSCODE
    gesture(true, 1); assertTrue(actions.isEmpty())
    reset(115_000); session.playMethod = PLAYMETHOD_DIRECTPLAY
    val queue = listOf(PlayerNotificationService.PlaylistQueueItem("book", null), PlayerNotificationService.PlaylistQueueItem("another", null))
    service.playlistQueue = queue; service.playlistQueueIndex = 0
    gesture(true, 1); assertTrue(actions.isEmpty()); assertSame(queue, service.playlistQueue); assertEquals(0, service.playlistQueueIndex)
  }

  @Test fun noneUnknownAndPlayPauseAssignmentsAreSafeForPausedAndRestoringSessions() {
    settings.externalMediaForwardSingle = "play_pause"; gesture(true, 1)
    assertTrue(playing); assertEquals(listOf("play"), actions)
    reset(50_000); gesture(true, 1); assertFalse(playing); assertEquals(listOf("pause"), actions)
    for (value in listOf("none", "unrecognized")) {
      reset(50_000); settings.externalMediaForwardSingle = value; gesture(true, 1); assertTrue(actions.isEmpty())
    }
    reset(50_000); settings.externalMediaForwardSingle = "skip_forward"
    PlayerNotificationService::class.java.getDeclaredField("isRestoringPlayback").apply { isAccessible = true }.setBoolean(service, true)
    press(true); clock.advance(350); assertTrue(actions.isEmpty())
  }

  @Test fun settingsPersistAndOldRecordsDefaultToOffWithSuggestedMappings() {
    assertFalse(DeviceSettings.default().externalMediaMultiPressEnabled)
    settings.externalMediaForwardSingle = "none"; settings.externalMediaBackwardTriple = "play_pause"
    DeviceManager.dbManager.saveDeviceData(DeviceManager.deviceData)
    DeviceManager.deviceData = DeviceManager.dbManager.getDeviceData()
    assertTrue(settings.externalMediaMultiPressEnabled); assertEquals("none", settings.externalMediaForwardSingle)
    assertEquals("play_pause", settings.externalMediaBackwardTriple)
    settings.externalMediaForwardSingle = null; settings.externalMediaBackwardTriple = null
    val normalized = ExternalPressBindings.from(settings)
    assertEquals("skip_forward", normalized.forwardSingle); assertEquals("previous_file", normalized.backwardTriple)
  }
}
