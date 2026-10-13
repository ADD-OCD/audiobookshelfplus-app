package app.absplus.android.updater

enum class UpdateState { IDLE, CHECKING, UP_TO_DATE, AVAILABLE, DOWNLOADING, VERIFYING, READY, INSTALLING, CANCELLED, FAILED, UNSUPPORTED }

/** Informational outcomes shown beside a state (never an error) */
enum class UpdateNotice { INSTALL_CANCELLED, INSTALLED, OBSOLETE_REMOVED, INTERRUPTED }

data class UpdateSnapshot(
  val state: UpdateState = UpdateState.IDLE,
  val candidate: UpdateCandidate? = null,
  val downloadedBytes: Long = 0,
  val totalBytes: Long = 0,
  val error: UpdateErrorCode? = null,
  val readyVersionCode: Long? = null,
  val lastCheckAt: Long? = null,
  val notice: UpdateNotice? = null
)

/**
 * The updater's states and the only allowed moves between them: CHECK -> AVAILABLE -> DOWNLOADING -> VERIFYING ->
 * READY -> INSTALLING, with CANCELLED/FAILED returning to a retryable state. A command that does not fit the current
 * state (a second Check while checking, Download while downloading, Install before verification) is refused, so
 * repeated presses cannot start parallel work and the UI never shows contradictory states.
 */
class UpdateStateMachine(initial: UpdateSnapshot = UpdateSnapshot()) {
  var snapshot: UpdateSnapshot = initial
    private set

  val isBusy get() = snapshot.state in setOf(UpdateState.CHECKING, UpdateState.DOWNLOADING, UpdateState.VERIFYING, UpdateState.INSTALLING)

  private fun move(next: UpdateSnapshot): Boolean {
    snapshot = next
    return true
  }

  fun unsupported() = move(UpdateSnapshot(state = UpdateState.UNSUPPORTED, lastCheckAt = snapshot.lastCheckAt))

  fun beginCheck(): Boolean {
    if (isBusy || snapshot.state == UpdateState.UNSUPPORTED) return false
    return move(snapshot.copy(state = UpdateState.CHECKING, error = null, notice = null))
  }

  /** [candidate] is the latest stable release; [newer] whether it is newer than the installed version */
  fun checkSucceeded(candidate: UpdateCandidate, newer: Boolean, at: Long): Boolean {
    if (snapshot.state != UpdateState.CHECKING) return false
    val keepReady = newer && snapshot.readyVersionCode != null && snapshot.candidate?.tag == candidate.tag
    return move(
      when {
        !newer -> UpdateSnapshot(state = UpdateState.UP_TO_DATE, candidate = candidate, lastCheckAt = at)
        keepReady -> snapshot.copy(state = UpdateState.READY, candidate = candidate, lastCheckAt = at)
        else -> UpdateSnapshot(state = UpdateState.AVAILABLE, candidate = candidate, lastCheckAt = at)
      }
    )
  }

  fun checkFailed(code: UpdateErrorCode): Boolean {
    if (snapshot.state != UpdateState.CHECKING) return false
    // A verified update stays installable when a later check cannot reach GitHub; otherwise the previous result is
    // dropped, so a failed check never offers a download from an older result
    return move(
      if (snapshot.readyVersionCode != null) snapshot.copy(state = UpdateState.READY, error = code, downloadedBytes = 0, totalBytes = 0)
      else UpdateSnapshot(state = UpdateState.FAILED, error = code, lastCheckAt = snapshot.lastCheckAt)
    )
  }

  fun beginDownload(): Boolean {
    val candidate = snapshot.candidate ?: return false
    if (snapshot.state !in setOf(UpdateState.AVAILABLE, UpdateState.CANCELLED, UpdateState.FAILED)) return false
    return move(snapshot.copy(state = UpdateState.DOWNLOADING, downloadedBytes = 0, totalBytes = candidate.apk.size, error = null, notice = null, readyVersionCode = null))
  }

  fun progress(downloaded: Long, total: Long): Boolean {
    if (snapshot.state != UpdateState.DOWNLOADING) return false
    return move(snapshot.copy(downloadedBytes = downloaded, totalBytes = total))
  }

  fun beginVerify(): Boolean {
    if (snapshot.state != UpdateState.DOWNLOADING) return false
    return move(snapshot.copy(state = UpdateState.VERIFYING))
  }

  fun verified(versionCode: Long): Boolean {
    if (snapshot.state != UpdateState.VERIFYING) return false
    return move(snapshot.copy(state = UpdateState.READY, readyVersionCode = versionCode, error = null))
  }

  fun cancelled(): Boolean {
    if (snapshot.state != UpdateState.DOWNLOADING && snapshot.state != UpdateState.VERIFYING) return false
    return move(snapshot.copy(state = UpdateState.CANCELLED, downloadedBytes = 0, error = null))
  }

  /** A download or verification failure: the candidate stays, so Retry downloads again */
  fun failed(code: UpdateErrorCode): Boolean {
    if (snapshot.state != UpdateState.DOWNLOADING && snapshot.state != UpdateState.VERIFYING) return false
    return move(snapshot.copy(state = UpdateState.FAILED, error = code, downloadedBytes = 0, readyVersionCode = null))
  }

  fun beginInstall(): Boolean {
    if (snapshot.state != UpdateState.READY || snapshot.readyVersionCode == null) return false
    return move(snapshot.copy(state = UpdateState.INSTALLING, error = null, notice = null))
  }

  /** Install could not start or Android refused it; [keepReady] when the verified file may be installed again */
  fun installFailed(code: UpdateErrorCode, keepReady: Boolean): Boolean {
    if (snapshot.state != UpdateState.INSTALLING && snapshot.state != UpdateState.READY) return false
    return move(if (keepReady) snapshot.copy(state = UpdateState.READY, error = code) else snapshot.copy(state = UpdateState.FAILED, error = code, readyVersionCode = null))
  }

  fun installCancelled(): Boolean {
    if (snapshot.state != UpdateState.INSTALLING) return false
    return move(snapshot.copy(state = UpdateState.READY, notice = UpdateNotice.INSTALL_CANCELLED))
  }

  fun installSucceeded(): Boolean {
    if (snapshot.state != UpdateState.INSTALLING) return false
    return move(UpdateSnapshot(state = UpdateState.IDLE, lastCheckAt = snapshot.lastCheckAt, notice = UpdateNotice.INSTALLED))
  }

  /** Restores state after a restart: a verified update ([ready]) or the last check's result */
  fun restore(lastCheckAt: Long?, ready: Pair<UpdateCandidate, Long>?, notice: UpdateNotice?): Boolean = move(
    if (ready != null) UpdateSnapshot(state = UpdateState.READY, candidate = ready.first, readyVersionCode = ready.second, lastCheckAt = lastCheckAt, notice = notice)
    else UpdateSnapshot(state = UpdateState.IDLE, lastCheckAt = lastCheckAt, notice = notice)
  )
}
