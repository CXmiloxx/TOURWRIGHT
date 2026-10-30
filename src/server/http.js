// HTTP API. Stateless: run as many replicas as you like behind a load balancer; jobs go through the queue.
//
//   GET    /health                       liveness + queue counts (no auth)
//   GET    /v1/voices                    voices and engines available
//   GET    /v1/schema                    JSON Schema of scripts
//   POST   /v1/validate                  { script, vars? } → { ok, errors? }
//   POST   /v1/jobs                      { script, vars?, assets?, options?, webhook? } → 202 job
//   GET    /v1/jobs                      the caller's jobs
//   GET    /v1/jobs/:id                  status, progress and, when done, the result with download links
//   GET    /v1/jobs/:id/files/:file      the video, subtitles, thumbnail or manifest (Range supported)
//   DELETE /v1/jobs/:id                  delete a finished job and its files
//
// Auth: `Authorization: Bearer <token>` with one of TOURWRIGHT_API_TOKENS. Each token sees only its own jobs.
import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { openBlobs } from '../jobs/blobs.js'
import { checkLink, linkSigner } from '../jobs/links.js'
import { createJob, deleteJobFiles, resultWithLinks } from '../jobs/service.js'
import { createBackend, publicJob } from '../jobs/store.js'
import { loadPlugins } from '../plugins.js'
import { fromData, parseText } from '../script/load.js'
import { jsonSchema } from '../script/schema.js'
import { log, UserError } from '../util.js'
import { listVoices } from '../voice/index.js'

const TYPES = { mp4: 'video/mp4', jpg: 'image/jpeg', srt: 'application/x-subrip; charset=utf-8', vtt: 'text/vtt; charset=utf-8', json: 'application/json' }
const LOOPBACK = ['127.0.0.1', '::1', 'localhost']

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

// Every error answer: { error: message, code }
const CODES = { 400: 'invalid', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'too_large', 500: 'internal' }
const fail = (res, status, message, headers = {}, code = CODES[status]) => send(res, status, { error: message, code }, headers)

