// Retries a failed bookshelf page fetch a few times, with a growing delay. Without it a page that failed once
// (a network blip on cellular, an expired token) stayed marked as loaded, so its rows stayed empty placeholders
// for as long as the list was open. After the last attempt the page is still left unloaded, so scrolling past it
// fetches it again.
export function createPageRetry({ maxAttempts = 3, delayMs = 1500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const attempts = {}
  const timers = {}
  return {
    /** Schedules retry(page) unless one is already pending or the attempts are used up; true when scheduled. */
    failed(page, retry) {
      attempts[page] = (attempts[page] || 0) + 1
      if (timers[page] || attempts[page] > maxAttempts) return false
      timers[page] = setTimer(() => {
        delete timers[page]
        retry(page)
      }, delayMs * attempts[page])
      return true
    },
    succeeded(page) {
      delete attempts[page]
    },
    /** Drops pending retries (the list was reset or left). */
    reset() {
      Object.keys(timers).forEach((page) => {
        clearTimer(timers[page])
        delete timers[page]
      })
      Object.keys(attempts).forEach((page) => delete attempts[page])
    },
    pending(page) {
      return !!timers[page]
    }
  }
}
