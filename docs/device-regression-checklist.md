# Physical-device regression checklist

For the current physical test device, the Samsung Galaxy S26 Ultra (One UI). Earlier rounds named a Galaxy S22 Ultra; that is historical. Run it against the release-package build of whatever is about to be distributed, installed in place over the previous build. Capture `adb logcat` and a Diagnostics export (level Debug) for every run.

Items marked **emulator-covered** already pass on an AOSP API 35 emulator (see the note below). They still need hardware confirmation, because Samsung's power management, media stack and Bluetooth behave differently. Record results in `docs/release-process.md` next to the build's versionCode.

## Test data

- A collection or series of at least 4 downloaded audiobooks, including a very short one (under 1 minute) so queue transitions happen quickly. Also a 12-item queue, to match the earlier approved S26 Ultra run.
- One book that is not downloaded (to test streaming past a gap), and one multi-file book.
- A wired headset or USB-C headset with a play button, and a Bluetooth headset or car kit.

## 1. Install and startup

1. Install in place over the previous build. The app starts, the existing downloads are listed, and the Diagnostics log shows no "invalid download queue" line on a healthy install.
2. Cold start after a reboot. There's no auto-play, and no restore happens until Play is pressed.

## 2. Queue and continuous playback (emulator-covered)

1. Start the collection in the middle. Up Next shows the right order and current item.
2. Let a short book end with the screen locked and the app in the background. Native playback advances to the next book, and Up Next is correct on return.
3. Include an undownloaded book. It streams in its place, and the cellular prompt appears if the cellular setting requires it.
4. Reorder and remove Up Next items while playing.

## 3. Swipe-away and restoration (emulator-covered through the widget key code only)

1. Swipe the app away **while playing**. Playback continues, and reopening reattaches to the same session and Up Next.
2. Pause, then swipe away. The notification goes away and the session stays resumable.
3. Widget Play: the session is rebuilt with the same book, position (within the last progress save), speed and Up Next, and resumes.
4. Repeat step 3 in Airplane Mode with a downloaded book.
5. Repeat step 3 after the process is gone. On Samsung, wait for it to be killed or use `adb shell am kill`.
6. **Wired headset button, and Bluetooth Play, after step 2.**
   - `KEYCODE_MEDIA_PLAY`, `KEYCODE_HEADSETHOOK` and `KEYCODE_MEDIA_PLAY_PAUSE` must all restore the session, with the service gone and with the process killed. Fixed on `plus` after v0.15.1: these keys act on key-up, and the key-down no longer releases the placeholder foreground or stops the service before the key-up arrives (`MediaButtonLifecycle`). Before the fix, Play and Headset Hook did nothing there and could crash the app with `ForegroundServiceDidNotStartInTimeException`.
   - Check `adb logcat -b crash` stays empty and no "still waiting for start foreground" line appears.
   - Record which key code each real headset or car kit sends (`adb logcat | grep handleCallMediaButton`) and whether it restores.
7. Close the player with the X, then press widget Play. Nothing restores.
8. Force stop in Android Settings, then press Play. Nothing starts. Reopen the app normally.

## 4. System media surfaces

1. The media notification and lock-screen controls show play/pause, jump back and jump forward, and they update when playback advances to the next queue item.
2. Samsung's Now Bar or media card (One UI) matches the playing book, and its controls work.
3. Bluetooth disconnect pauses playback, and a reconnect doesn't resume it on its own.
4. Android Auto, if available: browsing and playback start.
5. A downloaded book whose cover file is missing or damaged still restores and plays. Rename or truncate the cover after closing the app, then restore with the widget or a media key. The notification and lock screen show the Audiobookshelf+ artwork, and `adb logcat -b crash` stays empty. Fixed on `plus` after v0.15.1 (`CoverArt`).

## 5. Downloads

1. Download a multi-file book. Swipe the app away mid-download, and separately let the process be killed mid-download. On relaunch the queue is restored and the download finishes. Parts that weren't finished restart from byte 0 after a restore; that is intended.
2. An external SAF folder download works. Revoke the folder's permission, and the download reports lost access instead of failing silently.
3. Rescan Folder recognizes the existing downloads.

## 6. Long-running and background

1. Two or more hours of continuous playback with the screen off, the device unplugged and default battery settings. There are no stops, and progress syncs.
2. Repeat with the app set to "Restricted" or "Optimized" in Samsung battery settings, and note any difference.
3. A sleep timer during a queue transition.

## 7. Diagnostics and privacy

1. View, Mark, Save (system file picker), Share and Clear all work.
2. An exported log contains no server host, username, token, device path or `content://` URI.
3. Raw `adb logcat` (debug build included) contains no token, `Authorization`/`x-refresh-token` header, refresh-token cookie, server connection config or username. Capacitor's own logging is off (`loggingBehavior: "none"`), and the app's logcat copies (`DLog`, `AbsLogger`) go through the same sanitizer as the diagnostic log.

## 8. Languages and UI

1. Switch to Korean, Arabic, Hebrew and Slovak. Screens stay readable, and fork-only strings fall back to English. Arabic and Hebrew are not mirrored right-to-left, which is expected for now.
2. Font size at 200%: Settings → Diagnostics and the login screen stay usable. The login screen also works with the keyboard open.

## Emulator baseline (for comparison)

The upstream v0.14.2-beta synchronization ran sections 2, 3.1–3.5 (widget key code), 3.7, 3.8, 4.1 (dispatch only), 5.1 (process kill), 7 (privacy counts) and 8.1 on an AOSP `sdk_gphone64_x86_64` emulator (API 35) against a local Audiobookshelf 2.36.1 server. Samsung-specific behavior, Bluetooth, real headsets, SAF folders, long runs and battery restrictions were not covered.
