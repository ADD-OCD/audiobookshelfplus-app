# Changelog

Audiobookshelf+ changes by release. Earlier releases, their `versionCode`s and dates are recorded in
`docs/release-process.md`, and the feature list in `readme.md` describes what the app contains.

## v0.18.0 — RICE customization and sign-in reliability

**Released 2026-10-12:** versionCode 134, versionName `0.14.2-beta` (upstream base unchanged), `PLUS_VERSION`
`0.18.0`, tag `v0.14.2-beta-plus-v0.18.0`. Changes since v0.17.0 (`a9084e19`).

- **RICE customization** (Settings → Appearance), off by default. Dark, Black, Light and LLAMA are unchanged.
  - Ten starter palettes adapted from Catppuccin (Mocha, Latte), Dracula, Nord, Gruvbox, Tokyo Night, Rosé Pine,
    Solarized (Dark, Light) and Everforest, with their licences and sources listed in the app.
  - Personal presets (up to 32): bounded color and style options, a live preview, Apply, Cancel and Reset, and a
    readability check before saving. Damaged saved appearance data falls back to the last good copy or a built-in.
  - Device colors: on Android 12 and newer, follows the system color palette (including Samsung One UI's Color palette)
    and system light/dark.
  - The home-screen widget takes RICE colors on Android 12 and newer.
  - Import palette colors from public GitHub Linux theme projects: pywal, Kitty, Base16/Base24 and plain hex lists.
    Nothing is applied before you save it.
  - Details: `docs/rice-customization.md`.
- **Sign-in renewal:** when several requests find the sign-in expired at once, the app renews it once and retries
  each of them. Overlapping renewals could use the same single-use refresh token and sign you out.
- **Fewer unexpected sign-outs:**
  - being offline or a server error while renewing no longer signs you out;
  - neither does a request that fails for another reason after renewing.
  You're signed out only when the server refuses the sign-in.
- **No crossed sessions:** a renewal still running when you sign out or switch server or account can't change the new
  session or the saved sign-in. A sign-in renewed at startup is saved. Details: `docs/authentication.md`.

### Known limitations

- **Linux theme import:** only the four formats above, from public GitHub repositories. It doesn't read GTK, Rofi,
  Polybar or other config files, other hosts, or images.
- **Image palettes:** making a palette from an image or wallpaper isn't included.
- **Samsung themes:** RICE follows the system color palette that One UI sets. It can't import Samsung Galaxy Themes or
  Theme Park themes.
- **Not themed:** the media notification, launcher icon and Android's own dialogs keep their standard look, and a few
  older colors (such as the yellow progress bar on book covers) stay the same in every appearance.
- **Progress from another device:** while an audiobook is playing, progress updates from another device are not
  applied, and the next progress save from this device may overwrite those updates. When you return to a paused
  audiobook, progress changes from another device are recognized and applied.

## v0.17.0 — In-app GitHub updates

**Released 2026-10-11:** versionCode 133, versionName `0.14.2-beta` (upstream base unchanged), tag
`v0.14.2-beta-plus-v0.17.0` at `a9084e19`. [Release](https://github.com/ADD-OCD/audiobookshelfplus-app/releases/tag/v0.14.2-beta-plus-v0.17.0). Changes since v0.16.0 (`10db9077`).

- **In-app updates** (Settings → Updates): check the official GitHub releases, download the latest stable release with
  progress, Cancel and Retry, and install it through Android's installer after verification.
  - The download must match its published size and digests.
  - It must be the Audiobookshelf+ package, newer than the installed version code, not debuggable, and signed with the
    Audiobookshelf+ release key.
  - Nothing downloads or installs on its own. Android asks you to confirm every installation.
  - Installing needs Android's "Install unknown apps" permission. The app asks for it only when you tap Install.
  - **Open installer** shows Android's confirmation again if you left it.
  - For the GitHub-distributed app; a copy installed from Google Play leaves updates to the store.
  - Details: `docs/in-app-updates.md`.
- **Release consistency:** an automated check keeps the app's public version (`PLUS_VERSION`) in step with its
  `versionCode` and the release ledger.

### Known limitations

- **Production self-update not yet verified:** the in-app updater has been tested with signed test applications.
  Updating an existing production Audiobookshelf+ installation through the updater will be verified with a subsequent
  release.
- **Progress from another device:** while an audiobook is playing, progress updates from another device are not
  applied, and the next progress save from this device may overwrite those updates. When you return to a paused
  audiobook, progress changes from another device are recognized and applied.

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
- **Progress from another device:** while an audiobook is playing, progress updates from another device are not
  applied, and the next progress save from this device may overwrite those updates. When you return to a paused
  audiobook, progress changes from another device are recognized and applied.
- Not tested on a device: comic CBR, compressed or KF8/AZW3 MOBI files, and real podcast feeds.
