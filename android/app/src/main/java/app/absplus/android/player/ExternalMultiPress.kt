package app.absplus.android.player

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import app.absplus.android.data.DeviceSettings
import app.absplus.android.data.PlaybackSession

/** Immutable settings snapshot: a pending gesture never acquires new mappings midway through. */
internal data class ExternalPressBindings(
  val enabled: Boolean,
  val forwardSingle: String, val forwardDouble: String, val forwardTriple: String,
  val backwardSingle: String, val backwardDouble: String, val backwardTriple: String
) {
  fun action(forward: Boolean, count: Int): String =
    (if (forward) listOf(forwardSingle, forwardDouble, forwardTriple)
     else listOf(backwardSingle, backwardDouble, backwardTriple))[count.coerceIn(1, 3) - 1]

  companion object {
    val actions = setOf("skip_forward", "skip_backward", "next_chapter", "previous_chapter",
      "next_file", "previous_file", "play_pause", "none")
    private fun valid(value: String?, default: String): String =
      if (value == null) default else value.takeIf { it in actions } ?: "none"

    fun from(settings: DeviceSettings) = ExternalPressBindings(settings.externalMediaMultiPressEnabled,
      valid(settings.externalMediaForwardSingle, "skip_forward"),
      valid(settings.externalMediaForwardDouble, "next_chapter"),
      valid(settings.externalMediaForwardTriple, "next_file"),
      valid(settings.externalMediaBackwardSingle, "skip_backward"),
      valid(settings.externalMediaBackwardDouble, "previous_chapter"),
      valid(settings.externalMediaBackwardTriple, "previous_file"))
  }
}

internal data class ExternalPressContext(val session: PlaybackSession, val bindings: ExternalPressBindings)

internal interface ExternalPressScheduler {
  fun now(): Long
  /** Returns a cancellation function. Callbacks must run on the same thread as input. */
  fun after(delayMs: Long, action: () -> Unit): () -> Unit
}

internal class MainExternalPressScheduler : ExternalPressScheduler {
  private val handler = Handler(Looper.getMainLooper())
  override fun now() = SystemClock.uptimeMillis()
  override fun after(delayMs: Long, action: () -> Unit): () -> Unit {
    val task = Runnable(action)
    handler.postDelayed(task, delayMs)
    return { handler.removeCallbacks(task) }
  }
}

/** Service-owned, main-thread recognizer. Only identifiable completed key presses are counted. */
internal class ExternalMultiPress(
  private val scheduler: ExternalPressScheduler,
  private val current: () -> ExternalPressContext?,
  private val dispatch: (String) -> Unit
) {
  companion object { const val WINDOW_MS = 350L }
  private class Pending(val context: ExternalPressContext, val count: Int, val deadline: Long) { var cancel: () -> Unit = {} }
  private data class Guard(val identified: Boolean, val until: Long, val blocked: Boolean)
  private val pending = mutableMapOf<Boolean, Pending>()
  private val guards = mutableMapOf<Boolean, Guard>()
  private var context: ExternalPressContext? = null

  fun cancel() {
    pending.values.forEach { it.cancel() }
    pending.clear()
    guards.clear()
    context = null
  }

  fun press(forward: Boolean, identified: Boolean) {
    val active = current()
    if (active == null || !active.bindings.enabled) { cancel(); return }
    if (context != active) { cancel(); context = active }
    val now = scheduler.now()
    guards[forward]?.let {
      // Anonymous callbacks cannot prove distinct presses. Do not combine input families into a gesture.
      if (now < it.until && (it.blocked || it.identified != identified)) return
    }
    // A busy main loop may receive another input before delivering an overdue timer.
    pending[forward]?.takeIf { now >= it.deadline }?.let {
      pending.remove(forward)
      it.cancel()
      if (current() == it.context) dispatch(it.context.bindings.action(forward, it.count))
    }
    if (!identified) {
      guards[forward] = Guard(false, now + WINDOW_MS, true)
      dispatch(active.bindings.action(forward, 1))
      return
    }
    val previous = pending.remove(forward)
    previous?.cancel?.invoke()
    val count = (previous?.count ?: 0) + 1
    guards[forward] = Guard(true, now + WINDOW_MS, count == 3)
    if (count == 3) {
      dispatch(active.bindings.action(forward, 3))
      return
    }
    val gesture = Pending(active, count, now + WINDOW_MS)
    pending[forward] = gesture
    gesture.cancel = scheduler.after(WINDOW_MS) {
      // Identity check also protects against callbacks that were already queued when cancelled.
      if (pending[forward] !== gesture) return@after
      pending.remove(forward)
      if (current() == gesture.context) dispatch(gesture.context.bindings.action(forward, gesture.count))
    }
  }
}
