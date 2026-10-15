// Settings → Download storage: status lines for the native download storage status (getDownloadStorageStatus / onDownloadStorageStatus).

const WAITING_KEYS = [
  ['PLAYING', 'MessageDownloadStorageWaitingPlaying'],
  ['DOWNLOADING', 'MessageDownloadStorageWaitingDownloading'],
  ['UNAVAILABLE', 'MessageDownloadStorageWaitingUnavailable'],
  ['NO_SPACE', 'MessageDownloadStorageWaitingNoSpace'],
  ['RETRY', 'MessageDownloadStorageWaitingRetry'],
  ['FINISHING', 'MessageDownloadStorageWaitingFinishing']
]

// Moves that keep the old copy until a check after the next restart, and moves that kept both copies
const JOURNAL_KEYS = [
  ['cleanupPending', 'MessageDownloadStorageCleanupPending'],
  ['needsAttention', 'MessageDownloadStorageNeedsAttention']
]

function supplant(str, subs) {
  return String(str).replace(/{([^{}]*)}/g, (match, key) => {
    const value = subs[key]
    return typeof value === 'string' || typeof value === 'number' ? value : match
  })
}

/**
 * @param {object} status getDownloadStorageStatus result
 * @param {object} strings translation strings
 * @param {(bytes: number) => string} bytesPretty
 * @returns {{ lines: string[], sdSelectable: boolean }}
 */
export function storageStatusView(status, strings, bytesPretty) {
  if (!status) return { lines: [], sdSelectable: false }
  const lines = []
  const sd = status.sd
  const sdSelectable = sd?.mounted === true
  const setting = String(status.downloadStorage || '')
  // A different inserted card is shown below as selectable, but the configured one is still missing
  if (sd && setting.startsWith('sd:') && (sd.mounted === false || sd.uuid !== setting.slice(3))) lines.push(strings.LabelDownloadStorageUnavailable)
  if (sdSelectable) lines.push(supplant(strings.MessageDownloadStorageVolume, [sd.uuid || '', bytesPretty(sd.freeBytes)]))

  const move = status.move
  if (move?.running && move.total > 0) {
    const bytes = [bytesPretty(move.bytesDone), bytesPretty(move.bytesTotal)]
    if (move.total === 1) {
      lines.push(supplant(strings.MessageDownloadStorageMovingOne, bytes))
    } else {
      lines.push(supplant(strings.MessageDownloadStorageMoving, [Math.min(move.done + 1, move.total), move.total, ...bytes]))
    }
  }

  const waiting = move?.waiting || {}
  for (const [reason, key] of WAITING_KEYS) {
    const count = waiting[reason] || 0
    if (count <= 0) continue
    lines.push(count === 1 ? strings[`${key}One`] : supplant(strings[key], [count]))
  }

  for (const [field, key] of JOURNAL_KEYS) {
    const count = Number(status[field]) || 0
    if (count <= 0) continue
    lines.push(count === 1 ? strings[`${key}One`] : supplant(strings[key], [count]))
  }

  if (typeof move?.lastError === 'string' && move.lastError) lines.push(supplant(strings.MessageDownloadStorageMoveFailed, [move.lastError]))

  return { lines, sdSelectable }
}

export const DOWNLOAD_STORAGE_VIEW_KEYS = [
  'LabelDownloadStorageUnavailable',
  'MessageDownloadStorageVolume',
  'MessageDownloadStorageMoving',
  'MessageDownloadStorageMovingOne',
  'MessageDownloadStorageMoveFailed',
  ...WAITING_KEYS.flatMap(([, key]) => [key, `${key}One`]),
  ...JOURNAL_KEYS.flatMap(([, key]) => [key, `${key}One`])
]
