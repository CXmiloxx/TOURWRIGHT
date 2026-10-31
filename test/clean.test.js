import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { clean, human, sizeOf } from '../src/clean.js'

test('sizes are summed through folders and written for people', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-clean-'))
  try {
    mkdirSync(join(dir, 'a', 'b'), { recursive: true })
    writeFileSync(join(dir, 'a', 'x'), Buffer.alloc(1500))
    writeFileSync(join(dir, 'a', 'b', 'y'), Buffer.alloc(500))
    assert.equal(sizeOf(dir), 2000)
    assert.equal(sizeOf(join(dir, 'missing')), 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(human(2_500_000_000), '2.5 GB')
  assert.equal(human(919_000_000), '919 MB')
})

test('clean removes downloads and half-written files, and keeps the voice cache unless asked', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tw-clean-'))
  const config = { home, cacheDir: join(home, 'cache'), dataDir: join(home, 'data'), tts: { piper: { voicesDir: join(home, 'voices') } }, queue: { retentionHours: 72 } }
  try {
    mkdirSync(join(home, 'cache', 'uv'), { recursive: true })
    mkdirSync(join(home, 'cache', 'voice', 'sentences'), { recursive: true })
    writeFileSync(join(home, 'cache', 'uv', 'wheel'), Buffer.alloc(1000))
    writeFileSync(join(home, 'cache', 'voice', 'sentences', 'a.wav'), Buffer.alloc(300))
    writeFileSync(join(home, 'cache', 'voice', 'sentences', 'a.wav.123.abc.tmp.wav'), Buffer.alloc(200))
    const removed = await clean(config)
    assert.deepEqual(removed, [{ name: 'download cache', bytes: 1000 }, { name: 'temporary files', bytes: 200 }])
    assert.equal(sizeOf(join(home, 'cache', 'voice')), 300)
    assert.deepEqual(await clean(config, { voiceCache: true }), [{ name: 'voice cache', bytes: 300 }])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
