// Keep server identity for UI/progress, and translate to device identity only at the bridge.
export function nativeQueueItems(items) {
  return items.map((item) => ({
    libraryItemId: item.localLibraryItem?.id || item.libraryItemId,
    episodeId: item.localLibraryItem ? item.localEpisode?.id || null : item.episodeId || null
  }))
}

// Up Next display for a queue the native player holds without this UI having set it: the UI restarted (reattach), or
// a widget/headset/notification Play restored the session and its queue while the UI was already open. The saved
// display copy is used only if it describes exactly the native queue (same IDs, same order, valid index) and, when
// the session is known, the native current item is that session's item. Returns { queue } or { reason }.
export function queueDisplayFromNative(saved, native, session = null) {
  const items = native?.items
  if (!items?.length) return { reason: 'no-native-queue' }
  const index = native.currentIndex
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return { reason: 'invalid-index' }
  if (!saved?.items?.length) return { reason: 'no-saved-display' }
  const savedIds = nativeQueueItems(saved.items)
  const same = savedIds.length === items.length && savedIds.every((item, i) => item.libraryItemId === items[i].libraryItemId && item.episodeId === (items[i].episodeId || null))
  if (!same) return { reason: 'mismatch' }
  if (session) {
    const libraryItemId = session.localLibraryItem?.id || session.libraryItemId
    const episodeId = session.localLibraryItem ? session.localEpisodeId || null : session.episodeId || null
    if (items[index].libraryItemId !== libraryItemId || (items[index].episodeId || null) !== episodeId) return { reason: 'session-mismatch' }
  }
  return { queue: { ...saved, currentIndex: index } }
}

export function queueItemPayload(item) {
  const nativeItem = nativeQueueItems([item])[0]
  return {
    ...nativeItem,
    serverLibraryItemId: item.libraryItemId,
    serverEpisodeId: item.episodeId || null
  }
}

// Local progress takes priority when it exists, matching the precedence used elsewhere in this
// file (resolveQueueSourceAppendItems, resolvePlaybackQueue's index selection) - falls back to
// server progress so an item with only server-side progress isn't treated as unstarted.
export function resolveItemProgress(context, item) {
  const localProgress = item.localLibraryItem && context.$store.getters['globals/getLocalMediaProgressById'](item.localLibraryItem.id, item.localEpisode?.id)
  return localProgress || context.$store.getters['user/getUserMediaProgress'](item.libraryItemId, item.episodeId)
}

// Prefers a local copy of each book when one exists and is complete, but no longer drops a book
// from the queue just because it isn't downloaded - it's included as a server-only (streamable)
// item instead, so a gap in the downloads doesn't skip that book during continuous playback.
// Books with no audio (e.g. an ebook-only series entry) are excluded entirely - there is nothing
// to play or stream for them. Local matching falls back to `ino` (same convention used for the
// downloaded-badge elsewhere) so a book downloaded via a different library it also belongs to is
// still recognized as local instead of being re-downloaded/streamed.
export function downloadedBookItems(books, localItems, serverConnectionConfigId) {
  return books.flatMap((book) => {
    if (book.isMissing || book.isInvalid) return []
    const expectedTracks = book.media?.numTracks || book.media?.tracks?.length || 0
    if (!expectedTracks) return []
    const localLibraryItem = localItems.find((local) => (local.libraryItemId === book.id || (book.ino && local.ino && local.ino === book.ino)) && local.serverConnectionConfigId === serverConnectionConfigId && local.id?.startsWith('local') && local.mediaType === 'book' && !local.isInvalid && local.media?.tracks?.length)
    const hasCompleteLocalCopy = localLibraryItem && localLibraryItem.media.tracks.length >= expectedTracks
    // Streamable items carry the raw book so the Up Next queue can display a title/cover for
    // them (queueItemDisplay's `item.libraryItem` branch) instead of falling back to "Unknown".
    return [{ libraryItemId: book.id, episodeId: null, localLibraryItem: hasCompleteLocalCopy ? localLibraryItem : null, libraryItem: hasCompleteLocalCopy ? null : book }]
  })
}

export async function fetchSeriesBooks(http, libraryId, seriesId, encode) {
  const books = []
  const ids = new Set()
  const limit = 100
  for (let page = 0; ; page++) {
    const query = new URLSearchParams({ filter: `series.${encode(seriesId)}`, sort: 'sequence', desc: '0', limit: String(limit), page: String(page), minified: '1' })
    const payload = await http.get(`/api/libraries/${libraryId}/items?${query}`)
    if (!Array.isArray(payload?.results) || !Number.isFinite(payload.total)) throw new Error('Failed to load the complete series')
    for (const book of payload.results) {
      if (ids.has(book.id)) throw new Error('Series changed while loading. Please try again.')
      ids.add(book.id)
      books.push(book)
    }
    if (books.length >= payload.total) return books
    if (!payload.results.length) throw new Error('Failed to load the complete series')
  }
}

