import assert from 'node:assert/strict'
import { basename, join, resolve } from 'node:path'
import { test } from 'node:test'
import { safePath } from '../src/render/theme.js'
import { concatEntry, findBinary, isInside, which } from '../src/util.js'

test('isInside works with the platform separator and refuses look-alike folders', () => {
  const base = resolve('jobs', 'a')
  assert.equal(isInside(base, base), true)
  assert.equal(isInside(join(base, 'x', 'y.png'), base), true)
  assert.equal(isInside(join(base, '..', 'b', 'y.png'), base), false)
  assert.equal(isInside(`${base}-other`, base), false)
  // A file whose name starts with two dots is still inside
  assert.equal(isInside(join(base, '..hidden'), base), true)
  assert.throws(() => safePath('../secret.png', base, true), /outside the job folder/)
  assert.equal(safePath('img/logo.png', base, true), join(base, 'img', 'logo.png'))
})

test('concat list lines survive quotes in the path', () => {
  assert.equal(concatEntry('/tmp/a b/it\'s.wav'), "file '/tmp/a b/it'\\''s.wav'")
})

test('programs are found in PATH and by full path', () => {
  const node = which(basename(process.execPath, '.exe'))
  assert.ok(node, 'node should be in PATH')
  assert.equal(findBinary(undefined, process.execPath), process.execPath)
  assert.equal(findBinary(join(process.cwd(), 'no-such-program')), null)
})
