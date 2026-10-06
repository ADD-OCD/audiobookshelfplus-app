// What a download in the native queue is doing, and which controls it offers. Derived from the item's
// parts as the native downloader reports them (DownloadItemManager / DownloadControls):
// - a part with a downloadId is being transferred; completed && !moved is a finished transfer still
//   being saved to its folder; isMoving is that save in progress;
// - failed is terminal (automatic retries are used up, or the folder can't be written: permissionLost);
// - waitingForSpace is queued until storage frees up.
// Retry restarts unfinished files from byte 0 (finished files are kept), so it is never called Resume.

export const DownloadState = Object.freeze({
  FINISHING: 'finishing',
  DOWNLOADING: 'downloading',
  WAITING_FOR_STORAGE: 'waitingForStorage',
  QUEUED: 'queued',
  FAILED: 'failed',
  FOLDER_ACCESS: 'folderAccess'
})

export const DownloadAction = Object.freeze({
  CANCEL: 'cancel',
  RETRY: 'retry',
  CHOOSE_FOLDER: 'chooseFolder',
  CLEAR: 'clear'
})

const parts = (item) => (item && Array.isArray(item.downloadItemParts) ? item.downloadItemParts : [])

export function downloadState(item) {
  const all = parts(item)
  if (all.length && all.every((p) => p.completed && p.moved && !p.failed)) return DownloadState.FINISHING
  // Anything still transferring or being saved keeps the item active, even if another file already failed
  const active = all.some((p) => !p.failed && (p.isMoving || (!p.completed && p.downloadId != null) || (p.completed && !p.moved)))
  if (active) return DownloadState.DOWNLOADING
  if (all.some((p) => p.failed && p.permissionLost)) return DownloadState.FOLDER_ACCESS
  if (all.some((p) => p.failed)) return DownloadState.FAILED
  if (all.some((p) => !p.completed && p.waitingForSpace)) return DownloadState.WAITING_FOR_STORAGE
  return DownloadState.QUEUED
}

export function downloadActions(state) {
  switch (state) {
    case DownloadState.DOWNLOADING:
    case DownloadState.QUEUED:
    case DownloadState.WAITING_FOR_STORAGE:
      return [DownloadAction.CANCEL]
    case DownloadState.FAILED:
      return [DownloadAction.RETRY, DownloadAction.CLEAR]
    case DownloadState.FOLDER_ACCESS:
      return [DownloadAction.CHOOSE_FOLDER, DownloadAction.CLEAR]
    default:
      return []
  }
}

/** 0..1 by bytes across the item's files (finished files count in full). */
export function downloadProgress(item) {
  let total = 0
  let done = 0
  parts(item).forEach((p) => {
    total += p.fileSize || 0
    done += p.moved ? p.fileSize || 0 : Math.min(p.bytesDownloaded || 0, p.fileSize || 0)
  })
  return total > 0 ? Math.min(1, done / total) : 0
}

/** The device folder a folder-access failure needs re-selected, from the failed part. */
export function lostFolder(item) {
  const part = parts(item).find((p) => p.failed && p.permissionLost)
  return part ? { id: part.localFolderId, name: part.localFolderName } : null
}
