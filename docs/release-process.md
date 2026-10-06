# Audiobookshelf+ release process

Covers how distributable APKs are signed, versioned, and published. See `docs/app-identity.md`
for why the fork has its own package IDs at all.

## Signing identity

All distributed `app.absplus.android` APKs must be signed with the permanent Audiobookshelf+
release key.

- **Certificate SHA-256 fingerprint**: `C5:40:04:6A:10:FE:8A:97:DD:75:AD:BA:1D:7D:60:E6:9D:69:6B:10:49:2F:F3:81:E1:3F:62:DF:70:2E:B9:D4`
- Key algorithm: RSA 4096-bit, SHA256withRSA, valid 30 years (until 2056).
- The keystore (`android/keystore/audiobookshelf-plus-release.jks`) and its credentials
  (`android/keystore.properties`) are **never committed to git** — both are gitignored. Anyone
  building a signed release needs their own local copy of both files, generated once and backed
  up securely (a password manager entry for the credentials, encrypted offline storage for the
  keystore file itself). **Losing the keystore file permanently breaks the ability to publish an
  update that existing installs can upgrade to** — there is no recovery path.
- `android/app/build.gradle`'s `signingConfigs.release` reads from `keystore.properties` when
  present and falls back to an unsigned release build when it's absent, so a normal clone without
  the secret still builds (just can't produce an installable signed release).
- Do not record the store/key passwords or any private key material anywhere in this repository,
  in commit messages, in issues, or in chat/AI tool output. The fingerprint above is public and
  safe to share; the keystore and its passwords are not.

## What gets published where

**Debug builds (`app.absplus.android.debug`) are never uploaded to GitHub Releases** — not as a
normal release, not as a prerelease, not as a stabilization/RC/device-test build, not as a
feature-test build — unless explicitly authorized as an exceptional case. Every APK attached to a
GitHub release, regardless of how temporary or test-oriented it is, must:

1. Use the release package ID, `app.absplus.android`.
2. Be signed with the permanent Audiobookshelf+ release key above.

Debug builds may still be built and installed locally for day-to-day development and diagnostics
— they're just not what gets handed to anyone for testing. If a debug build is ever genuinely
needed for a specific diagnostic purpose, it must be explicitly requested; it is not the default.

## versionCode convention for test/RC builds

Because every distributed build now shares one package ID and one signing identity, they all
compete for the same `versionCode` space — Android will refuse to install a build whose
`versionCode` isn't strictly greater than what's already installed, and Google Play permanently
rejects re-uploading a `versionCode` that's ever been used. There is no separate "test" numbering
track to fall back on.

**Convention: one monotonically-increasing integer, shared by every distributed build, numbered
release or temporary test/RC build alike. Never reuse, never skip backward, never jump ahead
arbitrarily — always exactly `last distributed versionCode + 1`.**

The last distributed value is recorded here and must be updated immediately after any build is
published (release, prerelease, or test build):

| versionCode | What it was |
| --- | --- |
| 123 | Audiobookshelf+ v0.14.0 (current stable baseline) |
| 124 | Keyboard/login release-package device-test build from `fix/keyboard-aware-login` (commit `b66f9d96`) — distributed; **FAILED** physical-device testing: the keyboard layout was not scrollable, so lower fields/buttons couldn't be reached. Superseded (its commit is only history within the approved 126 merge). |
| 125 | Keyboard/login release-package device-test build from `fix/keyboard-aware-login` (commit `1596c0f3`) — distributed; keyboard/form behavior corrected, but **REJECTED** because the project/footer links could overlap the Important notice with the keyboard open. Superseded by 126. |
| 126 | Keyboard/login release-package device-test build from `fix/keyboard-aware-login` (commit `fe30cbac`) — distributed; **PASSED** physical-device testing (Samsung Galaxy S26 Ultra): keyboard-aware Server Address and Login layouts approved, project/footer layout approved, both external project links (Official Audiobookshelf, Audiobookshelf+) verified on the device. Approved and merged into `plus`. |
| 127 | Playback/widget restoration release-package device-test build from `fix/playback-widget-restoration` (app code as of `ae0ffa16`; built from the commit that set `versionCode 127`, tagged `playback-restore-device-test-v127`) — distributed as a temporary prerelease; superseded for physical-device testing by the combined 128 build. Not merged into `plus`. |
| 128 | Combined Playback Restoration + In-App Diagnostics release-package physical-device test build from `feature/in-app-diagnostic-logging` (contains all of `fix/playback-widget-restoration`; app code as of `b9097ada`; built from the commit that set `versionCode 128`, tagged `playback-diagnostics-device-test-v128`) — distributed as a temporary prerelease; physical-device tested (Samsung Galaxy S26 Ultra): playback/session restoration **PASSED**, but its diagnostic export revealed privacy/sanitization gaps (serialized library items, file paths/URIs, encoded server connection ids). Superseded by 129. Not merged into `plus`. |
| 129 | Playback & Diagnostics release-package physical-device test build from `feature/in-app-diagnostic-logging` (app code as of `e1e8704b`; built from the commit that set `versionCode 129`, tagged `playback-diagnostics-device-test-v129`) — adds diagnostics privacy/sanitization fixes, fail-closed logging, old-log rescrubbing, interrupted-write recovery, Log Actions UI and Save Log; distributed as a temporary prerelease; **PASSED** physical-device testing (Samsung Galaxy S26 Ultra, SM-S948U, Android 16), installed in place over 128: app started normally after the upgrade and existing diagnostic logs were re-sanitized once with the current rules; playing session survived swiping the UI away and reopening reattached to it; paused session survived swiping away and widget Play rebuilt and resumed it; downloaded book resumed from the widget offline (Airplane Mode) after a paused swipe; position, playback speed and queue/session restored correctly; Diagnostics View, Mark, Save (Android system file picker; saved TXT retrieved and inspected), Share and Clear all worked; the v129 export confirmed versionCode 129, release package `app.absplus.android`, DEBUG diagnostics and the successful one-time re-sanitization; no regression requiring another test build. Approved and merged into `plus`. |
| 130 | **Audiobookshelf+ v0.15.0** (upstream v0.14.2-beta), versionName `0.14.2-beta`: the normal release, built from `plus` at `b6f139c0` and tagged `v0.14.2-beta-plus-v0.15.0`. It is published as the Latest GitHub release with the asset `audiobookshelf-plus-v0.15.0-release.apk` (SHA-256 `7b1ad3e91ab6e0083308aa6347d0ec7222ce55fbeb2867ce986e0c52619d4519`), and announced in Discussions #16. It includes playback restoration and diagnostics (129), the LLAMA theme and widget layouts, download Retry/Cancel/Clear, the device-folder access fixes, Rescan Folder across libraries and library page retry. Physical-device release validation was pending at publication. |
| 131 | **Audiobookshelf+ v0.15.1** (upstream v0.14.2-beta), versionName `0.14.2-beta`: hotfix release, built from `plus` at `d2795e4c` and tagged `v0.14.2-beta-plus-v0.15.1`. It is published as the Latest GitHub release with the asset `audiobookshelf-plus-v0.15.1-release.apk` (SHA-256 `1c391c9367e4e9f6d5204d6d08924b4d27633e8c789dfda5e2cff80a9e02db1d`), and announced in Discussions #17. It fixes the series bookshelf that showed only its first one or two books (`defb3cf8`; physical S26 debug validation passed before release). |

**Next distributed versionCode: 132.** The temporary GitHub prereleases/tags for 124–126 were
deleted after approval; these ledger rows are the permanent record, and those numbers (and 127,
128, 129, 130, 131) must never be reused.

Before building anything intended for distribution — including a one-off test/RC build — bump
`versionCode` to the next integer above the value in this table, build, distribute, then update
the table. This is a plain sequential counter (no gaps reserved for releases vs. test builds), so
it stays simple, never collides, and never complicates eventual Google Play publication (Play only
requires each upload's `versionCode` to be strictly greater than the last, which this trivially
satisfies).

## Development baselines

Milestones on `plus` that weren't distributed builds, so they have no `versionCode` row above.

**`615e981f`: upstream v0.14.2-beta synchronization (2026-09-28).**

- Upstream `advplyr/audiobookshelf-app` is synchronized through `7014e04e` (v0.14.2-beta), and `plus` is 0 commits behind it.
- `versionName` is `0.14.2-beta`, matching the upstream base. `versionCode` stays 129, and 130 is still unused.
- The five stale queue tests left over from the download-only design were repaired to match the intentional "stream past download gaps" behavior. Coverage was expanded.
- Automated results: JS tests 28/28, Kotlin unit tests 42/42. Debug build, release Kotlin compile, `lintDebug` (0 errors / 122 warnings), `lintVitalRelease` and Android CI all passed.
- Emulator regression validation passed on an AOSP API 35 emulator against a local test server. The results are in `docs/device-regression-checklist.md`.
- **Physical-device validation was pending at the time of this entry.** It was planned for a Samsung Galaxy S22 Ultra; that is historical. The current physical test device is the Galaxy S26 Ultra (`docs/device-regression-checklist.md`).
- The emulator found a **pre-existing** issue: with no player service running, `KEYCODE_MEDIA_PLAY` and `KEYCODE_HEADSETHOOK` don't restore the last session, while `KEYCODE_MEDIA_PLAY_PAUSE` (the widget) does. It is recorded in `docs/device-regression-checklist.md` (section 3, item 6). It must be verified on physical hardware before any change is made.

## Announcements

Audiobookshelf+ has no in-app "what's new"/announcements screen (checked during the v0.14.0
release — there isn't one to reuse). The [GitHub Discussions "Announcements" category](https://github.com/ADD-OCD/audiobookshelfplus-app/discussions/categories/announcements)
on this repo is the established, preferred place for users to read about completed Audiobookshelf+
changes, and is treated as part of the release itself, not an optional afterthought.

**Every normal Audiobookshelf+ release must have a matching Announcements post describing the
meaningful user-visible changes included in that release.** Rules for writing it:

- Write it before building the final release APK, as part of the release checklist below.
- Describe only functionality actually included in the release being announced — nothing merely
  investigated, deferred, or still in progress.
- Use plain, user-facing language (what changed for the user), not implementation details,
  internal class/file names, commit SHAs, branch names, or signing/repository-administration
  details.
- Temporary test/RC builds do not get their own Announcements post unless explicitly requested —
  they're for validation, not user-facing history.

## Completing a user-facing feature or fix

**Every completed user-facing Audiobookshelf+ feature or fix receives BOTH:**

1. **README documentation** — an entry in `readme.md` describing it for repository visitors.
2. **A GitHub Discussions → Announcements post** — a plain-language post for users following
   Audiobookshelf+ (same writing rules as above).

A feature/fix is only "completed" once it has passed its required testing (for device-dependent
changes, physical-device approval of a distributed test build) and been merged into `plus`. Until
then — including while temporary test/RC builds of it are being distributed — it is exempt:
**don't** add it to the README as a finished improvement and **don't** post its Announcement.
Both happen together as part of the completion step (merge into `plus` → README → Announcement →
finalize docs), not before.

## Summary checklist for any new distributed APK

1. Check the `versionCode` table above; use `last + 1`.
2. Build the **release** variant (`app.absplus.android`), not debug.
3. Confirm it's signed with the fingerprint above (`apksigner verify --verbose --print-certs`).
4. For a normal release (not a test/RC build): write/post the Announcements entry for it first,
   and make sure every completed feature/fix it includes is documented in the README.
5. Publish it, then update the `versionCode` table in this document.
