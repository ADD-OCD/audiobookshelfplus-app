// Folders the app owns on internal storage or its SD card directory; everything else is a user-picked folder.
export function isAppStorageFolderId(id) {
  return typeof id === 'string' && (id.startsWith('internal-') || id.startsWith('appsd-'))
}
