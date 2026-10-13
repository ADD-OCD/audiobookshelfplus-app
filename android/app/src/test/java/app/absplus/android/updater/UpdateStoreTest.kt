package app.absplus.android.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class UpdateStoreTest {
  @get:Rule val tmp = TemporaryFolder()
  private val candidate = UpdateCandidate("v0.14.2-beta-plus-v0.17.0", PlusVersion(0, 17, 0), "t", "u", null, "", ReleaseAsset("a.apk", 6, null, "u"), null)

  private fun storeWithReady(name: String = "updates"): Pair<UpdateStore, ReadyUpdate> {
    val store = UpdateStore(File(tmp.root, name))
    store.prepare().writeBytes(byteArrayOf(0x50, 0x4b, 3, 4, 'a'.code.toByte(), 'b'.code.toByte()))
    val staged = store.stageForVerification()
    val record = ReadyUpdate(candidate, 133, staged.length(), UpdateStore.sha256(staged), 1)
    store.promote(record)
    return store to record
  }

  @Test
  fun aVerifiedUpdateIsKeptAndReloaded() {
    val (store, record) = storeWithReady()
    assertEquals(record, store.loadReady())
    assertFalse(store.partial.exists())
    assertEquals(setOf("update.apk", "update.json"), store.dir.list()!!.toSet())
  }

  @Test
  fun aChangedFileIsNotReady() {
    val (store, _) = storeWithReady()
    store.readyFile().writeBytes(byteArrayOf(0x50, 0x4b, 3, 4, 'x'.code.toByte(), 'y'.code.toByte()))
    assertNull(store.loadReady())
    store.readyFile().writeBytes(byteArrayOf(0x50, 0x4b))
    assertNull(store.loadReady(checkDigest = false))
  }

  @Test
  fun reconcileRemovesInterruptedObsoleteAndDamagedFiles() {
    val (store, _) = storeWithReady()
    store.partial.writeText("half")
    val keep = store.reconcile(installedVersionCode = 132)
    assertNotNull(keep.ready)
    assertTrue(keep.interruptedRemoved)
    assertFalse(store.partial.exists())

    val obsolete = store.reconcile(installedVersionCode = 133)
    assertNull(obsolete.ready)
    assertTrue(obsolete.obsoleteRemoved)
    assertEquals(0, store.dir.list()!!.size)

    val (store2, _) = storeWithReady("updates2")
    File(store2.dir, "update.json").writeText("{not json")
    val damaged = store2.reconcile(installedVersionCode = 1)
    assertNull(damaged.ready)
    assertTrue(damaged.damagedRemoved)
    assertEquals(0, store2.dir.list()!!.size)
  }

  @Test
  fun clearingTouchesOnlyTheUpdatesDirectory() {
    val (store, _) = storeWithReady()
    val neighbour = File(tmp.root, "downloads/book.m4b").apply { parentFile!!.mkdirs(); writeText("audio") }
    store.clearAll()
    assertEquals(0, store.dir.list()!!.size)
    assertTrue(neighbour.exists())
  }
}
