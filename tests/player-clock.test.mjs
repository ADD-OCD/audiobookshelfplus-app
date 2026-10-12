// "Update once a minute" (player menu): the player keeps polling the native position every second, but draws H:MM times,
// stepped bars and a sleep timer in minutes, and writes to the page only when one of those coarse values changes (each
// write is a visible refresh on e-paper). Off by default, where every second is drawn exactly as before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))
const clock = await import(`data:text/javascript;base64,${Buffer.from(await read('../utils/playerClock.js')).toString('base64')}`)
const { coarseTime, coarseClock, sleepRemainingLabel, createPainter } = clock

test('coarseTime: whole minutes of listening time, so the step follows the playback rate', () => {
  assert.equal(coarseTime(0), 0)
  assert.equal(coarseTime(59.9), 0)
  assert.equal(coarseTime(60), 60)
  assert.equal(coarseTime(3725.4), 3720)
  assert.equal(coarseTime(179, 1.5), 90)
  assert.equal(coarseTime(180, 1.5), 180)
  assert.equal(coarseTime(250, 2), 240)
  for (const bad of [NaN, -5, Infinity]) assert.equal(coarseTime(bad), 0, String(bad))
  assert.equal(coarseTime(125, 0), 120, 'a zero rate counts as 1')
})

test('coarseClock: H:MM, elapsed rounds down, remaining rounds up', () => {
  assert.equal(coarseClock(0), '0:00')
  assert.equal(coarseClock(59), '0:00')
  assert.equal(coarseClock(60), '0:01')
  assert.equal(coarseClock(3725), '1:02')
  assert.equal(coarseClock(36000), '10:00')
  assert.equal(coarseClock(3725, true), '1:03')
  assert.equal(coarseClock(60, true), '0:01')
  assert.equal(coarseClock(1, true), '0:01')
  assert.equal(coarseClock(0, true), '0:00')
  assert.equal(coarseClock(5400.0000001, true), '1:30', 'float noise from rate-scaled steps')
  assert.equal(coarseClock(5399.9999999), '1:30', 'float noise from rate-scaled steps')
  assert.equal(coarseClock(NaN), '0:00')
  assert.equal(coarseClock(-10), '0:00')
})

test('sleepRemainingLabel: minutes only when coarse; the previous seconds below 92 s otherwise', () => {
  assert.equal(sleepRemainingLabel(0, true), '0s')
  assert.equal(sleepRemainingLabel(45, true), '1m')
  assert.equal(sleepRemainingLabel(61, true), '2m')
  assert.equal(sleepRemainingLabel(45, false), '45s')
  assert.equal(sleepRemainingLabel(91, false), '91s')
  assert.equal(sleepRemainingLabel(120, false), '2m')
})

test('painter: writes a changed value, skips an unchanged one, always writes when asked, and is per element', () => {
  const paint = createPainter()
  const writes = []
  const write = (el, v) => writes.push([el.id, v])
  const a = { id: 'a' }
  const b = { id: 'b' }
  assert.equal(paint(a, 'width', '10%', write), true)
  assert.equal(paint(a, 'width', '10%', write), false)
  assert.equal(paint(a, 'left', '10%', write), true, 'keys are separate')
  assert.equal(paint(b, 'width', '10%', write), true, 'a new element is always painted')
  assert.equal(paint(a, 'width', '10%', write, true), true, 'always')
  assert.equal(paint(a, 'width', '11%', write), true)
  assert.equal(paint(null, 'width', '12%', write), false)
  assert.deepEqual(writes, [
    ['a', '10%'],
    ['a', '10%'],
    ['b', '10%'],
    ['a', '10%'],
    ['a', '11%']
  ])
})

// AudioPlayer's own computed properties and methods, run against a minimal component context with counting elements
async function loadPlayer() {
  const source = await read('../components/app/AudioPlayer.vue')
  const script = source
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.component =')
  const sandbox = { ...clock, AbsAudioPlayer: { seek: () => {} }, Capacitor: {}, Dialog: {}, jumpLabelMixin: {}, console: { log() {}, error() {}, warn() {} } }
  vm.runInNewContext(script, sandbox)
  return sandbox.component
}

const countingElement = (counts, name) => {
  const style = {}
  for (const prop of ['width', 'left']) {
    let value = ''
    Object.defineProperty(style, prop, {
      get: () => value,
      set: (v) => {
        value = v
        counts[name] = (counts[name] || 0) + 1
      }
    })
  }
  let text = '0:00'
  return {
    style,
    clientWidth: 360,
    classList: { add() {}, remove() {} },
    get innerText() {
      return text
    },
    set innerText(v) {
      text = v
      counts[name] = (counts[name] || 0) + 1
    }
  }
}

const secondsToTimestamp = (seconds) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function makePlayer(component, { everyMinute, rate = 1 }) {
  const counts = {}
  const ctx = { ...component.data.call({}) }
  ctx.playerSettings.updateEveryMinute = everyMinute
  ctx.playerSettings.useChapterTrack = false
  ctx.totalDuration = 36000
  ctx.currentPlaybackRate = rate
  ctx.sleepTimeRemaining = 0
  ctx.$emit = () => {}
  ctx.$secondsToTimestamp = secondsToTimestamp
  ctx.$refs = {}
  for (const ref of ['currentTimestamp', 'playedTrack', 'bufferedTrack', 'trackCursor', 'trackCursorHit', 'track']) ctx.$refs[ref] = countingElement(counts, ref)
  for (const [name, fn] of Object.entries(component.computed)) Object.defineProperty(ctx, name, { get: () => fn.call(ctx) })
  for (const [name, fn] of Object.entries(component.methods)) ctx[name] = fn.bind(ctx)
  component.created.call(ctx)
  return { ctx, counts }
}

