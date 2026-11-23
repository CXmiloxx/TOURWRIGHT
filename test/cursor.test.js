import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drawnAt, frameWriter, pickCapture } from '#render/browser/capture.js'
import { createCursor, MOVE_MAX } from '#render/page/cursor.js'

test('auto films a vertical video as a screencast even with Xvfb (the virtual display draws at 1x)', () => {
  const config = /** @type {any} */ ({ xvfb: '/usr/bin/Xvfb' })
  assert.equal(pickCapture('auto', config), 'screen')
  assert.equal(pickCapture('auto', config, { portrait: true }), 'screencast')
  assert.equal(pickCapture('screen', config, { portrait: true }), 'screen')
  assert.equal(pickCapture(undefined, /** @type {any} */ ({ xvfb: null })), 'screencast')
})

test('the cursor glide takes a set time on a slow page: fewer moves, not more seconds', async () => {
  const moves = []
  // Every move takes 150 ms, like a heavy page on a server without GPU
  const page = /** @type {any} */ ({
    mouse: { move: async (x, y) => { moves.push([x, y]); await new Promise(r => setTimeout(r, 150)) } },
    waitForTimeout: ms => new Promise(r => setTimeout(r, ms)),
  })
  const cursor = createCursor(page, { width: 540, height: 960, dryRun: false })
  const start = Date.now()
  await cursor.moveTo(500, 900)
  const took = Date.now() - start
  assert.ok(took < MOVE_MAX + 400, `took ${took} ms`)
  assert.deepEqual(moves.at(-1), [500, 900])
  assert.deepEqual(cursor.position, { x: 500, y: 900 })
})

test('a screencast frame is placed where Chromium drew it, not when it arrived', () => {
  const now = 1_700_000_000
  assert.equal(drawnAt({ timestamp: now - 0.4 }, now), now - 0.4)
  // A timestamp from the future, from long ago, or missing: the arrival time is used
  assert.equal(drawnAt({ timestamp: now + 1 }, now), now)
  assert.equal(drawnAt({ timestamp: now - 10 }, now), now)
  assert.equal(drawnAt(undefined, now), now)
})

test('a late frame gets its drawn tick, and a stale one cannot put an older picture back', () => {
  const out = []
  const writer = frameWriter({ fps: 10, write: data => out.push(data.toString()) })
  // The recorder writes each tick 0.8 s after it: a frame that arrives late still finds its own tick
  writer.add(-1, Buffer.from('a'))
  writer.until(0.2) // at 1.0 s: ticks 0.0 and 0.1
  writer.add(0.25, Buffer.from('b')) // drawn at 0.25, delivered at 0.9 s (0.65 s late)
  writer.until(0.4) // at 1.2 s: ticks 0.2 (still 'a') and 0.3 ('b', where it was drawn)
  writer.add(0.2, Buffer.from('old')) // delivered out of order
  writer.until(0.5) // tick 0.4: the newer picture stays on screen
  assert.deepEqual(out, ['a', 'a', 'a', 'b', 'b'])
})

test('ticks before the first frame are filled by it, so the video keeps the clock\'s length', () => {
  const out = []
  const writer = frameWriter({ fps: 10, write: data => out.push(data.toString()) })
  writer.until(0.3) // no frame yet: nothing written, nothing lost
  assert.deepEqual(out, [])
  writer.add(0.25, Buffer.from('x'))
  writer.until(0.3)
  assert.deepEqual(out, ['x', 'x', 'x'])
})
