// Settings → Updates: what to show for the native updater's state (android/.../updater/UpdateStateMachine.kt). One state
// gives one status line and only the buttons that state allows, so the section never shows contradictory controls.

const ERROR_KEYS = {
  NETWORK: 'MessageUpdateErrorNetwork',
  TIMEOUT: 'MessageUpdateErrorNetwork',
  TLS: 'MessageUpdateErrorSecureConnection',
  RATE_LIMITED: 'MessageUpdateErrorRateLimited',
  GITHUB_ERROR: 'MessageUpdateErrorGithub',
  UNEXPECTED_CONTENT: 'MessageUpdateErrorUnexpected',
  NO_RELEASE: 'MessageUpdateErrorNoRelease',
  MALFORMED: 'MessageUpdateErrorRelease',
  NOT_STABLE: 'MessageUpdateErrorRelease',
  NO_APK: 'MessageUpdateErrorRelease',
  AMBIGUOUS_APK: 'MessageUpdateErrorRelease',
  BAD_ASSET: 'MessageUpdateErrorRelease',
  UNTRUSTED_URL: 'MessageUpdateErrorRelease',
  SIZE_MISMATCH: 'MessageUpdateErrorDownload',
  DIGEST_MISMATCH: 'MessageUpdateErrorDownload',
  STORAGE: 'MessageUpdateErrorStorage',
  INVALID_APK: 'MessageUpdateErrorVerification',
  WRONG_PACKAGE: 'MessageUpdateErrorVerification',
  DEBUGGABLE: 'MessageUpdateErrorVerification',
  UNSIGNED: 'MessageUpdateErrorVerification',
  UNTRUSTED_SIGNER: 'MessageUpdateErrorVerification',
  MULTIPLE_SIGNERS: 'MessageUpdateErrorVerification',
  NOT_NEWER: 'MessageUpdateErrorNotNewer',
  INSTALL_FAILED: 'MessageUpdateErrorInstall',
  INSTALL_BLOCKED: 'MessageUpdateErrorInstallBlocked'
}

const STATUS_KEYS = {
  IDLE: null,
  CHECKING: 'MessageUpdateChecking',
  UP_TO_DATE: 'MessageUpdateUpToDate',
  AVAILABLE: 'MessageUpdateAvailable',
  DOWNLOADING: 'MessageUpdateDownloading',
  VERIFYING: 'MessageUpdateVerifying',
  READY: 'MessageUpdateReady',
  INSTALLING: 'MessageUpdateInstalling',
  CANCELLED: 'MessageUpdateCancelled',
  FAILED: null,
  UNSUPPORTED: 'MessageUpdateUnsupported'
}

const NOTICE_KEYS = {
  INSTALL_CANCELLED: 'MessageUpdateInstallCancelled',
  INSTALLED: 'MessageUpdateInstalled',
  OBSOLETE_REMOVED: 'MessageUpdateObsolete',
  INTERRUPTED: 'MessageUpdateInterrupted'
}

export function updateErrorKey(code) {
  if (!code) return null
  return ERROR_KEYS[code] || 'MessageUpdateErrorGithub'
}

/**
 * @param {object} s the plugin's state (getState / onUpdateState)
 * @param {boolean} permissionPrompt the user tapped Install and Android needs the "Install unknown apps" permission
 * @returns {{ statusKey, noticeKey, errorKey, showCandidate, showProgress, percent, actions: string[], debugNote }}
 */
export function updateView(s, permissionPrompt = false) {
  const state = (s && s.state) || 'IDLE'
  const hasCandidate = !!(s && s.candidate)
  const downloads = !!(s && s.downloadsEnabled)
  const actions = []
  if (['IDLE', 'UP_TO_DATE', 'AVAILABLE', 'CANCELLED', 'FAILED', 'READY'].includes(state)) actions.push('check')
  if (downloads && hasCandidate && state === 'AVAILABLE') actions.push('download')
  if (downloads && hasCandidate && (state === 'CANCELLED' || (state === 'FAILED' && s.error !== 'NOT_NEWER'))) actions.push('retry')
  if (state === 'DOWNLOADING') actions.push('cancel')
  if (state === 'READY') actions.push('install')
  if (state === 'READY' && permissionPrompt && s.installPermissionNeeded) actions.push('permission')
  if (state === 'INSTALLING') actions.push('reopen')
  if (hasCandidate && !['CHECKING', 'UNSUPPORTED'].includes(state)) actions.push('notes')

  const total = (s && s.totalBytes) || 0
  const done = (s && s.downloadedBytes) || 0
  return {
    statusKey: STATUS_KEYS[state] === undefined ? null : STATUS_KEYS[state],
    noticeKey: (s && NOTICE_KEYS[s.notice]) || null,
    errorKey: state === 'CHECKING' || state === 'DOWNLOADING' ? null : updateErrorKey(s && s.error),
    showCandidate: hasCandidate && ['AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'READY', 'INSTALLING', 'CANCELLED', 'FAILED'].includes(state),
    showProgress: state === 'DOWNLOADING',
    percent: total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0,
    actions,
    debugNote: !!(s && !downloads && state !== 'UNSUPPORTED' && !s.testSource),
    permissionNote: state === 'READY' && permissionPrompt && !!s.installPermissionNeeded
  }
}
