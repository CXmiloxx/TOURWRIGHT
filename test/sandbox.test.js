// Bugs found in a code review, one test each. The browser tests are skipped without one.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig } from '#core/config.js'
import { launchChromium, findChromium } from '#render/browser/chromium.js'
import { BLOCKED_HEADER, startGuardProxy } from '#render/browser/guard-proxy.js'
import { createGuard, isPrivateAddress } from '#render/browser/network.js'
import { runSteps, setStepTimeout } from '#render/steps/index.js'
import { createJob } from '#server/jobs/service.js'
import { postWebhook } from '#server/worker.js'
import { ffmpegColor } from '#video/ffmpeg.js'
import { commandLine } from '#voice/engines.js'

const config = loadConfig()
const missing = (await findChromium(config)).source === 'missing' && 'no browser'

/** A server on 127.0.0.1: /hop redirects to the same server under the name `localhost` */
const app = async () => {
  const hits = []
  const server = createServer((req, res) => {
    hits.push(`${req.headers.host}${req.url}`)
    if (req.url === '/hop') {
      res.writeHead(302, { location: `http://localhost:${port()}/secret` })
      return res.end()
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<p>${req.url}</p>`)
  })
  server.on('upgrade', (req, socket) => {
    hits.push(`ws ${req.headers.host}${req.url}`)
    socket.destroy()
  })
  const port = () => /** @type {import('node:net').AddressInfo} */ (server.address()).port
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(undefined)))
  return { hits, port: port(), close: () => server.close() }
}

test('every way of writing a private address is private', () => {
  for (const ip of ['::ffff:7f00:1', '::ffff:127.0.0.1', '::7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', '::ffff:a9fe:a9fe', 'fe90::1', 'febf::1', 'fec0::1', 'ff02::1', '::', '0:0:0:0:0:0:0:1', 'fe80::1%eth0', '224.0.0.1', '255.255.255.255']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
  for (const ip of ['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::', '2001:4860:4860::8888', 'fbff::1']) assert.equal(isPrivateAddress(ip), false, ip)
})

test('the guard turns down [::ffff:127.0.0.1] and pins the address it checked', async () => {
  const guard = createGuard({ allowedHosts: [], blockPrivate: true })
  assert.equal(guard.strict, true)
  assert.equal(await guard('http://[::ffff:127.0.0.1]/'), false)
  assert.equal(await guard('http://[::ffff:7f00:1]:8080/'), false)
  assert.equal(await guard.addressOf('93.184.215.14'), '93.184.215.14')
  assert.equal(await guard.addressOf('localhost'), null)
  const open = createGuard({ allowedHosts: [], blockPrivate: false })
  assert.equal(open.strict, false)
  assert.equal(await open.addressOf('localhost'), 'localhost')
})

test('the sandbox proxy lets through what the guard allows and refuses the rest, tunnels included', async () => {
  const site = await app()
  const proxy = await startGuardProxy(createGuard({ allowedHosts: ['127.0.0.1'] }))
  const port = Number(new URL(proxy.server).port)
  const get = target => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: target, headers: { host: new URL(target).host } }, res => {
      res.resume()
      resolve(res)
    }).on('error', reject).end()
  })
  const tunnel = to => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, method: 'CONNECT', path: to })
      .on('connect', (res, socket) => {
        socket.destroy()
        resolve(res.statusCode)
      })
      .on('error', reject)
      .end()
  })
  try {
    assert.equal((await get(`http://127.0.0.1:${site.port}/ok`)).statusCode, 200)
    const refused = await get(`http://localhost:${site.port}/secret`)
    assert.equal(refused.statusCode, 403)
    assert.equal(refused.headers[BLOCKED_HEADER], '1')
    assert.equal(await tunnel(`localhost:${site.port}`), 403)
    assert.equal(await tunnel(`127.0.0.1:${site.port}`), 200)
    assert.deepEqual(site.hits, [`127.0.0.1:${site.port}/ok`])
  } finally {
    proxy.close()
    site.close()
  }
})

test('in the browser, a redirect or a WebSocket to a host the guard refuses never reaches it', { skip: missing }, async () => {
  const site = await app()
  const proxy = await startGuardProxy(createGuard({ allowedHosts: ['127.0.0.1'] }))
  const browser = await launchChromium(config, { headless: true })
  try {
    const context = await browser.newContext({ proxy: { server: proxy.server, bypass: '<-loopback>' } })
    const page = await context.newPage()
    const response = await page.goto(`http://127.0.0.1:${site.port}/hop`)
    assert.equal(response?.headers()[BLOCKED_HEADER], '1')
    await page.goto(`http://127.0.0.1:${site.port}/page`)
    const ws = await page.evaluate(port => new Promise(resolve => {
      const socket = new WebSocket(`ws://localhost:${port}/live`)
      socket.onopen = () => resolve('open')
      socket.onerror = () => resolve('error')
    }), site.port)
    assert.equal(ws, 'error')
    assert.ok(!site.hits.some(h => h.startsWith('localhost')), site.hits.join(', '))
  } finally {
    await browser.close()
    proxy.close()
    site.close()
  }
})

test('a webhook does not follow redirects and never reaches a host the guard refuses', async () => {
  const site = await app()
  try {
    const open = createGuard({ allowedHosts: [], blockPrivate: false })
    assert.equal(await postWebhook(`http://127.0.0.1:${site.port}/hop`, {}, '{}', open), 302)
    assert.deepEqual(site.hits, [`127.0.0.1:${site.port}/hop`])
    const strict = createGuard({ allowedHosts: [], blockPrivate: true })
    await assert.rejects(postWebhook(`http://localhost:${site.port}/`, {}, '{}', strict), /not allowed/)
    assert.equal(site.hits.length, 1)
  } finally {
    site.close()
  }
})

test('an asset cannot take the place of the checked script', async () => {
  const request = { script: { title: 'x', steps: [{ goto: 'https://example.com' }] }, assets: { 'Script.JSON': 'e30=' } }
  await assert.rejects(createJob({ backend: {}, blobs: {} }, request, { workDir: tmpdir() }), /reserved for the script/)
})

test('a step inside if, try or offCamera is named by its place in the script', { skip: missing }, async () => {
  const browser = await launchChromium(config, { headless: true })
  try {
    const page = await browser.newPage()
    await page.goto('data:text/html,<p>hi</p>')
    setStepTimeout(page, 300)
    const v = { pause: async () => {}, note: () => {}, offCamera: fn => fn() }
    const steps = [{ pause: 0 }, { pause: 0 }, { if: { visible: 'p', then: [{ pause: 0 }, { click: '#nope' }] } }]
    await assert.rejects(runSteps(steps, v, page), (/** @type {any} */ error) => {
      assert.match(error.message, /^step 3\.2 \(click\)/)
      assert.equal(error.failure.step, '3.2')
      return true
    })
    await assert.rejects(runSteps([{ offCamera: [{ try: { steps: [{ pause: 0 }], timeout: 300 } }, { click: '#nope' }] }], v, page), /: step 1\.2 \(click\)/)
  } finally {
    await browser.close()
  }
})

test('a theme color reaches ffmpeg only as a color, never as more filters', () => {
  assert.equal(ffmpegColor('#0F172A'), '0x0F172A')
  assert.equal(ffmpegColor('#abc'), '0xaabbcc')
  assert.equal(ffmpegColor('navy'), 'navy')
  for (const bad of ['#000,movie=/etc/passwd', 'black;[in]drawtext=text=x', 'rgb(0,0,0)', '', null]) assert.equal(ffmpegColor(bad), 'black', String(bad))
})

test('the TTS command gets {out} as one word, quoted once', () => {
  const out = "/tmp/my cache/it's.wav"
  assert.equal(commandLine('tts --voice {voice} --out {out}', { voice: 'ana', out }, 'linux'), `tts --voice ana --out '/tmp/my cache/it'\\''s.wav'`)
  assert.equal(commandLine('tts --out {out}', { voice: 'ana', out: 'C:\\My Cache\\a.wav' }, 'win32'), 'tts --out "C:\\My Cache\\a.wav"')
  assert.equal(commandLine('tts --out "{out}"', { voice: 'ana', out: 'C:\\My Cache\\a.wav' }, 'win32'), 'tts --out "C:\\My Cache\\a.wav"')
})

test('a job keeps only the options a client may choose, checked', async () => {
  let saved = null
  const deps = { backend: { store: { save: async job => (saved = job) }, queue: { enqueue: async () => {} } }, blobs: { put: async () => {} } }
  const request = { script: { title: 'x', steps: [{ goto: 'https://example.com' }] }, options: { quality: 'sd', safe: true, sandboxed: false, timeout: 1 } }
  await createJob(deps, request, { workDir: mkdtempSync(join(tmpdir(), 'tourwright-job-')) })
  assert.deepEqual(saved.options, { quality: 'sd', safe: true, dryRun: true })
})

test('signed links: a TTL that is not a number never makes a link that lasts forever; "::" is reached locally', async () => {
  const { checkLink, linkSigner } = await import('#server/jobs/links.js')
  const config = loadConfig({ api: { tokens: ['t'], host: '::', port: 4700 } })
  const before = process.env.TOURWRIGHT_LINK_TTL
  process.env.TOURWRIGHT_LINK_TTL = 'soon'
  try {
    const url = new URL(linkSigner(config)('job1', 'video.mp4'))
    assert.equal(url.host, '127.0.0.1:4700')
    const exp = Number(url.searchParams.get('exp'))
    assert.ok(exp > Date.now() / 1000 && exp <= Date.now() / 1000 + 86_401)
    assert.equal(checkLink(config, 'job1', 'video.mp4', 'NaN', url.searchParams.get('sig')), false)
  } finally {
    if (before === undefined) delete process.env.TOURWRIGHT_LINK_TTL
    else process.env.TOURWRIGHT_LINK_TTL = before
  }
})