export async function buildQueueSourceItems(context, source) {
  // Already resolved by the caller (playlist/podcast sources, or a series/collection resolved
  // up front by the Play-prompt flow to decide whether to prompt without a second fetch here).
  if (source.items) return source.items
  if (source.sourceType === 'series' || source.sourceType === 'collection') {
    const books = source.sourceType === 'series' ? await fetchSeriesBooks(context.$nativeHttp, source.libraryId, source.sourceId, context.$encode) : source.books
    const localItems = (await context.$db.getLocalLibraryItems('book')) || []
    return downloadedBookItems(books, localItems, context.$store.getters['user/getServerConnectionConfigId'])
  }
  throw new Error('Unknown playback queue source')
}

// Items to append to an already-playing queue: same source resolution as resolvePlaybackQueue,
// but filtered to unfinished items and deduped against what's already queued.
export async function resolveQueueSourceAppendItems(context, source, existingItems) {
  const items = await buildQueueSourceItems(context, source)
  const unfinished = items.filter((item) => {
    const localProgress = item.localLibraryItem && context.$store.getters['globals/getLocalMediaProgressById'](item.localLibraryItem.id, item.localEpisode?.id)
    const progress = localProgress || context.$store.getters['user/getUserMediaProgress'](item.libraryItemId, item.episodeId)
    return !progress?.isFinished
  })
  const existingKeys = new Set(nativeQueueItems(existingItems).map((i) => `${i.libraryItemId}|${i.episodeId || ''}`))
  return unfinished.filter((item) => {
    const key = nativeQueueItems([item])[0]
    return !existingKeys.has(`${key.libraryItemId}|${key.episodeId || ''}`)
  })
}

// Shapes the active playback session as a queue item, for synthesizing a fresh queue
// when the user adds to queue while playing something with no existing playbackQueue.
export function sessionToQueueItem(session) {
  return {
    libraryItemId: session.libraryItemId,
    episodeId: session.episodeId || null,
    localLibraryItem: session.localLibraryItem || null,
    localEpisode: session.localEpisodeId ? { id: session.localEpisodeId } : null,
    displayTitle: session.displayTitle,
    displayAuthor: session.displayAuthor,
    coverPath: session.coverPath
  }
}

// Normalizes the three queue item shapes (session-synthesized, playlist-sourced with a
// nested .libraryItem/.episode, series/collection-sourced with only .localLibraryItem)
// into a consistent display shape for the queue UI.
export function queueItemDisplay(item) {
  if (item.displayTitle) {
    return { title: item.displayTitle, subtitle: item.displayAuthor || '', libraryItemForCover: item.localLibraryItem || item.libraryItem || null, coverPath: item.coverPath || null }
  }
  if (item.libraryItem) {
    const metadata = item.libraryItem.media?.metadata || {}
    return { title: item.episode?.title || metadata.title || 'Unknown', subtitle: metadata.authorName || metadata.author || '', libraryItemForCover: item.localLibraryItem || item.libraryItem, coverPath: null }
  }
  if (item.localLibraryItem) {
    const metadata = item.localLibraryItem.media?.metadata || {}
    return { title: metadata.title || 'Unknown', subtitle: metadata.authorName || metadata.author || '', libraryItemForCover: item.localLibraryItem, coverPath: null }
  }
  return { title: 'Unknown', subtitle: '', libraryItemForCover: null, coverPath: null }
}

export async function resolvePlaybackQueue(context, payload) {
  const source = payload.queueSource
  if (!source || context.$platform !== 'android') return { payload, queue: null }
  const items = await buildQueueSourceItems(context, source)
  let currentIndex
  if (payload.libraryItemId) {
    currentIndex = items.findIndex((item) => {
      const nativeItem = nativeQueueItems([item])[0]
      const serverMatch = item.libraryItemId === (payload.serverLibraryItemId || payload.libraryItemId) && (item.episodeId || null) === (payload.serverEpisodeId || payload.episodeId || null)
      const localMatch = nativeItem.libraryItemId === payload.libraryItemId && nativeItem.episodeId === (payload.episodeId || null)
      return serverMatch || localMatch
    })
    // Undownloaded books are queue members that stream (see downloadedBookItems), so this only
    // happens when the selected item isn't a playable member of the source: it plays alone.
    if (currentIndex < 0) return { payload, queue: null }
  } else {
    currentIndex = items.findIndex((item) => {
      const localProgress = item.localLibraryItem && context.$store.getters['globals/getLocalMediaProgressById'](item.localLibraryItem.id, item.localEpisode?.id)
      const progress = localProgress || context.$store.getters['user/getUserMediaProgress'](item.libraryItemId, item.episodeId)
      return !progress?.isFinished
    })
    if (currentIndex < 0) throw new Error(items.length ? 'All downloaded books are finished' : 'No downloaded audiobooks available')
  }
  return {
    payload: { ...payload, ...queueItemPayload(items[currentIndex]) },
    queue: { sourceType: source.sourceType, sourceId: source.sourceId, items, currentIndex }
  }
}
