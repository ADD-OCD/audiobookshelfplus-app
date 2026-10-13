// Folders the app owns on internal storage or its SD card directory; everything else is a user-picked folder.
export function isAppStorageFolderId(id) {
  return typeof id === 'string' && (id.startsWith('internal-') || id.startsWith('appsd-'))
}

export function safFoldersFor(folders, mediaType) {
  return (folders || []).filter((f) => f && f.mediaType == mediaType && !isAppStorageFolderId(f.id))
}

// An empty id lets native pick the item's own folder or the download storage setting.
export function appStorageDownloadFolder(mediaType, label) {
  return { id: '', name: label, mediaType }
}

export function appStorageLabel(strings, downloadStorage) {
  const location = String(downloadStorage || '').startsWith('sd:') ? strings.LabelDownloadStorageSdCard : strings.LabelDownloadStorageInternal
  return strings.LabelAppStorageLocation.replace('{0}', location)
}

export async function appStorageFolderFor(ctx, mediaType) {
  let status = null
  try {
    status = await ctx.$db.getDownloadStorageStatus()
  } catch (error) {
    console.error('[appStorage] Failed to read download storage status', error)
  }
  return appStorageDownloadFolder(mediaType, appStorageLabel(ctx.$strings, status?.downloadStorage))
}
