import test from 'node:test'
import assert from 'node:assert/strict'
import { isAppStorageFolderId } from '../utils/appStorage.js'

test('isAppStorageFolderId', () => {
  assert.equal(isAppStorageFolderId('internal-book'), true)
  assert.equal(isAppStorageFolderId('appsd-79EC-9B33-podcast'), true)
  assert.equal(isAppStorageFolderId('cHJpbWFyeTpBdWRpb2Jvb2tzL0FCU1RFU1Q='), false)
  assert.equal(isAppStorageFolderId(undefined), false)
  assert.equal(isAppStorageFolderId(null), false)
})
