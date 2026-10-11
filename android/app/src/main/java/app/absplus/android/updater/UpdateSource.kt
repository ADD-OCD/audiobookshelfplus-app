package app.absplus.android.updater

/**
 * Where updates come from and what they must be, fixed per build type by [UpdaterConfig] (src/release and src/debug).
 *
 * Release builds only ever use [Production]: the official repository, HTTPS to GitHub's own hosts, the production
 * package and the permanent Audiobookshelf+ signing certificate. Nothing received at runtime (server responses,
 * settings, themes) can change it. Debug builds may install a test source for device testing (src/debug only).
 */
data class UpdateSource(
  /** GitHub REST endpoint for the latest stable release */
  val latestReleaseUrl: String,
  /** A release's html_url must start with this */
  val releasePagePrefix: String,
  /** An APK's browser_download_url must be exactly this + tag + "/" + asset name */
  val downloadUrlPrefix: String,
  /** Every request and every redirect hop must go to one of these hosts */
  val allowedHosts: Set<String>,
  /** Test sources only: plain http to 127.0.0.1/localhost (a fixture server through adb reverse) */
  val allowCleartextLoopback: Boolean,
  /** The package an update must have; for production, the installed app itself */
  val targetPackage: String,
  /** SHA-256 (lowercase hex) of the signing certificates an update may be signed with */
  val trustedSignerSha256: Set<String>,
  /** Test sources: the public version to compare releases with, instead of BuildConfig.PLUS_VERSION */
  val installedPlusVersionOverride: String? = null,
  /** False when this build can check but must not download (a debug build against the production source) */
  val downloadsEnabled: Boolean = true,
  val isTest: Boolean = false
) {
  companion object {
    const val REPOSITORY = "ADD-OCD/audiobookshelfplus-app"
    const val PRODUCTION_PACKAGE = "app.absplus.android"

    /**
     * The permanent Audiobookshelf+ release key (docs/release-process.md, "Signing identity"); verified against the
     * signed v0.15.1 and v0.16.0 APKs. A future key rotation is accepted only through Android's signing-certificate
     * lineage from this certificate (see ApkVerifier); a different key without that lineage is rejected.
     */
    const val PRODUCTION_SIGNER_SHA256 = "c540046a10fe8a97dd75adba1d7d60e69d696b10492ff381e13f62df702eb9d4"

    val Production = UpdateSource(
      latestReleaseUrl = "https://api.github.com/repos/$REPOSITORY/releases/latest",
      releasePagePrefix = "https://github.com/$REPOSITORY/releases/tag/",
      downloadUrlPrefix = "https://github.com/$REPOSITORY/releases/download/",
      allowedHosts = setOf("api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"),
      allowCleartextLoopback = false,
      targetPackage = PRODUCTION_PACKAGE,
      trustedSignerSha256 = setOf(PRODUCTION_SIGNER_SHA256)
    )
  }
}
