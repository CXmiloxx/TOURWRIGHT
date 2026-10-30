// Takes jobs from the queue and renders them, `concurrency` at a time. Run as many workers as your servers
// allow: they coordinate through the queue (a shared folder or Redis).
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBlobs } from './jobs/blobs.js'
import { deleteJobFiles, resultWithLinks } from './jobs/service.js'
import { linkSigner } from './jobs/links.js'
import { createBackend, publicJob } from './jobs/store.js'
import { loadPlugins } from './plugins.js'
import { createGuard } from './render/network.js'
import { log } from './util.js'

const RUN_JOB = fileURLToPath(new URL('./run-job.js', import.meta.url))

const runChild = (input, output, options, { timeout, onProgress }) =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [RUN_JOB, input, output, JSON.stringify(options)], { stdio: ['ignore', 'pipe', 'inherit'] })
    let last = null
    let buffer = ''
    child.stdout.on('data', chunk => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        try {
          const msg = JSON.parse(line)
          if (msg.progress) onProgress(msg.progress)
          else last = msg
        } catch {
          // Not ours.
        }
      }
    })
    const timer = setTimeout(() => {
      last = { error: `render took more than ${timeout} s` }
      child.kill('SIGKILL')
    }, timeout * 1000)
    child.on('exit', code => {
      clearTimeout(timer)
      resolve(last ?? { error: `render process exited with ${code}` })
    })
  })

export const notify = async (job, config, signLink, blobs) => {
  if (!job.webhook) return
  const guard = createGuard(config.network)
  if (!(await guard(job.webhook))) return log.warn(`job ${job.id}: webhook host not allowed`)
  const body = JSON.stringify({ event: `job.${job.status}`, job: { ...publicJob(job), result: await resultWithLinks(job, { blobs, signLink }) } })
  const headers = { 'content-type': 'application/json' }
  if (process.env.TOURWRIGHT_WEBHOOK_SECRET) headers['x-tourwright-signature'] = `sha256=${createHmac('sha256', process.env.TOURWRIGHT_WEBHOOK_SECRET).update(body).digest('hex')}`
  await fetch(job.webhook, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) }).catch(e => log.warn(`job ${job.id}: webhook failed: ${e.message}`))
}

// `run` renders one job; tests swap it for a fake.
export const makeHandler = ({ backend, blobs, config, signLink, run = runChild }) => /** @param {string} id @param {{ attempt?: number }} [info] */ async (id, { attempt = undefined } = {}) => {
  const job = await backend.store.update(id, j => ({ status: 'running', startedAt: new Date().toISOString(), attempts: (j.attempts ?? 0) + 1, progress: { stage: 'starting' } }))
  if (!job) return log.warn(`job ${id} has no record; skipped`)
  log.info(`job ${id}: rendering (${job.kind}, attempt ${job.attempts})`)
  mkdirSync(config.tmpDir ?? tmpdir(), { recursive: true })
  const work = mkdtempSync(join(config.tmpDir ?? tmpdir(), `tourwright-job-`))
  const input = join(work, 'input')
  const output = join(work, 'out')
  mkdirSync(output, { recursive: true })
  try {
    for (const key of job.inputs) await blobs.get(key, join(input, key.split('/').pop()))
    let lastProgress = 0
    const r = await run(input, output, { ...job.options, sandboxed: true, sessionNamespace: job.owner ? `api-${job.owner}` : 'api' }, {
      timeout: config.queue.jobTimeout,
      onProgress: p => {
        if (Date.now() - lastProgress < 1000) return
        lastProgress = Date.now()
        backend.store.update(id, { progress: p }).catch(() => {})
      },
    })
    if (r.result) {
      const outputs = []
      for (const f of readdirSync(output).filter(f => !f.startsWith('failure-'))) {
        await blobs.put(`jobs/${id}/out/${f}`, join(output, f))
        outputs.push(`jobs/${id}/out/${f}`)
      }
      const { paths, ...result } = r.result
      const done = await backend.store.update(id, { status: 'done', finishedAt: new Date().toISOString(), progress: { stage: 'done' }, result, outputs, error: undefined })
      log.info(`job ${id}: done in ${Math.round((Date.parse(done.finishedAt) - Date.parse(done.startedAt)) / 1000)} s`)
      await notify(done, config, signLink, blobs)
      return
    }
    const retry = !r.user && (attempt ?? job.attempts) < config.queue.attempts
    if (retry) {
      await backend.store.update(id, { status: 'queued', error: r.error, progress: { stage: 'retrying' } })
      log.warn(`job ${id}: ${r.error} — will retry`)
      if (backend.queue.retriesItself) throw new Error(r.error)
      await backend.queue.enqueue(id)
      return
    }
    const failed = await backend.store.update(id, { status: 'failed', finishedAt: new Date().toISOString(), error: r.error, progress: { stage: 'failed' } })
    log.warn(`job ${id}: failed: ${r.error}`)
    await notify(failed, config, signLink, blobs)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// Deletes finished jobs older than the retention period, with their files.
export const cleanup = async ({ backend, blobs, config }) => {
  if (!config.queue.retentionHours) return
  if (backend.store.lock && !(await backend.store.lock('cleanup', 3000))) return
  const limit = Date.now() - config.queue.retentionHours * 3600_000
  for (const status of ['done', 'failed']) {
    for (const job of await backend.store.list({ status, limit: 10_000 })) {
      if (Date.parse(job.finishedAt ?? job.createdAt) > limit) continue
      await deleteJobFiles(job, blobs).catch(e => log.warn(`cleanup ${job.id}: ${e.message}`))
      await backend.store.remove(job.id)
      if (blobs.kind === 'local') rmSync(join(config.dataDir, 'jobs', job.id), { recursive: true, force: true })
    }
  }
}

/** @param {any} config @param {{ signal?: AbortSignal }} [options] */
export const startWorker = async (config, { signal: external = undefined } = {}) => {
  await loadPlugins(config)
  const signLink = linkSigner(config)
  const backend = await createBackend(config)
  const blobs = await openBlobs(config)
  const controller = new AbortController()
  external?.addEventListener('abort', () => controller.abort(), { once: true })
  const stop = () => {
    log.info('worker: finishing current jobs, then stopping')
    controller.abort()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  const sweep = setInterval(() => cleanup({ backend, blobs, config }).catch(e => log.warn(`cleanup: ${e.message}`)), 3600_000)
  cleanup({ backend, blobs, config }).catch(() => {})
  log.info(`worker: ${config.queue.driver} queue, ${blobs.kind} storage, concurrency ${config.queue.concurrency}`)
  await backend.queue.consume(makeHandler({ backend, blobs, config, signLink }), { concurrency: config.queue.concurrency, signal: controller.signal })
  clearInterval(sweep)
  await backend.queue.close()
}

