# Audiobookshelf+ (unofficial Android app)

**Audiobookshelf+** is an unofficial Android fork of the [Audiobookshelf](https://audiobookshelf.org) mobile app,
built and maintained independently of the official project. Audiobookshelf itself is a
self-hosted audiobook and podcast server.

This fork tracks [upstream `master`](https://github.com/advplyr/audiobookshelf-app) and is
periodically rebased onto each new official release, so it stays current with all official
fixes and features while adding the changes below on top.

**This fork is Android-only.** The iOS side is not maintained here — changes, builds, and
testing are focused entirely on Android.

**Not affiliated with or endorsed by the official Audiobookshelf project.** All credit for the
original app goes to [advplyr](https://github.com/advplyr) and the Audiobookshelf contributors.
This fork exists to carry a small set of additional fixes/features that aren't (yet, or won't
be) in the official app.

### What's different from official

- **Continuous playback for downloaded series/collections** — automatically advances to the
  next downloaded book in a series instead of stopping after one.
- **More reliable background playlist advancement for podcasts** — survives Android Doze mode,
  keeps CPU/network awake during transitions, correctly forwards playback-ended state to the UI
  when backgrounded, and pauses properly on Bluetooth disconnect instead of continuing to play
  through the phone speaker.
- **Auto-play next episode** when playing through a podcast playlist.
- **Fixed a bug where downloading a series would silently stall** after the first book
  (a race condition/permanent lock in the download queue) — inherited for free from an upstream
  rewrite this fork rebases onto.
- **Cross-library downloaded-item recognition** — if the same book exists in more than one of
  your libraries, downloading it once now shows it as downloaded everywhere it appears, instead
  of only in the library you downloaded it from.
- **Rescan a local folder** — a "Rescan Folder" action on the local folder detail page picks up
  books that already exist on disk (from before cross-library recognition existed, from another
  install, or from the official app's own download folder) and links them back to your library
  without re-downloading.
- **Distinct app identity** — installs as "Audiobookshelf+" with its own icon (a bronze plus
  badge over the official icon), so it's visually distinguishable from the official app and can
  be installed alongside it.
- **Fixed downloads silently stalling when a local folder's permission is lost** — instead of
  retrying forever and re-downloading the whole file from scratch on every app restart, the app
  now detects a lost/invalid folder permission immediately and shows a clear error telling you to
  re-select the folder.
- **Fixed playback progress tracking the wrong book during continuous series playback** — after
  the queue advanced to the next book, progress kept being recorded against the previous book
  (wrong position, book never marked finished, series progress not shown); progress now follows
  whichever book is actually playing.
- **A visible, reorderable "Up Next" queue** — see what's playing next from the player's menu (or
  an optional icon in the player itself), reorder or remove upcoming items, and add individual
  books/episodes or a whole series/playlist/collection to the queue while something is already
  playing.
- **Bigger, clearer home screen widget buttons** — rewind/play/fast-forward now have a visible
  rounded-rectangle outline and a larger tap target, instead of bare icons that were easy to miss.
- **Fixed series progress not reflecting locally downloaded books** — the series shelf card only
  checked server-synced progress, so a downloaded book's real progress (before it synced to the
  server, or if it never needed to) could show as barely started even though it was finished;
  it now checks local device progress too.
- **Podcasts now auto-advance from the podcast page's Play button** — it already found the next
  unfinished episode, but never queued anything after it, so playback stopped after one episode.
  Now queues and continues through the remaining unfinished episodes, same as playlists already did.
- **Fixed offline listening progress getting silently wiped on reconnect** — the server/local
  progress sync only compared timestamps, so a newer server timestamp would overwrite local
  progress even when the server's actual position was behind (e.g. after a long offline listening
  session). A newer server timestamp is now only trusted when its progress is actually caught up;
  otherwise local's progress is pushed to the server instead of being overwritten.
- **Continuous series/collection playback now streams past gaps in your downloads** instead of
  silently skipping undownloaded books — local is still always preferred when present.
- **Optional prompt when playing an incomplete series/collection/playlist** — off by default; when
  enabled (Settings), tapping Play on something that isn't fully downloaded offers a choice
  between playing now (streaming the gaps) or downloading the missing pieces while playback starts
  immediately. Downloads are triggered in the order they'll actually be needed.
- **Fixed the "Download Series" button downloading in arbitrary order** — it now downloads in
  series sequence, same order continuous playback already uses.
- **Fixed a playlist item restarting from 0:00 despite showing prior progress** — a downloaded
  book with progress recorded only on the server (e.g. listened to elsewhere before downloading)
  now resumes from that progress when played from a playlist, instead of silently ignoring it
  because only local progress was checked.
- **Fixed the "Ask before streaming incomplete series/collections/playlists" setting not staying
  enabled** — the native device-settings model was missing this field, so it was silently dropped
  every time settings saved and the toggle immediately reverted to off.
- **Stability pass**: fixed a batch of playback/download edge cases found during a full audit of
  existing features. Playlist and podcast auto-advance now correctly resume/play the intended
  item; a book downloaded via one library now shows as downloaded everywhere it appears, even
  during continuous series/collection/playlist playback (not just on the bookshelf badge);
  Collection playback no longer treats a partially-downloaded book as complete; the Up Next queue
  now shows a proper title and cover for items that are streaming rather than downloaded; a rare
  situation that could stop all playback until the app was restarted is fixed; failed downloads
  (e.g. a lost folder permission) now show an error instead of failing silently; and Rescan Folder
  now checks your whole library instead of only the first 100 books.
- **Keyboard-friendly connection and login screens** — when the Android on-screen keyboard opens,
  the Server Address and Login screens now adapt: the fields and Submit buttons stay reachable,
  the page scrolls if space runs short, and the large logo condenses until the keyboard closes.
  The connection screen also links separately to Official Audiobookshelf and to Audiobookshelf+
  (this unofficial fork), and those links no longer overlap the form.
- **Playback restoration** — swiping Audiobookshelf+ away no longer loses your place. Playback
  that is already playing simply keeps going. A paused book can be resumed from the Android
  widget, the media notification or a headset button, even after Android has closed the player
  in the background: pressing Play rebuilds the session with the same book, position, playback
  speed and Up Next queue. Downloaded books resume this way without a network connection
  (streamed books need to reach your server). Reopening the app reconnects the player screen to
  whatever is already playing. Closing the player with its X ends the session, so it isn't
  brought back later. (Android's *Force stop* is still a hard stop — open the app normally after
  using it.)
- **In-app diagnostics** — Settings → Diagnostics can keep a diagnostic log on the phone to help
  troubleshoot problems without a computer or ADB. Choose *Normal*, *Debug* or *Verbose*; the log
  keeps recording while the app is closed or playing in the background, combines the app's
  playback service and screens into one timeline, and is size-limited, with the oldest entries
  removed automatically. **Log actions**: *View* it in the app, *Save* it to your phone through
  Android's normal Save As screen, *Share* it, *Mark* the moment something goes wrong with a note,
  or *Clear* it. Logs are sanitized before they're stored or exported — passwords, tokens, server
  addresses and file locations are redacted — but please look over a log before sharing it
  publicly.
- **LLAMA theme** — an optional, original late-1990s audio-equipment theme (Settings → Theme): a
  deep navy chassis, a full player with physical-style transport and utility keys, amber key
  legends and progress, and green readouts for speed, sleep timer and playback time. The home
  screen widget follows it. Black, Dark and Light are unchanged.
- **Download controls** — the Downloads screen shows each download's real state in words
  (queued, waiting for space, downloading, failed, folder access lost, finishing) and offers
  *Retry*, *Cancel* and *Clear*. Retry keeps the files that already finished and starts only the
  unfinished ones again. A failed download stays failed, with its reason, across app restarts
  instead of retrying silently. When a device folder can't be written any more, *Choose folder*
  restores access and continues the download.
- **Fixed downloads to device folders and the Local Folders permission check** — downloads into a
  folder on the phone no longer fail at once as "lost access", and adding a working folder no
  longer reports "Folder permissions failed".
- **Rescan Folder across libraries** — when the same book is in several of your libraries,
  Rescan Folder now links each downloaded book to the copy it was actually downloaded from, so
  covers show and the book opens in the right library. Books that were linked to the wrong copy
  are repaired on rescan without losing files or listening progress. Rescan also shows live
  progress and reports books it couldn't link.
- **Library lists recover from loading failures** — if part of a library fails to load (a weak
  mobile connection, or returning to the app after a long time in the background), those rows are
  loaded again instead of staying blank. A series opened from the Series tab shows all of its books
  again; in v0.15.0 only the first one or two appeared and the other rows stayed blank (fixed in
  v0.15.1).
- **Smaller touches** — the downloaded tick in list rows sits above the Play key instead of on the
  cover, and the connection screen shows the GitHub avatars of the official project and of
  Audiobookshelf+.

### Getting builds

This fork does not publish to the Play Store or TestFlight. Installable APKs are published on
this repo's [Releases](https://github.com/ADD-OCD/audiobookshelfplus-app/releases) page — always
the release package (`app.absplus.android`), signed with the permanent Audiobookshelf+ key, so
updates install over each other. Debug builds (`app.absplus.android.debug`) are for local
development only and are not published. You can also build it yourself with the instructions
below.

---

This fork: [github.com/ADD-OCD/audiobookshelfplus-app](https://github.com/ADD-OCD/audiobookshelfplus-app)

[Official project repo: github.com/advplyr/audiobookshelf](https://github.com/advplyr/audiobookshelf) or the project site [audiobookshelf.org](https://audiobookshelf.org)

Join the official community on [discord](https://discord.gg/pJsjuNCKRq) — this fork is not
supported there; use this repo's [Discussions](https://github.com/ADD-OCD/audiobookshelfplus-app/discussions)
instead for fork-specific problems.

**Requires an Audiobookshelf server to connect with**

## Contributing

The app is built with [NuxtJS](https://nuxtjs.org/) and [Capacitor](https://capacitorjs.com/). The
inherited codebase is cross-platform (one web app inside Android and iOS shells), but
**Audiobookshelf+ supports and tests Android only**. The iOS project is kept as inherited from
upstream and is not maintained or supported here.

### Localization

Translations come from the official Audiobookshelf project, whose translations are hosted on
[Weblate](https://hosted.weblate.org/engage/audiobookshelf/) (see
[how to help](https://www.audiobookshelf.org/faq#how-do-i-help-with-translations)). Strings added
by Audiobookshelf+ are maintained in this repository and fall back to English.

### Windows Environment Setup for Android

Required Software:

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/) (version 20)
- Code editor of choice([VSCode](https://code.visualstudio.com/download), etc)
- [Android Studio](https://developer.android.com/studio)
- [Android SDK](https://developer.android.com/studio)

<details>
<summary>Install the required software with <a href=(https://docs.microsoft.com/en-us/windows/package-manager/winget/#production-recommended)>winget</a></summary>

<p>
Note: This requires a PowerShell prompt with winget installed.  You should be able to copy and paste the code block to install.  If you use an elevated PowerShell prompt, UAC will not pop up during the installs.

```PowerShell
winget install -e --id Git.Git; `
winget install -e --id Microsoft.VisualStudioCode; `
winget install -e --id  Google.AndroidStudio; `
winget install -e --id OpenJS.NodeJS --version 20.11.0;
```

![](/screenshots/dev_setup_windows_winget.png)

</p>
</details>
<br>

Your Windows environment should now be set up and ready to proceed!

### Mac Environment Setup for Android

Required Software:

- [Android Studio](https://developer.android.com/studio)
- [Node.js](https://nodejs.org/en/) (version 20)
- [Android SDK](https://developer.android.com/studio)

<details>
<summary>Install the required software with <a href=(https://brew.sh/)>homebrew</a></summary>

<p>

```zsh
brew install android-studio node
```

</p>
</details>

### Start working on the Android app

Clone or fork the project from terminal or powershell and `cd` into the project directory.

Install the required node packages:

```shell
npm install
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_android_npm_install.png)

</details>
<br>

Generate static web app:

```shell
npm run generate
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_android_npm_run.png)

</details>
<br>

Copy web app into native android/ios folders:

```shell
npx cap sync
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_android_cap_sync.png)

</details>
<br>

Open Android Studio:

```shell
npx cap open android
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_cap_android.png)

</details>
<br>

Start coding!

After making changes to the JS layer you need to rebuild the nuxt pages and sync them to the native shells:

```shell
npm run sync
```

### Mac Environment Setup for iOS

> **Not supported by Audiobookshelf+.** The iOS instructions below are inherited from upstream and
> kept for reference only. This fork does not maintain, build, test or distribute the iOS app.

Required Software:

- [Xcode](https://developer.apple.com/xcode/)
- [Node.js](https://nodejs.org/en/)
- [Cocoapods](https://guides.cocoapods.org/using/getting-started.html#installation)

### Start working on the iOS app

Clone or fork the project in the terminal and `cd` into the project directory.

Install the required node packages:

```shell
npm install
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_ios_npm_install.png)

</details>
<br>

Generate static web app:

```shell
npm run generate
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_ios_npm_generate.png)

</details>
<br>

Copy web app into native android/ios folders:

```shell
npx cap sync
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_ios_cap_sync.png)

</details>
<br>

Open Xcode:

```shell
npx cap open ios
```

<details>
<summary>Expand for screenshot</summary>

![](/screenshots/dev_setup_ios_cap_open.png)

</details>
<br>

Start coding!

After making changes to the JS layer you need to rebuild the nuxt pages and sync them to the native shells:

```shell
npm run sync
```