// One poll per second, as startPlayInterval does, collecting the template readouts too
function play(ctx, { from, seconds, rate = 1 }) {
  const remaining = []
  for (let s = 0; s < seconds; s++) {
    ctx.currentTime = from + s * rate
    ctx.bufferedTime = ctx.currentTime + 30
    ctx.timeupdate()
    remaining.push(ctx.timeRemainingPretty)
  }
  return remaining
}
const changes = (values) => values.filter((v, i) => i === 0 || v !== values[i - 1]).length

test('AudioPlayer, off (default): every second is drawn as before', async () => {
  const component = await loadPlayer()
  assert.equal(component.data.call({}).playerSettings.updateEveryMinute, false)
  const { ctx, counts } = makePlayer(component, { everyMinute: false })
  play(ctx, { from: 1000, seconds: 300 })
  for (const ref of ['currentTimestamp', 'playedTrack', 'bufferedTrack', 'trackCursor', 'trackCursorHit']) assert.equal(counts[ref], 300, ref)
  assert.equal(ctx.$refs.currentTimestamp.innerText, '21:39')
})

test('AudioPlayer, once a minute: the page is written only when the coarse value changes', async () => {
  const component = await loadPlayer()
  const { ctx, counts } = makePlayer(component, { everyMinute: true })
  // 16:40 to 21:39: the minute turns at 17, 18, 19, 20 and 21, plus the first paint
  const remaining = play(ctx, { from: 1000, seconds: 300 })
  for (const ref of ['currentTimestamp', 'playedTrack', 'bufferedTrack']) assert.equal(counts[ref], 6, ref)
  // The thumb is placed in whole pixels: a minute of a 10-hour book is 0.6px of this track, so it moves even less often
  for (const ref of ['trackCursor', 'trackCursorHit']) assert.ok(counts[ref] >= 1 && counts[ref] <= 6, `${ref}: ${counts[ref]}`)
  assert.equal(ctx.$refs.currentTimestamp.innerText, '0:21')
  assert.equal(ctx.$refs.playedTrack.style.width, `${(1260 / 36000) * 100}%`)
  assert.equal(changes(remaining), 6, 'the remaining time changes at the same moments')
  assert.equal(remaining.at(-1), '-9:39')
})

test('AudioPlayer, once a minute at 2x: still once per minute of listening, not per minute of book time', async () => {
  const component = await loadPlayer()
  const { ctx, counts } = makePlayer(component, { everyMinute: true, rate: 2 })
  play(ctx, { from: 1200, seconds: 300, rate: 2 })
  assert.equal(counts.currentTimestamp, 5)
  assert.equal(counts.playedTrack, 5)
})

test('AudioPlayer, once a minute: a seek and a drag are drawn at once and exactly', async () => {
  const component = await loadPlayer()
  const { ctx, counts } = makePlayer(component, { everyMinute: true })
  play(ctx, { from: 1000, seconds: 5 })
  const before = counts.playedTrack
  ctx.seek(1010) // same minute: still drawn immediately
  assert.equal(counts.playedTrack, before + 1)
  assert.equal(ctx.$refs.playedTrack.style.width, `${(1010 / 36000) * 100}%`)
  ctx.seekLoading = false

  ctx.isDraggingCursor = true
  ctx.draggingCurrentTime = 1012.5
  ctx.updateTimestamp()
  ctx.updateTrack()
  assert.equal(ctx.$refs.currentTimestamp.innerText, '16:52')
  assert.equal(ctx.$refs.playedTrack.style.width, `${(1012.5 / 36000) * 100}%`)
})

test('AudioPlayer, once a minute: the sleep timer readout is in minutes', async () => {
  const component = await loadPlayer()
  const { ctx } = makePlayer(component, { everyMinute: true })
  ctx.sleepTimeRemaining = 75
  assert.equal(ctx.sleepTimeRemainingPretty, '2m')
  ctx.playerSettings.updateEveryMinute = false
  assert.equal(ctx.sleepTimeRemainingPretty, '75s')
})

test('AudioPlayer: the native position is still polled every second, and the setting is saved and restored', async () => {
  const source = await read('../components/app/AudioPlayer.vue')
  assert.match(source, /this\.playInterval = setInterval\(async \(\) => \{\s*var data = await AbsAudioPlayer\.getCurrentTime\(\)[\s\S]*?\}, 1000\)/)
  assert.match(source, /this\.playerSettings\.updateEveryMinute = !!savedPlayerSettings\.updateEveryMinute/)
  assert.match(source, /value: 'update_every_minute'/)
  // No per-second write to the seek row bypasses the painter
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  assert.doesNotMatch(script, /\$refs\.(playedTrack|bufferedTrack|trackCursor|trackCursorHit|totalPlayedTrack|totalBufferedTrack)\.style\.(width|left) =/)
  assert.doesNotMatch(script, /ts\.innerText =/)
})
