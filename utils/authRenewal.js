// Single-flight renewal of the access token after a 401 (docs/authentication.md).
//
// Every request that fails with an expired access token for the same saved server connection waits for one shared
// renewal. The renewal itself is done natively (AbsDatabase.refreshAccessToken), where native requests and downloads
// share the same single refresh, because the server rotates the refresh token on every use.
//
// A logout or a switch to another server invalidates pending renewals: their callers are rejected straight away with a
// 'stale' error and a result that arrives later is never applied.

export const AUTH_RENEWAL_TIMEOUT_MS = 30000

/** kind: 'rejected' (sign in again), 'transient' (offline, timeout, server error), 'stale' (session changed) */
export class AuthRenewalError extends Error {
  constructor(kind, message) {
    super(message || `Authentication renewal ${kind}`)
    this.name = 'AuthRenewalError'
    this.kind = kind
  }
}

/**
 * @param {Object} deps
 * @param {(serverConnectionConfigId: string) => Promise<{status: string, accessToken?: string}>} deps.refresh
 * @param {() => {serverConnectionConfigId: string|null, token: string|null}} deps.getSession the signed-in session
 * @param {(serverConnectionConfigId: string, accessToken: string, isActive: boolean) => void} [deps.onRenewed]
 * @param {(serverConnectionConfigId: string) => void} [deps.onRejected] runs once per rejected renewal
 * @param {number} [deps.timeoutMs]
 */
export function createAuthRenewal({ refresh, getSession, onRenewed = () => {}, onRejected = () => {}, timeoutMs = AUTH_RENEWAL_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let epoch = 0
  /** @type {Map<string, {promise: Promise<string>, reject: (e: Error) => void}>} */
  const pending = new Map()
  /** Access tokens renewed in this epoch, for servers that are not (yet) the signed-in session. */
  const renewed = new Map()

  // The signed-in session's token is the newest (native renewals update it too); the cache is for other servers.
  const latestToken = (serverConnectionConfigId) => {
    const session = getSession()
    if (session.serverConnectionConfigId === serverConnectionConfigId) return session.token
    return renewed.get(serverConnectionConfigId) || null
  }

  const start = (serverConnectionConfigId) => {
    const startEpoch = epoch
    let settle
    const promise = new Promise((resolve, reject) => (settle = { resolve, reject }))
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimer(timer)
      if (pending.get(serverConnectionConfigId)?.promise === promise) pending.delete(serverConnectionConfigId)
      fn(value)
    }
    const entry = { promise, reject: (error) => finish(settle.reject, error) }
    pending.set(serverConnectionConfigId, entry)
    // Callers that stopped waiting must not turn a failure into an unhandled rejection.
    promise.catch(() => {})

    const timer = setTimer(() => finish(settle.reject, new AuthRenewalError('transient', 'Authentication renewal timed out')), timeoutMs)

    Promise.resolve()
      .then(() => refresh(serverConnectionConfigId))
      .then(
        (result) => {
          if (settled) return
          if (epoch !== startEpoch) return finish(settle.reject, new AuthRenewalError('stale'))
          if (result?.status === 'success' && result.accessToken) {
            renewed.set(serverConnectionConfigId, result.accessToken)
            const isActive = getSession().serverConnectionConfigId === serverConnectionConfigId
            try {
              onRenewed(serverConnectionConfigId, result.accessToken, isActive)
            } catch (error) {
              console.error('[authRenewal] Failed to apply the renewed token', error)
            }
            return finish(settle.resolve, result.accessToken)
          }
          if (result?.status === 'rejected') {
            finish(settle.reject, new AuthRenewalError('rejected', 'Authentication expired - sign in again'))
            try {
              onRejected(serverConnectionConfigId)
            } catch (error) {
              console.error('[authRenewal] Failed to handle the rejected renewal', error)
            }
            return
          }
          finish(settle.reject, new AuthRenewalError('transient', 'Authentication renewal could not be completed'))
        },
        () => finish(settle.reject, new AuthRenewalError(epoch === startEpoch ? 'transient' : 'stale', 'Authentication renewal failed'))
      )
    return promise
  }

  return {
    /**
     * Renewed access token for a request that got a 401.
     * @param {{serverConnectionConfigId: string, token: string|null}} request the server and token it was sent with
     * @returns {Promise<string>} rejects with AuthRenewalError
     */
    renew({ serverConnectionConfigId, token }) {
      if (!serverConnectionConfigId) return Promise.reject(new AuthRenewalError('transient', 'No server connection to renew'))
      const latest = latestToken(serverConnectionConfigId)
      // Another request already renewed the token since this one was sent.
      if (latest && token && latest !== token) return Promise.resolve(latest)
      return pending.get(serverConnectionConfigId)?.promise || start(serverConnectionConfigId)
    },
    /** Latest token renewed for a server in this epoch (a saved server being connected is not the session yet). */
    renewedToken(serverConnectionConfigId) {
      return renewed.get(serverConnectionConfigId) || null
    },
    /**
     * Newest access token known for a saved server: the signed-in session's if it is that server, else one renewed for
     * it in this epoch, else null. Never another server's or account's token.
     */
    latestToken,
    /** Logout or server switch: pending callers fail with 'stale' now and late results are ignored. */
    invalidate() {
      epoch++
      renewed.clear()
      const entries = [...pending.values()]
      pending.clear()
      entries.forEach((entry) => entry.reject(new AuthRenewalError('stale', 'Session changed during authentication renewal')))
    },
    get pendingCount() {
      return pending.size
    }
  }
}

/** Whether a request may trigger renewal: the auth endpoints themselves never do, so renewal can't recurse. */
export function isRenewableUrl(url) {
  const path = String(url || '').split('?')[0]
  return !/\/(auth\/refresh|login|logout)$/.test(path)
}
