import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frameLayout } from '#render/page/frame.js'
import { frameFilter } from '#video/frame-filter.js'
import { validateScript } from '#script/schema.js'

test('the studio frame keeps the recording whole, centered and even-sized', () => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [1080, 1920], [1080, 1080]]) {
    const l = frameLayout(width, height)
    for (const n of [l.x, l.y, l.w, l.h]) assert.equal(n % 2, 0, `${width}x${height}`)
    assert.ok(Math.abs(l.w / l.h - width / height) < 0.01, 'same shape as the recording')
    assert.ok(l.y - l.bar >= 0 && l.y + l.h <= height, 'the window and its bar fit')
    assert.ok(l.x > 0 && l.x + l.w <= width)
  }
})

test('the frame filter puts the cut recording into the window', () => {
  const f = frameFilter({ x: 90, y: 66, width: 1100, height: 620 }, 1, 2)
  assert.match(f, /^\[cut\]scale=1100:620/)
  assert.match(f, /\[2:v\]format=gray/)
  assert.match(f, /\[1:v\]format=yuv420p/)
  assert.match(f, /overlay=90:66.*\[vout\]$/)
})

test('theme.frame accepts window and none only', () => {
  const base = { title: 't', steps: [{ goto: '/' }] }
  assert.equal(validateScript({ ...base, theme: { frame: 'window' } }).ok, true)
  assert.equal(validateScript({ ...base, theme: { frame: 'polaroid' } }).ok, false)
})
