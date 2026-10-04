# App identity: package ID migration

## The two package IDs

| App | Package ID (release) | Package ID (debug build) |
| --- | --- | --- |
| Official Audiobookshelf (upstream, `advplyr/audiobookshelf-app`) | `com.audiobookshelf.app` | `com.audiobookshelf.app.debug` |
| Audiobookshelf+ (this fork, `ADD-OCD/audiobookshelfplus-app`) | `app.absplus.android` | `app.absplus.android.debug` |

Android treats the package ID (`applicationId`) as an app's permanent identity — two APKs with the same ID are the same app to the OS (an update replaces the other), while different IDs are entirely separate, independently installable apps that never share data, permissions, or storage. Prior to this migration, Audiobookshelf+ builds also shipped as `com.audiobookshelf.app`, identical to upstream, which meant Audiobookshelf+ and the official app could never coexist on one device and any upstream install would be silently overwritten by (or overwrite) a fork build with a higher `versionCode`.

`app.absplus.android` is the fork's permanent identity going forward, chosen to be stable enough to publish to Google Play without ever needing to change again (a Play Store `applicationId` cannot be changed after first publish without losing the listing).

## Why an independent identity

The fork adds real functionality on top of upstream (see the README feature list) and is expected to continue diverging and periodically merging from upstream. Sharing upstream's package ID would mean:
- No safe way to have both apps installed for comparison/fallback.
- Any user who installs a fork build has permanently made upstream un-installable on that device without first uninstalling the fork (and losing local data — see below).
- Google Play requires an applicationId unique to the publisher; publishing under `com.audiobookshelf.app` was never viable.

## What changed

This was an identity migration, not a refactor. `applicationId`/`namespace` in `android/app/build.gradle`, the Kotlin package declaration and directory structure (`android/app/src/main/java/com/audiobookshelf/app/**` → `android/app/src/main/java/app/absplus/android/**`), the root `capacitor.config.json` `appId`, and a handful of hardcoded string literals that do **not** auto-follow a package rename were updated:
- `AndroidManifest.xml`'s Cast `OPTIONS_PROVIDER_CLASS_NAME` meta-data value (reflection-based class lookup by fully-qualified name).
- `PlayerNotificationService.kt`'s `VALID_MEDIA_BROWSERS` allowlist (compares the calling app's package name as a string).
- `DownloadService.kt`'s `ACTION_CANCEL` intent-action string.
- `PlayerConstants.kt`'s custom media-session action strings (`CUSTOM_ACTION_*`).
- The vestigial `package_name` string resource in both `strings.xml` variants (later removed as unused in the Phase 5.1 lint cleanup).
- The `appAuthRedirectScheme` Gradle manifest placeholder.

No functionality, permissions, minSdk/targetSdk/compileSdk, Gradle/dependency versions, server communication, or upstream API endpoints were changed. References to `com.audiobookshelf.app` that identify the **upstream project itself** rather than this app's own identity were left untouched: the dead/unused `ANDROID_APP_URL` constant in `nuxt.config.js` (points to the real Play Store listing for the official app) and all `ios/**` files (this fork is Android-only; iOS was never built or shipped from this repository).

## Upgrade implications for existing GitHub-build users

Any Audiobookshelf+ APK previously downloaded from this fork's GitHub Releases was built as `com.audiobookshelf.app`. Installing a build with the new `app.absplus.android` ID is, to Android, installing a **different app** — it will not upgrade the old install in place. Concretely, an existing user who installs an `app.absplus.android` release:
- Keeps their old `com.audiobookshelf.app` install fully intact and functional until they choose to uninstall it (the two can be installed side by side).
- Starts the new app as a fresh install: no local playback position, downloaded audiobooks/podcasts, server connection config, saved login/auth token, or app settings carry over automatically, because Android sandboxes app-private storage per package ID.
- Will need to re-add their server and log in again in the new app; previously downloaded local files are not visible to it (they live under the old package's storage).

Server-side data (library, progress recorded on the server, bookmarks) is unaffected — logging back in against the same server restores server-tracked progress normally. This branch does not implement any old-package → new-package local data migration; that risk was explicitly deferred out of scope for this change.

## Coexistence with the official app

Confirmed via build inspection: the official app (`com.audiobookshelf.app`) and Audiobookshelf+ (`app.absplus.android`) are distinct `applicationId`s and install as fully separate apps with independent storage, notifications, and settings. Both can be installed on the same device simultaneously with no conflict.

## Debug vs release builds of this fork

The debug and release builds of Audiobookshelf+ itself are also distinct package IDs, via Gradle's
`applicationIdSuffix ".debug"`:

| Build | Package ID |
| --- | --- |
| Audiobookshelf+ release | `app.absplus.android` |
| Audiobookshelf+ debug | `app.absplus.android.debug` |

The same rules as above apply between them: Android treats these as two separate apps.
- A debug build and a release build can be installed on the same device at the same time.
- Installing one never replaces or updates the other — each keeps its own local data, settings,
  downloads, and login/server state, completely independent of the other.
- A debug install should not be mistaken for "the normal Audiobookshelf+ install" — it's a
  separate, development-oriented app that happens to share a name and icon.

This is an internal/developer distinction. It is not surfaced in the app's own UI, and end users
installing a normal release build never need to know it exists.

## Future upstream merges

When merging future upstream changes, watch for:
- New hardcoded `com.audiobookshelf.app` string literals introduced upstream (new Cast/Auto/intent-action constants) — these need the same manual fix as the ones above; a plain search-and-replace of the package name is not sufficient (see the reasoning in this doc).
- Upstream PRs that touch `AndroidManifest.xml`, `build.gradle`, or `capacitor.config.json` will likely conflict on the `applicationId`/`namespace`/`appId` lines — always keep the fork's `app.absplus.android` value, not upstream's.
- Any new Kotlin files added upstream will need their `package`/`import` lines translated from `com.audiobookshelf.app*` to `app.absplus.android*` when brought into this fork's already-renamed directory tree.

## Branding: no Audible material

Production-facing Audiobookshelf+ material must not contain Audible branding. This is a project requirement, added in Phase 2C Gate H.

It covers:

- the app UI;
- widgets, including widget empty states;
- LLAMA screenshots;
- mockups that represent finished Audiobookshelf+ UI;
- documentation imagery that represents the finished or current Audiobookshelf+ UI;
- presentation or comparison composites meant to show the finished Audiobookshelf+ implementation.

Real Audiobookshelf+ empty states identify **Audiobookshelf+** (AUDIOBOOKSHELF+), never Audible. Do not use the Audible logo, the Audible name, prompts such as "Tap here for Audible", or any other Audible-specific branding.

An external Audible screenshot may be kept only as a deliberately retained reference that is explicitly labeled **INTERNAL DESIGN REFERENCE**. It must never be presented so that it looks like part of the finished Audiobookshelf+ implementation.

**User content is not app branding.** Cover art from a user's own library may legitimately contain Audible logos or branding. That is user content, not Audiobookshelf+ branding, and the app does not censor or alter it; it is not a rendering defect. But public Audiobookshelf+ screenshots, mockups, documentation imagery, store graphics and promotional composites must avoid showing library items whose cover art visibly carries Audible branding.

Other inherited identity debt (not Audible-related): the server-connect screen still shows the upstream logo (its title reads Audiobookshelf+ since Phase 5), and the fastlane store-listing imagery carries upstream branding (its text describes Audiobookshelf+ since Phase 5). Both are tracked in `docs/future-work.md`.
