package app.absplus.android.server

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs at most one operation per key. Callers that arrive while it runs wait for the same result instead of starting
 * another one. The key is released before the result is delivered, so a caller that arrives afterwards starts a fresh
 * operation and a failure is never remembered.
 */
class SingleFlight<K : Any, R>(private val onCallbackError: (Exception) -> Unit = {}) {
  private val waiters = HashMap<K, MutableList<(R) -> Unit>>()

  /**
   * [start] must eventually call its completion once; later calls are ignored. If it throws, every caller receives
   * [onError]. Returns true when this call started the operation, false when it joined one already running.
   */
  fun run(key: K, onError: R, start: (complete: (R) -> Unit) -> Unit, onResult: (R) -> Unit): Boolean {
    synchronized(waiters) {
      val running = waiters[key]
      if (running != null) {
        running.add(onResult)
        return false
      }
      waiters[key] = mutableListOf(onResult)
    }
    val completed = AtomicBoolean(false)
    val complete: (R) -> Unit = { result ->
      if (completed.compareAndSet(false, true)) {
        val callers = synchronized(waiters) { waiters.remove(key) }.orEmpty()
        // One failing caller must not keep the others waiting.
        callers.forEach { caller ->
          try {
            caller(result)
          } catch (e: Exception) {
            onCallbackError(e)
          }
        }
      }
    }
    try {
      start(complete)
    } catch (e: Exception) {
      complete(onError)
    }
    return true
  }

  fun isRunning(key: K): Boolean = synchronized(waiters) { waiters.containsKey(key) }
}
