package app.absplus.android.device

import android.content.Context
import android.os.Environment
import android.os.storage.StorageManager
import app.absplus.android.data.LocalFolder
import app.absplus.android.plugins.AbsLogger
import java.io.File

/** An external storage volume with the app's own files directory on it; `uuid == null` is the primary volume. */
data class AppVolume(
        val uuid: String?,
        val filesDir: File,
        val removable: Boolean,
        val mounted: Boolean,
        val writable: Boolean
)

/** The Android storage lookups, behind an interface so the rules can be tested without devices. */
interface VolumeProbe {
  fun volumes(): List<AppVolume>
  fun internalFilesDir(): File
}

class AndroidVolumeProbe(private val context: Context) : VolumeProbe {
  override fun internalFilesDir(): File = context.filesDir

  override fun volumes(): List<AppVolume> {
    val storageManager = context.getSystemService(StorageManager::class.java)
    // Null entries are volumes that are not mounted right now.
    return context.getExternalFilesDirs(null).filterNotNull().mapNotNull { dir ->
      try {
        val sv = storageManager.getStorageVolume(dir) ?: return@mapNotNull null
        val mounted = sv.state == Environment.MEDIA_MOUNTED
        val writable = mounted && (dir.mkdirs() || dir.isDirectory) && dir.canWrite()
        AppVolume(sv.uuid, dir, sv.isRemovable, mounted, writable)
      } catch (e: Exception) {
        AbsLogger.error("AppStorage", "Could not read storage volume for ${dir.absolutePath}: ${e.message}")
        null
      }
    }
  }
}

/**
 * Folders the app owns and writes with the File API: internal app storage and the app's directory on
 * an SD card. Everything else is a user-picked SAF folder.
 */
object AppStorage {
  const val INTERNAL_PREFIX = "internal-"
  // SAF folder ids are URL-safe base64 of UTF-8 text; "appsd-" decodes to invalid UTF-8, so ids never collide.
  const val APPSD_PREFIX = "appsd-"
  const val INTERNAL_STORAGE_TYPE = "internal"
  const val APPSD_STORAGE_TYPE = "appsd"
  const val INTERNAL_NAME = "Internal App Storage"
  const val SD_NAME = "SD card"

  private const val DOWNLOADS_DIR = "downloads"
  private const val STAGING_DIR = "download-staging"

  fun isAppStorage(folderId: String): Boolean =
          folderId.startsWith(INTERNAL_PREFIX) || folderId.startsWith(APPSD_PREFIX)

  fun appsdFolderId(uuid: String, mediaType: String): String = "$APPSD_PREFIX$uuid-$mediaType"

  fun uuidOf(folderId: String): String? {
    if (!folderId.startsWith(APPSD_PREFIX)) return null
    val rest = folderId.removePrefix(APPSD_PREFIX)
    val dash = rest.lastIndexOf('-')
    if (dash <= 0) return null
    return rest.substring(0, dash)
  }

  fun downloadsRoot(folder: LocalFolder, probe: VolumeProbe): File? = rootDir(folder, probe, DOWNLOADS_DIR)

  fun stagingRoot(folder: LocalFolder, probe: VolumeProbe): File? = rootDir(folder, probe, STAGING_DIR)

  private fun rootDir(folder: LocalFolder, probe: VolumeProbe, name: String): File? {
    if (folder.id.startsWith(INTERNAL_PREFIX)) return File(probe.internalFilesDir(), name)
    val volume = mountedVolumeFor(folder, probe) ?: return null
    return File(volume.filesDir, name)
  }

  private fun mountedVolumeFor(folder: LocalFolder, probe: VolumeProbe): AppVolume? {
    val uuid = uuidOf(folder.id) ?: return null
    return probe.volumes().firstOrNull { it.uuid == uuid && it.mounted }
  }

  /** SAF folders are judged by [FolderAccess], not here. */
  fun isAvailable(folder: LocalFolder, probe: VolumeProbe): Boolean {
    if (folder.id.startsWith(INTERNAL_PREFIX)) return true
    return mountedVolumeFor(folder, probe)?.writable == true
  }

  fun removableVolume(probe: VolumeProbe): AppVolume? = probe.volumes().firstOrNull { it.removable && it.mounted }

  /** Component-wise, so a sibling like `files2` is not under `files`. */
  fun isUnder(file: File, root: File): Boolean =
          file.absoluteFile.toPath().normalize().startsWith(root.absoluteFile.toPath().normalize())

  /** Identifies the storage a file lives on, so space is reserved per volume. */
  fun storageKey(file: File, probe: VolumeProbe): String {
    if (isUnder(file, probe.internalFilesDir())) return "internal"
    val volume = probe.volumes().firstOrNull { isUnder(file, it.filesDir) } ?: return "other"
    return "volume:" + (volume.uuid ?: "primary")
  }

  fun appOwnedRoots(probe: VolumeProbe): List<File> = listOf(probe.internalFilesDir()) + probe.volumes().map { it.filesDir }

  /** A folder object for the target; not saved to the database. */
  fun folderFor(target: StorageTarget, mediaType: String): LocalFolder =
          when (target) {
            is StorageTarget.Internal ->
                    LocalFolder("$INTERNAL_PREFIX$mediaType", INTERNAL_NAME, "", "", "", INTERNAL_STORAGE_TYPE, mediaType)
            is StorageTarget.Sd ->
                    LocalFolder(appsdFolderId(target.uuid, mediaType), SD_NAME, "", "", "", APPSD_STORAGE_TYPE, mediaType)
          }
}
