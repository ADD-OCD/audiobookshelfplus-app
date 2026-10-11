# Changelog

Audiobookshelf+ changes by release. Earlier releases, their `versionCode`s and dates are recorded in
`docs/release-process.md`, and the feature list in `readme.md` describes what the app contains.

## v0.16.0 — LLAMA visual refresh and stability fixes

**Prepared, not yet published:** versionCode 132, versionName `0.14.2-beta` (upstream base unchanged). Changes since
v0.15.1 (`d2795e4c`).

### LLAMA theme

LLAMA only; Black, Dark and Light are unchanged by these.

- **A more faithful finish:**
  - brushed-steel panels and keys with lit and shaded bevels;
  - steel cover frames;
  - green phosphor readouts;
  - amber key legends;
  - a near-black graphite page with a faint scan-line texture.
- **Home screen widget:** a steel housing with socketed steel keys and amber legends, at every widget size.
- **Dialogs and actions:**
  - app dialogs (sleep timer, Auto Rewind, bookmarks and the bookmark editor, speed, filter, sort and others) use a black
    recessed panel inside a steel frame;
  - primary actions (Play/Stream, Create, Update, Create New Playlist and others) are steel keys with amber labels, with
    pressed and unavailable states.
- **Play controls** in the series toolbar, list rows, collection and playlist rows, podcast episode rows and the
  downloaded-book page use the amber action legend. Green stays for selection, focus, readouts and active states.
- **Home shelf covers:** the cover frame is drawn inside the cover, so the shelves' scrolling no longer cuts off its
  top edge.
- **Collapsed player:**
  - it is 92px tall; the empty band under its progress bar is gone;
  - the page content, the downloaded-media screens, the readers' toolbars and the player's own swipe area follow that
    height;
  - other themes keep the 120px player.

### Fixes in every theme

- **Bookmark button:** the full player's bookmark button no longer disappears when the app can't reach the server.
  Saved bookmarks can be viewed offline.
- **Position on return:** a paused book shows its real position when you return to the app.
  - A downloaded book no longer shows an older saved position (which a new bookmark could also use).
  - A streamed book moved from the notification, widget or a headset while paused no longer jumps back to the server's
    older position.
  - Progress saved from another device more than 10 seconds after this phone's last sync is still applied when you
    return.
- **Large text** (Android font size):
  - book titles in the Library, series and Home grids sit below the covers instead of over them;
  - long series names wrap (up to two lines) in the series toolbar without covering the navigation;
  - the downloaded-book and folder lists end at the player instead of running under it.
- **Readers:**
  - the PDF reader's page counter shows above the page again;
  - the comic reader's page bar stays above its loading overlay.
- **Collapsed player:** swiping up on page content just above it no longer opens the full player.

### Other changes since v0.15.1

- **Media buttons:** a headset's Play or call button and a Bluetooth Play now restore a paused book reliably after
  Android closed the player in the background. Before, only Play/Pause did, and those buttons could do nothing or,
  rarely, make the app close.
- **Broken covers:** a downloaded book whose cover image is missing, unreadable or damaged still plays and resumes; the
  notification and lock screen show the Audiobookshelf+ artwork instead. Before, starting or resuming such a book could
  make the app close.
- **System log privacy:** Android's own system log (what `adb logcat` and bug reports show) no longer receives sign-in
  tokens, server connection details or your username, including in debug builds.

### Known limitations

See `docs/future-work.md`:
- **Progress from another device inside the 10-second window:** progress saved there within 10 seconds of this phone's
  own last sync is not applied when you return to a paused streamed book. This phone's next sync then replaces it
  (whichever device saves last wins).
- **Formats not tested on a device:** comic CBR, compressed or KF8/AZW3 MOBI files, and real-world podcast feeds. The
  readers and podcast controls were tested on a device with generated EPUB, MOBI (uncompressed) and CBZ files, the PDF
  reader with a real PDF, and podcasts with a local podcast folder.
