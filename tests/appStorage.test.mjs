import test from 'node:test'
import assert from 'node:assert/strict'
import { appStorageDownloadFolder, appStorageLabel, isAppStorageFolderId, safFoldersFor } from '../utils/appStorage.js'

test('isAppStorageFolderId', () => {
  assert.equal(isAppStorageFolderId('internal-book'), true)
  assert.equal(isAppStorageFolderId('appsd-79EC-9B33-podcast'), true)
  assert.equal(isAppStorageFolderId('cHJpbWFyeTpBdWRpb2Jvb2tzL0FCU1RFU1Q='), false)
  assert.equal(isAppStorageFolderId(undefined), false)
  assert.equal(isAppStorageFolderId(null), false)
})

test('noModalWithoutSaf', () => {
  const saf = { id: 'cHJpbWFyeTpBdWRpb2Jvb2tzL0FCU1RFU1Q=', mediaType: 'podcast' }
  const folders = [
    { id: 'internal-podcast', mediaType: 'podcast' },
    { id: 'appsd-79EC-9B33-podcast', mediaType: 'podcast' },
    { id: 'cHJpbWFyeTpCb29rcw==', mediaType: 'book' }
  ]
  assert.deepEqual(safFoldersFor(folders, 'podcast'), [])
  assert.deepEqual(safFoldersFor([...folders, saf], 'podcast'), [saf])
  assert.deepEqual(safFoldersFor(null, 'podcast'), [])
})

test('appStorageFolderHasEmptyId', () => {
  assert.deepEqual(appStorageDownloadFolder('book', 'X'), { id: '', name: 'X', mediaType: 'book' })
  const strings = { LabelAppStorageLocation: 'App storage · {0}', LabelDownloadStorageInternal: 'Internal', LabelDownloadStorageSdCard: 'SD card' }
  assert.equal(appStorageLabel(strings, 'internal'), 'App storage · Internal')
  assert.equal(appStorageLabel(strings, 'sd:79EC-9B33'), 'App storage · SD card')
  assert.equal(appStorageLabel(strings, undefined), 'App storage · Internal')
})
