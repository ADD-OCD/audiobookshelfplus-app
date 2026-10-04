import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Load the Nuxt ES module without changing this project's CommonJS package type.
const source = await readFile(new URL('../utils/playbackRate.js', import.meta.url), 'utf8')
const { normalizePlaybackRate, formatPlaybackRate } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
// Source files are read LF-normalized, so a Windows (core.autocrlf) checkout and CI see the same text
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))

// The speed a 32-bit native float reports for each value the app offers, widened to a double (as the bridge delivers it)
const asNativeFloat = (rate) => Math.fround(rate)

test('native float speeds normalize to the speed the user chose', () => {
  assert.equal(asNativeFloat(1.4), 1.399999976158142)
  for (const rate of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.7, 1.75, 1.8, 1.9, 2, 2.5, 3, 3.3, 5.7, 9.9, 10]) {
    assert.equal(normalizePlaybackRate(asNativeFloat(rate)), rate, String(rate))
    assert.equal(normalizePlaybackRate(rate), rate, String(rate))
    assert.equal(normalizePlaybackRate(String(asNativeFloat(rate))), rate, `string ${rate}`)
  }
})

test('invalid speeds are rejected instead of shown', () => {
  for (const value of [undefined, null, '', 'abc', NaN, Infinity, 0, -1]) assert.equal(normalizePlaybackRate(value), null, String(value))
})

test('speed labels are concise for every offered speed', () => {
  const cases = { 0.5: '0.5x', 1: '1x', 1.2: '1.2x', 1.25: '1.25x', 1.4: '1.4x', 1.5: '1.5x', 1.75: '1.75x', 2: '2x', 3: '3x', 9.9: '9.9x' }
  for (const [rate, label] of Object.entries(cases)) {
    assert.equal(formatPlaybackRate(asNativeFloat(Number(rate))), label, rate)
    assert.ok(label.length <= 5, label)
  }
  assert.equal(formatPlaybackRate(undefined), '1x')
})

test('the player normalizes every native speed and shows the concise label', async () => {
  const player = await read('../components/app/AudioPlayer.vue')
  const template = player.slice(0, player.indexOf('</template>'))
  // The label, never the raw number
  assert.match(template, /class="speed-readout [^"]*"[^>]*>\{\{ playbackRateLabel \}\}<\/span>/)
  assert.doesNotMatch(template, /\{\{ currentPlaybackRate \}\}x/)
  assert.match(player, /playbackRateLabel\(\) \{\s*return formatPlaybackRate\(this\.currentPlaybackRate\)/)
  // Both native entry points: the speed-changed event and the reattach after the UI restarts (e.g. a font-size change
  // recreates the activity while the native player keeps running)
  const speedChanged = player.match(/onPlaybackSpeedChanged\(data\) \{[\s\S]*?\n {4}\}/)[0]
  assert.match(speedChanged, /normalizePlaybackRate\(data\.value\)/)
  assert.doesNotMatch(speedChanged, /Number\(data\.value\)/)
  const reattach = player.match(/async reattachNativePlayback\(\) \{[\s\S]*?\n {4}\}/)[0]
  assert.match(reattach, /normalizePlaybackRate\(state\.playbackRate\)/)
  assert.doesNotMatch(reattach, /Number\(state\.playbackRate\)/)
})