const readBody = (req, maxBytes) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let over = false
    // Past the limit the rest is read and dropped: destroying the request would cut the connection before
    // the client gets its 413 (the answer closes the connection instead)
    req.on('data', c => {
      size += c.length
      if (over) return
      if (size > maxBytes) {
        over = true
        chunks.length = 0
        reject(new UserError(`body larger than ${maxBytes / 1048576} MB`, { status: 413, code: 'too_large' }))
      } else chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new UserError('body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })

const ownerOf = token => (token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : null)

export const createApp = async config => {
  await loadPlugins(config)
  const backend = await createBackend(config)
  const blobs = await openBlobs(config)
  const signLink = linkSigner(config)
  const tokens = config.api.tokens.map(t => Buffer.from(t))
  const workDir = config.tmpDir ?? tmpdir()

  // null = rejected; '' = no tokens configured (local use)
  const authenticate = req => {
    if (!tokens.length) return ''
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
    if (!m) return null
    const given = Buffer.from(m[1].trim())
    return tokens.some(t => t.length === given.length && timingSafeEqual(t, given)) ? m[1].trim() : null
  }

  const view = async job => ({ ...publicJob(job), result: await resultWithLinks(job, { blobs, signLink }) })

  const serveFile = async (req, res, job, file) => {
    if (!/^[\w.-]+$/.test(file) || !job.outputs?.includes(`jobs/${job.id}/out/${file}`)) return fail(res, 404, 'file not found')
    const key = `jobs/${job.id}/out/${file}`
    const presigned = await blobs.url(key)
    if (presigned) return send(res, 302, undefined, { location: presigned })
    const path = blobs.path(key)
    if (!existsSync(path)) return fail(res, 404, 'file not found')
    const { size } = statSync(path)
    const type = TYPES[file.split('.').pop()] ?? 'application/octet-stream'
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2])
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start > end || start < 0) return send(res, 416, undefined, { 'content-range': `bytes */${size}` })
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' })
      return createReadStream(path, { start, end }).pipe(res)
    }
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
    if (req.method === 'HEAD') return res.end()
    createReadStream(path).pipe(res)
  }

  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.pathname === '/health') return send(res, 200, { ok: true, queue: await backend.store.counts() })

    // A signed link opens a file without the token
    if (parts[0] === 'v1' && parts[1] === 'jobs' && parts[3] === 'files' && url.searchParams.has('sig')) {
      const file = decodeURIComponent(parts[4] ?? '')
      if (!checkLink(config, parts[2], file, url.searchParams.get('exp'), url.searchParams.get('sig'))) return fail(res, 403, 'link expired or invalid')
      const job = await backend.store.get(parts[2])
      return job ? serveFile(req, res, job, file) : fail(res, 404, 'job not found')
    }

    const token = authenticate(req)
    if (token === null) return fail(res, 401, 'missing or invalid bearer token', { 'www-authenticate': 'Bearer' })
    const owner = ownerOf(token)
    const ownJob = async id => {
      const job = await backend.store.get(id)
      return job && (job.owner ?? null) === owner ? job : null
    }

    if (req.method === 'GET' && url.pathname === '/v1/voices') return send(res, 200, await listVoices(config))
    if (req.method === 'GET' && url.pathname === '/v1/schema') return send(res, 200, jsonSchema())
    if (req.method === 'POST' && url.pathname === '/v1/validate') {
      const body = await readBody(req, config.api.maxBodyMb * 1048576)
      try {
        const data = typeof body.script === 'string' ? parseText(body.script, body.format === 'json' ? 'json' : 'yaml') : body.script
        fromData(data, { sandboxed: true, vars: body.vars && typeof body.vars === 'object' ? body.vars : undefined })
        return send(res, 200, { ok: true })
      } catch (error) {
        if (!(error instanceof UserError)) throw error
        return send(res, 200, { ok: false, errors: error.message.replace(/^invalid script:\n\s*/, '').split(/\n\s*/) })
      }
    }
    if (req.method === 'POST' && url.pathname === '/v1/jobs') {
      const body = await readBody(req, config.api.maxBodyMb * 1048576)
      const job = await createJob({ backend, blobs, config }, body, { owner, workDir })
      return send(res, 202, await view(job), { location: `/v1/jobs/${job.id}` })
    }
    if (req.method === 'GET' && url.pathname === '/v1/jobs') {
      const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50))
      const jobs = await backend.store.list({ owner, limit, status: url.searchParams.get('status') ?? undefined })
      return send(res, 200, { jobs: await Promise.all(jobs.map(view)) })
    }
    if (parts[0] === 'v1' && parts[1] === 'jobs' && parts[2]) {
      const job = await ownJob(parts[2])
      if (!job) return fail(res, 404, 'job not found')
      if ((req.method === 'GET' || req.method === 'HEAD') && parts.length === 3) return send(res, 200, await view(job))
      if ((req.method === 'GET' || req.method === 'HEAD') && parts[3] === 'files' && parts[4]) return serveFile(req, res, job, decodeURIComponent(parts[4]))
      if (req.method === 'DELETE' && parts.length === 3) {
        if (job.status === 'running' || job.status === 'queued') return fail(res, 409, `job is ${job.status}`)
        await deleteJobFiles(job, blobs)
        await backend.store.remove(job.id)
        return send(res, 204)
      }
    }
    return fail(res, 404, 'not found')
  }

  const server = createServer((req, res) => {
    const started = Date.now()
    handle(req, res)
      .catch(error => {
        if (error instanceof UserError) return fail(res, error.status, error.message, error.status === 413 ? { connection: 'close' } : {}, error.code)
        log.error(`${req.method} ${req.url}: ${error.stack ?? error}`)
        fail(res, 500, 'internal error')
      })
      .finally(() => log.debug(`${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`))
  })
  return { server, backend }
}

export const startServer = async (config, { worker = false } = {}) => {
  if (!config.api.tokens.length && !LOOPBACK.includes(config.api.host) && process.env.TOURWRIGHT_API_INSECURE !== 'true') {
    throw new UserError(`refusing to listen on ${config.api.host} without TOURWRIGHT_API_TOKENS (set TOURWRIGHT_API_INSECURE=true to override)`)
  }
  const { server } = await createApp(config)
  await new Promise(resolve => server.listen(config.api.port, config.api.host, () => resolve(undefined)))
  log.info(`API on http://${config.api.host}:${config.api.port} (${config.queue.driver} queue, ${config.storage.driver} storage${config.api.tokens.length ? '' : ', no auth'})`)
  const shutdown = () => server.close()
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  if (worker) {
    const { startWorker } = await import('../worker.js')
    await startWorker(config)
  }
}
