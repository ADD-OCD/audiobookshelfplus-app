package app.absplus.android.updater

/** Small, platform-free decisions of the updater, kept here so they can be unit tested */
object UpdatePolicy {
  /** Installers whose apps update through their store; the GitHub updater stays off for those copies */
  private val STORE_INSTALLERS = setOf("com.android.vending", "com.google.android.feedback")

  /** Margin kept free beyond the update itself: Android's installer copies the APK once more while installing */
  const val STORAGE_MARGIN_BYTES = 50L * 1024 * 1024

  fun isStoreManaged(installerPackage: String?): Boolean = installerPackage != null && installerPackage in STORE_INSTALLERS

  /** The download needs room for itself, Android's install copy and a margin */
  fun hasRoomFor(updateBytes: Long, usableBytes: Long): Boolean = usableBytes >= updateBytes * 2 + STORAGE_MARGIN_BYTES

  /** Below Android 8.0 installs from this app need no per-app permission; from 8.0 the user grants it in Settings */
  fun needsInstallPermission(sdkInt: Int, canRequestPackageInstalls: Boolean): Boolean = sdkInt >= 26 && !canRequestPackageInstalls

  /**
   * The digest in a `<apk>.sha256` file (`<hex>  <name>` or `<hex> *<name>`, as sha256sum writes it). Null when the file
   * does not name exactly this APK.
   */
  fun parseChecksumFile(text: String, apkName: String): String? {
    val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
    if (lines.size != 1) return null
    val m = Regex("^([0-9a-fA-F]{64}) [ *](.+)$").matchEntire(lines[0]) ?: return null
    return if (m.groupValues[2] == apkName) m.groupValues[1].lowercase() else null
  }

  /** Every published digest that exists must match the downloaded file's */
  fun digestsAgree(downloaded: String, assetDigest: String?, checksumFileDigest: String?): Boolean =
    (assetDigest == null || assetDigest.equals(downloaded, ignoreCase = true)) && (checksumFileDigest == null || checksumFileDigest.equals(downloaded, ignoreCase = true))

  /** Whether the release is newer than the installed public version (numeric, never by text order) */
  fun isNewer(candidate: PlusVersion, installed: PlusVersion?): Boolean = installed == null || candidate > installed
}
