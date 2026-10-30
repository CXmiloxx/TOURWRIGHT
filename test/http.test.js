import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { loadConfig } from '../src/config.js'
import { createApp } from '../src/server/http.js'

let dir
let base
let server

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tourwright-http-'))
  const defaults = loadConfig()
  const config = loadConfig({
    dataDir: dir,
    tmpDir: dir,
    queue: { ...defaults.queue, driver: 'local' },
    storage: { ...defaults.storage, driver: 'local' },
    api: { ...defaults.api, tokens: ['token-a', 'token-b'], maxBodyMb: 0.01 },
    plugins: [],
  })
  ;({ server } = await createApp(config))
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`
})

after(() => {
  server?.close()
  rmSync(dir, { recursive: true, force: true })
})

/** @param {string} method @param {string} path @param {{ token?: string, body?: any }} [options] */
const call = async (method, path, { token = undefined, body = undefined } = {}) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const script = { title: 'T', vars: { page: '/' }, baseUrl: 'https://example.com', steps: [{ goto: '{{page}}' }] }

test('health needs no token; everything else does, with a stable error code', async () => {
  assert.equal((await call('GET', '/health')).status, 200)
  const r = await call('GET', '/v1/jobs')
  assert.equal(r.status, 401)
  assert.equal(r.body.code, 'unauthorized')
  assert.equal((await call('GET', '/v1/jobs', { token: 'wrong' })).status, 401)
  const missing = await call('GET', '/v1/nothing', { token: 'token-a' })
  assert.deepEqual([missing.status, missing.body.code], [404, 'not_found'])
})

test('validate expands variables and lists errors', async () => {
  assert.deepEqual((await call('POST', '/v1/validate', { token: 'token-a', body: { script } })).body, { ok: true })
  const bad = await call('POST', '/v1/validate', { token: 'token-a', body: { script: { steps: [{ say: '{{nope}}' }] } } })
  assert.equal(bad.body.ok, false)
  assert.match(bad.body.errors[0], /\{\{nope\}\} is not defined/)
  const js = await call('POST', '/v1/validate', { token: 'token-a', body: '{"script": ' })
  assert.deepEqual([js.status, js.body.code], [400, 'invalid'])
})

test('a job belongs to the token that created it', async () => {
  const created = await call('POST', '/v1/jobs', { token: 'token-a', body: { script, vars: { page: '/about' } } })
  assert.equal(created.status, 202)
  const { id } = created.body
  assert.equal((await call('GET', `/v1/jobs/${id}`, { token: 'token-a' })).body.status, 'queued')
  assert.equal((await call('GET', `/v1/jobs/${id}`, { token: 'token-b' })).status, 404)
  assert.ok((await call('GET', '/v1/jobs', { token: 'token-a' })).body.jobs.some(j => j.id === id))
  assert.ok(!(await call('GET', '/v1/jobs', { token: 'token-b' })).body.jobs.some(j => j.id === id))
  const busy = await call('DELETE', `/v1/jobs/${id}`, { token: 'token-a' })
  assert.deepEqual([busy.status, busy.body.code], [409, 'conflict'])
})

test('bad requests are refused before anything is queued', async () => {
  const big = await call('POST', '/v1/jobs', { token: 'token-a', body: { script, pad: 'x'.repeat(20_000) } })
  assert.deepEqual([big.status, big.body.code], [413, 'too_large'])
  assert.equal((await call('POST', '/v1/jobs', { token: 'token-a', body: { script, vars: [1] } })).status, 400)
  assert.equal((await call('POST', '/v1/jobs', { token: 'token-a', body: { script, assets: { '../x': 'AA==' } } })).status, 400)
  const link = await call('GET', '/v1/jobs/x/files/video.mp4?exp=1&sig=bad')
  assert.deepEqual([link.status, link.body.code], [403, 'forbidden'])
})
