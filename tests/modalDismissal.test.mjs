import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// The shared modal (components/modals/Modal.vue) only closes when the tap lands on its own .modal-bg backdrop. Its content
// box is the modal's full width by the full screen height, so the space directly above and below a centered panel is inside
// the content, not the backdrop. Each modal fills that box with a full-size column wrapper that must close the modal itself,
// while the visible panel stops its own clicks; otherwise taps above and below the panel do nothing (the Playback Speed
// defect found on the S26: it closed left and right of the panel only).
const COLUMN = 'w-full h-full overflow-hidden absolute top-0 left-0 flex items-center justify-center'
const dir = new URL('../components/modals/', import.meta.url)
const read = (name) => readFile(new URL(name, dir), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))

// The opening tag that carries the column class, and the opening tag of the element after it (the visible panel)
const tagsAfter = (source, index) => {
  const open = source.lastIndexOf('<', index)
  const end = source.indexOf('>', index)
  const next = source.indexOf('<', end)
  return [source.slice(open, end + 1), source.slice(next, source.indexOf('>', next) + 1)]
}

const columnModals = async () => {
  const found = []
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.vue'))) {
    const source = await read(name)
    const index = source.indexOf(COLUMN)
    if (index !== -1) found.push({ name, source, tags: tagsAfter(source, index) })
  }
  return found
}

test('every modal column wrapper closes the modal and its panel keeps its own taps', async () => {
  const modals = await columnModals()
  for (const name of ['PlaybackSpeedModal.vue', 'SleepTimerModal.vue', 'ChaptersModal.vue', 'BookmarksModal.vue', 'QueueModal.vue']) {
    assert.ok(
      modals.some((m) => m.name === name),
      `${name} uses the column wrapper`
    )
  }
  for (const { name, tags } of modals) {
    const [column, panel] = tags
    assert.match(column, /@click(\.stop)?="\s*(show = false|dismiss)/, `${name}: a tap above or below the panel closes the modal`)
    if (name === 'FullscreenCover.vue') continue // the cover itself is not interactive and closes too
    assert.match(panel, /@click\.stop/, `${name}: taps inside the visible panel do not close it`)
  }
})

test('Playback Speed closes from the empty column and keeps a stepped speed like a backdrop tap', async () => {
  const source = await read('PlaybackSpeedModal.vue')
  const [column, panel] = tagsAfter(source, source.indexOf(COLUMN))
  assert.match(column, /@click="dismiss"/)
  assert.match(panel, /class="playback-option-panel[^"]*"[^>]*@click\.stop/)
  // The backdrop path reports the close through modalInput, which saves a speed chosen with the -/+ stepper
  assert.match(source, /<modals-modal v-model="show" @input="modalInput"/)
  const dismiss = source.match(/\n {4}dismiss\(\) \{\n([\s\S]*?)\n {4}\},/)
  assert.ok(dismiss, 'dismiss method')
  assert.deepEqual(
    dismiss[1].split('\n').map((l) => l.trim()),
    ['this.modalInput(false)', 'this.show = false']
  )
  // The speed rows and the stepper stay inside the panel
  assert.match(source, /role="option" @click="clickedOption\(rate\)"/)
  assert.match(source, /@click="decrement"/)
  assert.match(source, /@click="increment"/)
})
