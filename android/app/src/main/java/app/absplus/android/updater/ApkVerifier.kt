package app.absplus.android.updater

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.security.MessageDigest

/** What Android's package parser reports about a downloaded APK */
data class ApkFacts(
  val packageName: String,
  val versionCode: Long,
  val debuggable: Boolean,
  /** SHA-256 of the current signing certificate(s); several only for multi-signer APKs */
  val signerSha256: List<String>,
  /** The signing-certificate lineage, oldest first (API 28+ with APK Signature Scheme v3 rotation); empty otherwise */
  val lineageSha256: List<String>
)

data class ApkExpectation(val targetPackage: String, val installedVersionCode: Long, val trustedSignerSha256: Set<String>)

sealed class ApkVerdict {
  data class Accepted(val versionCode: Long, val rotatedFromTrusted: Boolean) : ApkVerdict()
  data class Rejected(val code: UpdateErrorCode, val detail: String) : ApkVerdict()
}

/**
 * Decides whether a downloaded APK may be offered for installation.
 *
 * The facts come from PackageManager.getPackageArchiveInfo with signing-certificate collection, which parses the APK
 * and cryptographically verifies its v1/v2/v3 signatures (an APK whose signature does not verify yields no
 * certificates, or no package info at all). The signer must be a trusted certificate. Key rotation is accepted only when
 * Android's verified v3 lineage shows the new key was authorised by a trusted one. Android's installer then verifies the
 * APK again and refuses an update whose signer the installed app does not trust; that check is never disabled.
 */
object ApkVerifier {
  fun evaluate(facts: ApkFacts?, expected: ApkExpectation): ApkVerdict {
    if (facts == null) return ApkVerdict.Rejected(UpdateErrorCode.INVALID_APK, "Android could not read the APK or verify its signature")
    if (facts.packageName != expected.targetPackage) return ApkVerdict.Rejected(UpdateErrorCode.WRONG_PACKAGE, "package does not match")
    if (facts.versionCode <= 0) return ApkVerdict.Rejected(UpdateErrorCode.INVALID_APK, "version code missing")
    if (facts.versionCode <= expected.installedVersionCode) return ApkVerdict.Rejected(UpdateErrorCode.NOT_NEWER, "version code ${facts.versionCode} is not newer than ${expected.installedVersionCode}")
    if (facts.debuggable) return ApkVerdict.Rejected(UpdateErrorCode.DEBUGGABLE, "debuggable build")
    if (facts.signerSha256.isEmpty()) return ApkVerdict.Rejected(UpdateErrorCode.UNSIGNED, "no verified signing certificate")
    if (facts.signerSha256.size > 1) return ApkVerdict.Rejected(UpdateErrorCode.MULTIPLE_SIGNERS, "${facts.signerSha256.size} signers")
    val signer = facts.signerSha256[0].lowercase()
    val trusted = expected.trustedSignerSha256.map { it.lowercase() }.toSet()
    if (signer in trusted) return ApkVerdict.Accepted(facts.versionCode, rotatedFromTrusted = false)
    // Rotation: the lineage ends with the current signer and contains a trusted certificate before it
    val lineage = facts.lineageSha256.map { it.lowercase() }
    if (lineage.size > 1 && lineage.last() == signer && lineage.dropLast(1).any { it in trusted }) return ApkVerdict.Accepted(facts.versionCode, rotatedFromTrusted = true)
    return ApkVerdict.Rejected(UpdateErrorCode.UNTRUSTED_SIGNER, "signing certificate is not the Audiobookshelf+ release key")
  }

  fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  /** Reads [ApkFacts] through Android's package parser; null when the APK cannot be parsed or its signature not verified */
  fun readFacts(context: Context, apk: File): ApkFacts? {
    val pm = context.packageManager
    val info: PackageInfo = try {
      if (Build.VERSION.SDK_INT >= 33) {
        pm.getPackageArchiveInfo(apk.path, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
      } else if (Build.VERSION.SDK_INT >= 28) {
        pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES)
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNATURES)
      }
    } catch (e: Exception) {
      null
    } ?: return null
    val signers: List<Signature>
    val lineage: List<Signature>
    if (Build.VERSION.SDK_INT >= 28) {
      val signing = info.signingInfo ?: return null
      if (signing.hasMultipleSigners()) {
        signers = signing.apkContentsSigners?.toList() ?: emptyList()
        lineage = emptyList()
      } else {
        val history = signing.signingCertificateHistory?.toList() ?: emptyList()
        signers = history.takeLast(1)
        lineage = history
      }
    } else {
      @Suppress("DEPRECATION")
      signers = info.signatures?.toList() ?: emptyList()
      lineage = emptyList()
    }
    val appInfo: ApplicationInfo? = info.applicationInfo
    return ApkFacts(
      packageName = info.packageName ?: return null,
      versionCode = PackageInfoCompat.getLongVersionCode(info),
      debuggable = appInfo == null || (appInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0,
      signerSha256 = signers.map { sha256Hex(it.toByteArray()) },
      lineageSha256 = lineage.map { sha256Hex(it.toByteArray()) }
    )
  }
}
