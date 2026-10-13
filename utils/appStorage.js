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

export function appStorageFolderIds(downloadStorage) {
  const value = String(downloadStorage || '')
  const uuid = value.startsWith('sd:') ? value.slice(3) : ''
  return uuid ? [`appsd-${uuid}-book`, `appsd-${uuid}-podcast`] : ['internal-book', 'internal-podcast']
}

// An app storage folder that is neither the current download storage nor holds items is just leftover from a past setting.
export function visibleFolders(folders, itemsCountByFolder, currentAppFolderIds) {
  return (folders || []).filter((f) => !isAppStorageFolderId(f.id) || currentAppFolderIds.includes(f.id) || ((itemsCountByFolder || {})[f.id] || 0) > 0)
}
