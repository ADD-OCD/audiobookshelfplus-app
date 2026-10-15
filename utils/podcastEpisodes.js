const getNestedValue = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)

export function sortPodcastEpisodes(episodes, sortKey, sortDesc) {
  return [...episodes].sort((a, b) => {
    let aValue = getNestedValue(a, sortKey)
    let bValue = getNestedValue(b, sortKey)

    // Sort episodes with no pub date as the oldest
    if (sortKey === 'publishedAt') {
      if (!aValue) aValue = Number.MAX_VALUE
      if (!bValue) bValue = Number.MAX_VALUE
    }

    if (sortDesc) {
      return String(bValue).localeCompare(String(aValue), undefined, { numeric: true, sensitivity: 'base' })
    }
    return String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' })
  })
}

// A local item shares the override of its server item (if known), so online and offline pages sort alike
export function podcastSortOverrideKey(libraryItem, isLocal) {
  if (!libraryItem) return null
  if (isLocal) return libraryItem.libraryItemId || libraryItem.id
  return libraryItem.id
}

const isValidOverride = (o) => !!o && typeof o.orderBy === 'string' && !!o.orderBy && typeof o.desc === 'boolean'

// Per-podcast override wins over the global setting; a null global direction means "auto by podcast type".
// Downloaded podcasts carry no type, so only an explicit 'serial' sorts ascending.
export function resolvePodcastEpisodeSort(userSettings, overrideKey, podcastType) {
  const override = (overrideKey && userSettings?.podcastEpisodesOrderOverrides?.[overrideKey]) || null
  if (isValidOverride(override)) return { orderBy: override.orderBy, desc: override.desc, override }

  const desc = userSettings?.podcastEpisodesOrderDesc
  return {
    orderBy: userSettings?.podcastEpisodesOrderBy || 'publishedAt',
    desc: desc == null ? podcastType !== 'serial' : desc,
    override: null
  }
}
