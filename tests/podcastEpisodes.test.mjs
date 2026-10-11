import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// Load the Nuxt ES module without changing this project's CommonJS package type.
const helperSource = await readFile(new URL('../utils/podcastEpisodes.js', import.meta.url), 'utf8')
const { podcastSortOverrideKey, resolvePodcastEpisodeSort, sortPodcastEpisodes } = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`)

const episodes = [
  { id: 'b', title: 'Ep 10', publishedAt: 2000, episode: '10', audioFile: { metadata: { filename: 'b.mp3' } } },
  { id: 'a', title: 'Ep 2', publishedAt: 1000, episode: '2', audioFile: { metadata: { filename: 'a.mp3' } } },
  { id: 'c', title: 'Ep 3', publishedAt: null, episode: '3', audioFile: { metadata: { filename: 'c.mp3' } } }
]
const ids = (list) => list.map((e) => e.id)

test('sorts numerically, by nested keys, and treats episodes without a pub date as the oldest', () => {
  assert.deepEqual(ids(sortPodcastEpisodes(episodes, 'episode', false)), ['a', 'c', 'b'])
  assert.deepEqual(ids(sortPodcastEpisodes(episodes, 'audioFile.metadata.filename', true)), ['c', 'b', 'a'])
  assert.deepEqual(ids(sortPodcastEpisodes(episodes, 'publishedAt', false)), ['c', 'a', 'b'])
  assert.deepEqual(ids(sortPodcastEpisodes(episodes, 'publishedAt', true)), ['b', 'a', 'c'])
})

test('does not mutate the input list', () => {
  const input = [...episodes]
  sortPodcastEpisodes(input, 'title', false)
  assert.deepEqual(ids(input), ids(episodes))
})

test('global sort with auto direction follows the podcast type', () => {
  const settings = { podcastEpisodesOrderBy: 'title', podcastEpisodesOrderDesc: null }
  assert.deepEqual(resolvePodcastEpisodeSort(settings, 'li_1', 'episodic'), { orderBy: 'title', desc: true, override: null })
  assert.deepEqual(resolvePodcastEpisodeSort(settings, 'li_1', 'serial'), { orderBy: 'title', desc: false, override: null })
  assert.deepEqual(resolvePodcastEpisodeSort({}, null, 'serial'), { orderBy: 'publishedAt', desc: false, override: null })
})

test('a per-podcast override wins over the global sort only for its own podcast', () => {
  const override = { orderBy: 'episode', desc: false }
  const settings = { podcastEpisodesOrderBy: 'publishedAt', podcastEpisodesOrderDesc: true, podcastEpisodesOrderOverrides: { li_1: override } }
  assert.deepEqual(resolvePodcastEpisodeSort(settings, 'li_1', 'episodic'), { orderBy: 'episode', desc: false, override })
  assert.deepEqual(resolvePodcastEpisodeSort(settings, 'li_2', 'episodic'), { orderBy: 'publishedAt', desc: true, override: null })
})

test('a local podcast shares the override key of its server item', () => {
  assert.equal(podcastSortOverrideKey({ id: 'local_1', libraryItemId: 'li_1' }, true), 'li_1')
  assert.equal(podcastSortOverrideKey({ id: 'local_1' }, true), 'local_1')
  assert.equal(podcastSortOverrideKey({ id: 'li_1', libraryItemId: 'ignored' }, false), 'li_1')
  assert.equal(podcastSortOverrideKey(null, false), null)
})
