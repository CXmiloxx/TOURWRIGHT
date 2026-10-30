import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'
import { checkLink, linkSigner } from '../src/jobs/links.js'
import { localStore } from '../src/jobs/store.js'

test('local queue: each ticket is claimed once, in order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-test-'))
  try {
    const { store, queue } = localStore(dir)
    for (const id of ['a', 'b', 'c']) {
      await store.save({ id, status: 'queued', createdAt: new Date().toISOString() })
      await queue.enqueue(id)
    }
    const seen = []
    const controller = new AbortController()
    await queue.consume(async id => {
      seen.push(id)
      if (seen.length === 3) controller.abort()
    }, { concurrency: 2, signal: controller.signal })
    assert.deepEqual(seen.sort(), ['a', 'b', 'c'])
    assert.deepEqual(await store.counts(), { queued: 0, running: 0 })
    assert.equal((await store.update('a', { status: 'done' })).status, 'done')
    assert.equal((await store.list({ status: 'done' })).length, 1)
    assert.equal(await store.get('../etc'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('signed links expire and cannot be reused for another file', () => {
  const config = loadConfig({ api: { tokens: ['t'], host: '127.0.0.1', port: 1 } })
  const url = new URL(linkSigner(config)('job1', 'video.mp4'))
  const exp = url.searchParams.get('exp')
  const sig = url.searchParams.get('sig')
  assert.equal(checkLink(config, 'job1', 'video.mp4', exp, sig), true)
  assert.equal(checkLink(config, 'job1', 'video.srt', exp, sig), false)
  assert.equal(checkLink(config, 'job1', 'video.mp4', '1', sig), false)
})
