package app.absplus.android.updater

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/** The verified update kept for installation, with the facts it was verified against */
data class ReadyUpdate(val candidate: UpdateCandidate, val versionCode: Long, val size: Long, val sha256: String, val verifiedAt: Long)

/**
 * The updater's files, all in one app-private directory (cache/updates): the partial download, the verified APK and
 * its record. Fixed names only (no path from any response is ever used), at most one APK at a time, and nothing
 * outside this directory is touched. The verified APK becomes "ready" only by an atomic rename after verification.
 */
class UpdateStore(val dir: File) {
  private val mapper = jacksonObjectMapper()
  val partial get() = File(dir, "download.part")
  private val verifying get() = File(dir, "verifying.apk")
  private val readyApk get() = File(dir, "update.apk")
  private val readyRecord get() = File(dir, "update.json")

  fun prepare(): File {
    dir.mkdirs()
    return partial
  }

  /** The completed download, moved out of the partial name while it is verified */
  fun stageForVerification(): File {
    verifying.delete()
    if (!partial.renameTo(verifying)) throw UpdateException(UpdateErrorCode.STORAGE, "could not stage the download")
    return verifying
  }

  /** Atomically makes the verified file the ready update, replacing any older one */
  fun promote(record: ReadyUpdate) {
    readyApk.delete()
    readyRecord.delete()
    if (!verifying.renameTo(readyApk)) throw UpdateException(UpdateErrorCode.STORAGE, "could not keep the verified update")
    val tmp = File(dir, "update.json.tmp")
    tmp.writeText(mapper.writeValueAsString(record))
    if (!tmp.renameTo(readyRecord)) throw UpdateException(UpdateErrorCode.STORAGE, "could not record the verified update")
  }

  fun readyFile(): File = readyApk

  /** The ready update when its record and file are intact and the file still has the verified size and digest */
  fun loadReady(checkDigest: Boolean = true): ReadyUpdate? {
    if (!readyApk.isFile || !readyRecord.isFile) return null
    val record = try {
      mapper.readValue<ReadyUpdate>(readyRecord.readText())
    } catch (e: Exception) {
      return null
    }
    if (readyApk.length() != record.size) return null
    if (checkDigest && sha256(readyApk) != record.sha256) return null
    return record
  }

  /** Removes interrupted downloads (process death or a crash mid-transfer) */
  fun clearIncomplete(): Boolean {
    var removed = false
    for (f in listOf(partial, verifying, File(dir, "update.json.tmp"))) if (f.exists()) removed = f.delete() || removed
    return removed
  }

  fun clearAll() {
    dir.listFiles()?.forEach { it.delete() }
  }

  /**
   * At start-up: drops interrupted downloads, and the ready update when it is damaged or no longer newer than the
   * installed version (installed meanwhile, by the updater or by hand). Returns what is still installable.
   */
  fun reconcile(installedVersionCode: Long): ReconcileResult {
    val interrupted = clearIncomplete()
    val ready = loadReady()
    if (ready == null) {
      val hadFiles = readyApk.exists() || readyRecord.exists()
      readyApk.delete()
      readyRecord.delete()
      return ReconcileResult(null, interrupted, damagedRemoved = hadFiles, obsoleteRemoved = false)
    }
    if (ready.versionCode <= installedVersionCode) {
      readyApk.delete()
      readyRecord.delete()
      return ReconcileResult(null, interrupted, damagedRemoved = false, obsoleteRemoved = true)
    }
    return ReconcileResult(ready, interrupted, damagedRemoved = false, obsoleteRemoved = false)
  }

  data class ReconcileResult(val ready: ReadyUpdate?, val interruptedRemoved: Boolean, val damagedRemoved: Boolean, val obsoleteRemoved: Boolean)

  companion object {
    fun sha256(file: File): String {
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          digest.update(buffer, 0, n)
        }
      }
      return digest.digest().joinToString("") { "%02x".format(it) }
    }
  }
}
