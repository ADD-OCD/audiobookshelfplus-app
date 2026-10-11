# Changelog

Changes to Audiobookshelf+ that are merged into `plus` but not yet part of a release. Released versions, their
`versionCode`s and dates are recorded in `docs/release-process.md`, and the feature list in `readme.md` describes
what each release contains.

## Unreleased

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
  - app dialogs (sleep timer, Auto Rewind, bookmarks and the bookmark editor, speed, filter, sort and others) use a
    black recessed panel inside a steel frame;
  - primary actions (Play/Stream, Create, Update, Create New Playlist and others) are steel keys with amber labels,
    with pressed and unavailable states.
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
  - A streamed book moved from the notification, widget or a headset while paused no longer jumps back to the
    server's older position.
  - Progress saved from another device is still applied.
- **Large text** (Android font size):
  - book titles in the Library, series and Home grids sit below the covers instead of over them;
  - long series names wrap (up to two lines) in the series toolbar without covering the navigation;
  - the downloaded-book and folder lists end at the player instead of running under it.
- **Readers:**
  - the PDF reader's page counter shows above the page again;
  - the comic reader's page bar stays above its loading overlay.
- **Collapsed player:** swiping up on page content just above it no longer opens the full player.

### Known limitations

See `docs/future-work.md`:
- The EPUB, MOBI, comic and podcast flows had no test content for on-device checks.
- A remote progress update made within 10 seconds of this device's own last sync is left for the next sync.
