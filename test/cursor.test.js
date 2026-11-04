import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickCapture } from '../src/render/capture.js'
import { createCursor, MOVE_MAX } from '../src/render/cursor.js'

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
