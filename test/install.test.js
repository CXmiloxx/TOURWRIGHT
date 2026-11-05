import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { download, SHA256 } from '#install/index.js'

const BODY = Buffer.from('a release archive')
const sha = createHash('sha256').update(BODY).digest('hex')

const serve = async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(BODY)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  return { url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/file.tar.gz`, close: () => server.close() }
}

test('download keeps a file with the expected sha256 and refuses one that changed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-download-'))
  const { url, close } = await serve()
  try {
    await download(url, join(dir, 'good'), 1, sha)
    assert.deepEqual(readFileSync(join(dir, 'good')), BODY)

    await assert.rejects(download(url, join(dir, 'bad'), 3, '0'.repeat(64)), /checksum mismatch/)
    assert.equal(existsSync(join(dir, 'bad')), false)
    assert.equal(existsSync(join(dir, 'bad.part')), false)
  } finally {
    close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every pinned archive has a well-formed sha256', () => {
  assert.ok(Object.keys(SHA256).length >= 10)
  for (const [url, hash] of Object.entries(SHA256)) assert.match(hash, /^[0-9a-f]{64}$/, url)
})
