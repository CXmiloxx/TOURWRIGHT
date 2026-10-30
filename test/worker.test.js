import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'
import { createBlobs } from '../src/jobs/blobs.js'
import { localStore } from '../src/jobs/store.js'
import { makeHandler } from '../src/worker.js'

// A worker with a fake render: each call takes the next answer from `answers`.
const setup = answers => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-worker-'))
  const config = loadConfig({ dataDir: dir, tmpDir: dir, queue: { driver: 'local', attempts: 2 } })
  const backend = localStore(join(dir, 'queue'))
  const blobs = createBlobs(config)
  const calls = []
  const run = async (input, output) => {
    calls.push(input)
    const answer = answers.shift()
    if (answer.result) writeFileSync(join(output, 'video.mp4'), 'mp4')
    return answer
  }
  const handle = makeHandler({ backend, blobs, config, signLink: () => null, run })
  const add = async id => {
    await backend.store.save({ id, status: 'queued', kind: 'browser', inputs: [], options: {}, createdAt: new Date().toISOString() })
    return id
  }
  return { dir, backend, handle, add, calls, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('worker: a failed render is queued again until the attempts run out', async () => {
  const w = setup([{ error: 'browser crashed' }, { error: 'browser crashed again' }])
  try {
    const id = await w.add('j1')
    await w.handle(id)
    let job = await w.backend.store.get(id)
    assert.equal(job.status, 'queued')
    assert.equal(job.attempts, 1)
    assert.equal(job.progress.stage, 'retrying')
    await w.handle(id)
    job = await w.backend.store.get(id)
    assert.equal(job.status, 'failed')
    assert.equal(job.attempts, 2)
    assert.equal(job.error, 'browser crashed again')
    assert.equal(w.calls.length, 2)
  } finally {
    w.done()
  }
})

test('worker: an error the user must fix is never retried', async () => {
  const w = setup([{ error: 'no element matches "Save"', user: true }])
  try {
    const id = await w.add('j2')
    await w.handle(id)
    const job = await w.backend.store.get(id)
    assert.equal(job.status, 'failed')
    assert.equal(job.attempts, 1)
    assert.equal(w.calls.length, 1)
  } finally {
    w.done()
  }
})

test('worker: a retry that succeeds stores the outputs and clears the error', async () => {
  const w = setup([{ error: 'timeout' }, { result: { duration: 3, paths: {} } }])
  try {
    const id = await w.add('j3')
    await w.handle(id)
    await w.handle(id)
    const job = await w.backend.store.get(id)
    assert.equal(job.status, 'done')
    assert.equal(job.error, undefined)
    assert.deepEqual(job.outputs, [`jobs/${id}/out/video.mp4`])
    assert.deepEqual(job.result, { duration: 3 })
  } finally {
    w.done()
  }
})

test('worker: the attempt number from the queue wins over the stored count', async () => {
  // BullMQ counts attempts itself; on its last attempt the job fails even if the record says otherwise.
  const w = setup([{ error: 'crash' }])
  try {
    const id = await w.add('j4')
    await w.handle(id, { attempt: 2 })
    assert.equal((await w.backend.store.get(id)).status, 'failed')
  } finally {
    w.done()
  }
})
