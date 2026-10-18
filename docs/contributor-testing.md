# Contributor testing channel

`v0.20.0-dev.1` is an experimental prerelease containing the consolidated
PR32/PR34/PR35 and bounded safety/playback candidate. It is not a stable release
or a merge into `plus`.

The `contributor` Android build type uses `app.absplus.android.debug`, is not
debuggable, explicitly disables WebView remote debugging, and uses versionCode
138 / versionName `0.20.0-dev.1`. The regular release package and its versioning
configuration remain unchanged. Build with `:app:assembleContributor` after
frontend generation and Capacitor asset synchronization. The output is unsigned;
sign it offline with the persistent contributor-only key. No signing secrets or
machine-specific paths belong in the repository.

This supervisor-authorized contributor channel is an exception to the default
distribution policy in `release-process.md`: it is a non-debuggable testing
variant with a separate package and signer, rather than a regular production
release. Do not sign it with the production key or upload a normal debuggable APK.

The contributor signer differs from the old local synthetic debug signer.
Existing debug installations cannot upgrade in place: uninstalling them removes
their local data, so export/retain anything needed before choosing to uninstall.
The regular `app.absplus.android` installation remains separate. Subsequent
contributor updates must retain this signer and package and use a higher
versionCode. Install contributor updates manually from their named prerelease;
the production in-app update download channel and fixture-source overrides are
disabled in this variant. Code138 is allocated only to this contributor channel; the
production-channel ledger is unchanged.

Install only the APK from the named prerelease and verify `SHA256SUMS.txt`.
Initially test automatic deletion with disposable media and a dedicated
app-managed download folder. Listening history should survive eviction and
temporary storage loss; report any loss immediately.

Android16 runtime, physical Samsung/SD behavior, and the full elapsed six-hour
foreground-service quota remain unvalidated. Shortened Android15 framework
timeout tests are distinct from six hours of elapsed use. Legacy scanner stale
server-progress overwrites and known HTTP range/integrity limitations remain
outside these bounded corrections. Do not regard matching filenames or lengths
as a universal integrity guarantee.

User-requested in-app diagnostic logs remain available. Development-only
WebView debugging and Android `run-as` access are disabled by the non-debuggable
configuration. Do not install the separate synthetic test-provider APK as part
of the distributed application.
