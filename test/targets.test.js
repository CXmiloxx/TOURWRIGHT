import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { acquireLock } from '../src/lock.js'
test('the browser lock lets one holder in at a time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-lock-'))
  try {
    const file = join(dir, 'browser.lock')
    const order = []
    const first = await acquireLock(file)
    order.push('first in')
    const second = acquireLock(file).then(release => {
      order.push('second in')
      return release
    })
    await new Promise(r => setTimeout(r, 300))
    assert.deepEqual(order, ['first in'])
    first()
    const release = await second
    assert.deepEqual(order, ['first in', 'second in'])
    release()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

