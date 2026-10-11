# Changelog

Audiobookshelf+ changes by release. Earlier releases, their `versionCode`s and dates are recorded in
`docs/release-process.md`, and the feature list in `readme.md` describes what the app contains.

## Unreleased

Committed on `feature/in-app-github-updater` for a future release; not part of v0.16.0.

- **In-app updates** (Settings → Updates): check the official GitHub releases, download the latest stable release with
  progress, Cancel and Retry, and install it through Android's installer after verification.
  - The download must match its published size and digests.
  - It must be the Audiobookshelf+ package, newer than the installed version code, not debuggable, and signed with the
    Audiobookshelf+ release key.
  - Nothing downloads or installs on its own.
  - Installing needs Android's "Install unknown apps" permission. The app asks for it only when you tap Install.
  - Details: `docs/in-app-updates.md`.

## v0.16.0 — LLAMA visual refresh and stability fixes

**Released 2026-10-11:** versionCode 132, versionName `0.14.2-beta` (upstream base unchanged), tag
`v0.14.2-beta-plus-v0.16.0` at `10db9077`. [Release](https://github.com/ADD-OCD/audiobookshelfplus-app/releases/tag/v0.14.2-beta-plus-v0.16.0) ·
[Announcement](https://github.com/ADD-OCD/audiobookshelfplus-app/discussions/21). Changes since v0.15.1 (`d2795e4c`).

### LLAMA theme

LLAMA only; Black, Dark and Light are unchanged.

- Brushed-steel panels, keys and cover frames, green readouts and amber key legends on a near-black page.
- Steel home screen widget with socketed keys, at every size.
- Dialogs are black panels in a steel frame; primary actions are steel keys with amber labels.
- Play controls in series, lists, collections, playlists, podcast episodes and downloaded books use the amber legend.
- Home shelf cover frames are no longer cut off at the top.
- Slimmer collapsed player (92px) without the empty strip under its progress bar; pages, downloaded-media screens and
  reader toolbars follow its height.

### Fixes in every theme

- Bookmark button available offline; saved bookmarks can be viewed offline.
- A paused book shows its real position when you return to the app:
  - downloaded books no longer show an older saved position;
  - streamed books moved from the notification, widget or a headset while paused no longer jump back;
  - progress saved on another device after this phone's last save is applied, however soon after that save it came
    (the phone recognises its own saves by what the server confirmed, not by timing).
- Large text: grid titles sit below covers, long series names wrap without covering the navigation, and the
  downloaded-book and folder lists end at the player.
- PDF reader page counter visible again; comic page bar stays above its loading overlay.
- Swiping up just above the collapsed player no longer opens the full player.

### Other changes since v0.15.1

- Headset Play/call and Bluetooth Play reliably restore a paused book after Android closed the player.
- A downloaded book with a missing or damaged cover image keeps playing instead of making the app close.
- Sign-in tokens, server details and the username no longer reach Android's system log.

### Known limitations

See `docs/future-work.md`:
- While this phone is playing, progress saved on another device is not applied and the next save replaces it (as in
  earlier releases); it is applied when you return to the app with the book paused.
- Not tested on a device: comic CBR, compressed or KF8/AZW3 MOBI files, and real podcast feeds.
