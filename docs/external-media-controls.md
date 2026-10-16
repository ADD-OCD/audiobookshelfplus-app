# Bluetooth and external media controls

Android Settings → Playback → **Bluetooth / external media controls** selects what external Next and Previous mean.

| Mode | Next | Previous |
| --- | --- | --- |
| Skip by time (default) | Configured forward interval | Configured backward interval |
| Navigate chapters | Next audiobook chapter timestamp | Restart current chapter after 4 seconds; otherwise previous chapter |
| Navigate audio files | Start of adjacent next audio file | Start of adjacent previous file; restart at the first file |

The setting is device-local and persists through the existing device-settings database. Old records, missing values and unknown modes use time skips. Chapter navigation uses the session's chapter metadata, including timestamps inside one file and across files. It does not manufacture chapters from file boundaries. Missing, overlapping, unsorted or invalid chapter metadata falls back to time skips. Podcasts use time skips in chapter mode. File navigation requires a matching original-file player timeline; transcoded or inconsistent timelines fall back to time skips.

Next at the last chapter/file does nothing. Navigation never explicitly advances the book/podcast queue or marks an item finished. Time skips clamp before the end; ordinary playback completion and continuous playback remain unchanged. Navigation preserves paused state. Fast Forward, Rewind and their notification actions always use the current configured time intervals. On-screen chapter buttons and explicit seeks remain independent.

`ExternalNavigation` owns the destination decision. `MediaSessionCallback` sends hardware keys, transport commands and custom Skip actions through the same service handler. Hardware Next/Previous act at key-up; Fast Forward/Rewind act at key-down. Both halves are consumed; repeats, canceled events and duplicate deliveries of the same event are ignored. Distinct transport requests have no event identity and remain distinct commands, and so do the home widget's key events, which carry no timestamps. `notificationControls` delegates ordinary player operations while routing notification FF/RW through current settings.

The app currently uses ExoPlayer 2 with MediaSessionCompat, rather than Media3. Android Auto, watches and Bluetooth controllers may send either keys or transport commands. Automated tests exercise both routes; ADB injection and a MediaSession controller do not establish compatibility with every physical controller.

The investigation builds on [upstream issue #352](https://github.com/advplyr/audiobookshelf-app/issues/352) and [doofmars's proposed correction #1812](https://github.com/advplyr/audiobookshelf-app/pull/1812). That proposal unifies transport Skip with time jumps. This implementation independently extends that approach with selectable, shared navigation policy; no upstream commit was cherry-picked. See [Discussion #27](https://github.com/ADD-OCD/audiobookshelfplus-app/discussions/27).

Regression coverage: `ExternalNavigationRoutesTest` exercises the actual callback/service with a synthetic player and persisted settings, including routes, chapters, files, malformed metadata, boundaries, paused/restored sessions, playlists and duplicate keys. `external-media-settings.test.mjs` exercises Settings load/save, template compilation, semantic colors and translation fallback. Device acceptance should cover keys and transport commands separately, actual notification/lock-screen actions, restart, and real controllers when available.

## Optional advanced multi-press controls

**Advanced multi-press controls** defaults to **Off**. Off preserves the basic modes and their immediate behavior, including timestamp-free home-widget commands. Turning it on exposes six independent device-local assignments:

| Gesture | Forward (Next) default | Backward (Previous) default |
| --- | --- | --- |
| Single | Configured forward time skip | Configured backward time skip |
| Double | Next chapter | Previous chapter |
| Triple | Next audio file | Previous audio file |

Each assignment can select either configured time skip, either chapter action, either audio-file action, Play/Pause, or No action. Explicit chapter/file actions do nothing when the required metadata or boundary is unavailable; they do not silently turn into time skips. Chapter Previous retains the existing 4-second restart rule. Navigation stays in the current book/episode. Dedicated Fast Forward/Rewind, notification time jumps, and on-screen player controls remain separate and immediate.

Completed, identifiable Next/Previous key presses are grouped when the next press arrives less than **350 ms** after the preceding press. Single and double actions wait 350 ms after the last press. Triple executes immediately on the third press, cancels the earlier timer, and suppresses further same-direction input for 350 ms. Forward and Backward have independent counters and timers; alternating directions finish in deadline order. A repeated DOWN, canceled UP, Android long-press flag/repeat, or a hold reaching Android's long-press timeout does not count as taps. An identified DOWN/UP pair spanning a media change is ignored.

`ExternalMultiPress` is owned by the player service and runs on its main thread. An immutable snapshot binds a gesture to the current session object and its six assignments. Prepare, session replacement/removal, close, service destruction, and settings-save entry points cancel pending work. A timer also checks the snapshot and gesture identity before dispatch, even if cancellation raced a queued callback. No gesture is retained across process death or accumulated while playback is restoring. Paused sessions can navigate without being started; only an explicit Play/Pause assignment changes playback state.

### Commands are not physical gestures

Android `onSkipToNext()` / `onSkipToPrevious()` callbacks carry no key-event identity or physical tap count. Accessories may interpret their own double/triple gestures and send only one such command. Timestamp-free keys also cannot establish independent tap identities. In advanced mode these inputs use the configured **single** action immediately, with a 350 ms same-direction guard. Repeated anonymous commands and mixed anonymous/key input within that guard are ignored rather than guessed to be a double/triple. This can suppress genuine rapid transport commands: disable advanced controls to retain immediate handling of every distinct transport request.

Identifiable media keys still use the existing bounded exact-event duplicate filter. Returning true consumes both halves of a navigation key so the framework does not redispatch it through the default transport path. There is no cross-controller physical-gesture identity; commands delivered outside the guard cannot be proven to be the same physical press. The feature captures no global keys and uses only the app's legitimate media session.

Testing distinction: Android's `cmd media_session monitor` Next/Previous commands call `dispatchMediaButtonEvent` with generated DOWN/UP key events ([AOSP MediaShellCommand](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/services/core/java/com/android/server/media/MediaShellCommand.java)). They are not anonymous `TransportControls.skipToNext/Previous` calls. S22 diagnostics distinguish these key inputs from actual notification transport callbacks. When production and debug builds both have sessions, verify that the synthetic debug session owns media-key priority before injecting global media keys.

The deterministic `ExternalMultiPressTest` drives the actual callback, service and navigation dispatcher with a controllable clock/player. It covers all six defaults and custom mappings, rapid presses, duplicate/held/canceled events, alternating directions, overdue timers, media changes, restoring/paused sessions, persisted settings, disabled behavior, anonymous/mixed-route fallback, explicit metadata/boundary no-ops, Play/Pause, and queue preservation. Physical headset/watch/car gesture behavior remains device-specific and requires separate hardware validation.
