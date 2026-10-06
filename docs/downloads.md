# Downloads

How a book or episode download moves through the app, and what the user's controls do. Native code: `AbsDownloader` (Capacitor plugin), `DownloadServiceHost`, `DownloadService` (foreground service), `DownloadItemManager` (queue), `DownloadControls` (Retry/Cancel/Clear rules), `InternalDownloadManager` (HTTP transfer), `IncompleteDownloadCleanup`. Frontend: `utils/downloadState.js`, `pages/downloading.vue` (the Downloads screen), `components/widgets/DownloadProgressIndicator.vue` (app-bar badge), the item page.

## Lifecycle

1. The item page (or series/episode rows) calls `AbsDownloader.downloadLibraryItem`. If the item is already in the queue the call is a Retry of it; otherwise a `DownloadItem` is built with one part per audio file, ebook and cover (`cover-<server item id>.jpg`) and queued.
2. The queue is persisted (Paper `downloadItems`) and survives navigation, the UI closing and process death. `DownloadService` runs the transfers (up to 3 files at once) into app staging files, then each finished file is moved to its destination: internal app storage, or the chosen device folder (SAF).
3. When every file is in place the item is scanned into a local library item, removed from the queue and reported to the UI (`onItemDownloadComplete`).

## States (as the Downloads screen shows them)

| State | When | Controls |
|---|---|---|
| Queued | waiting for a transfer slot | Cancel |
| Waiting for storage space | not enough free space yet | Cancel |
| Downloading (n%) | a file is transferring, or a finished file is being saved to its folder | Cancel |
| Download failed | a file failed for good (automatic retries used up, server refusal, failed save) | Retry, Clear |
| Folder access lost | the device folder can't be written (access revoked, or the folder was deleted or moved) | Choose folder, Clear |
| Finishing | every file is in place; becoming a local item | none |

The state comes from the parts' flags (`downloadId`, `completed`, `moved`, `isMoving`, `failed`, `permissionLost`, `waitingForSpace`); it is always shown in words next to an icon. The item page shows the failed states and links to the Downloads screen, and its Download button opens the Downloads screen while a download exists.

## Retry is not Resume

- **Automatic retries** (up to 5 per file, inside one service session) continue a partial file with an HTTP `Range` request where the server allows it.
- **Retry** (the user's button, or the Download button on a failed item) and **app/process restart** start every unfinished file again from byte 0. Files already finished in their destination are kept and are not downloaded again. The button is therefore called Retry, and the Downloads screen says so.
- A failed download stays failed across restarts with its reason (including lost folder access); it is never retried silently.

## Cancel and Clear

Both remove the download: they stop its transfers, drop it from the queue and its saved record, and delete the app's own partial (staging) files. Cancel is offered while a download is active or queued; Clear when it has stopped (failed or lost folder access). Neither is possible while a finished file is being saved to its folder (a moment; "try again") or once the download is finishing.

Finished files a removed download already placed in a **device folder** are kept there (a later download of the same item reuses them; Rescan Folder can link them). Finished files in **internal app storage** are deleted, since nothing else can reach them. A file a saved local item uses, or one that existed before the download (`reusedExistingFile`), is never deleted. A completed download is not in the queue, so Clear can't reach it; deleting a downloaded book stays with the local item's existing delete.

The download notification's Cancel cancels every download that can be removed, with the same rules.

## Folder access

Before a file is started and before it is saved to a device folder, the downloader checks that it can still write there (`FolderAccess`, the same rule as the Local Folders permission check): SimpleStorage access for the folder's file path (or the persisted tree grant), and that the folder exists and is writable. Without it the files fail at once as "Folder access lost" (no retry loop), and Retry is refused until access is back. **Choose folder** opens the folder picker; picking the same folder restores the grant (the same folder keeps its id) and retries the download. Picking a different folder doesn't move the download; the user is told to choose the original folder, or can Clear and download again.

Before this was fixed, the access check was given the folder's `content://` URL, which SimpleStorage reads as a path, so it always answered "no access": every download into a device folder failed at once as "Lost access" (introduced in `ba008570`).

## Diagnostics

The log records each user action ("User chose Retry/Cancel/Clear"), and for each: the item id and title, the destination folder, the state it was in, how many unfinished files restart from byte 0 and finished files are kept (Retry), and how many app-owned files were deleted and finished files kept (Cancel/Clear), plus refused retries for lost folder access. Failures log their reason per file. No tokens or credentials are logged.
