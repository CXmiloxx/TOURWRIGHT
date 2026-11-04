import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickCapture } from '../src/render/capture.js'

test('auto films a vertical video as a screencast even with Xvfb (the virtual display draws at 1x)', () => {
  const config = /** @type {any} */ ({ xvfb: '/usr/bin/Xvfb' })
  assert.equal(pickCapture('auto', config), 'screen')
  assert.equal(pickCapture('auto', config, { portrait: true }), 'screencast')
  assert.equal(pickCapture('screen', config, { portrait: true }), 'screen')
  assert.equal(pickCapture(undefined, /** @type {any} */ ({ xvfb: null })), 'screencast')
})
