// Job records and the queue that hands them to workers.
//
//   local  one folder: records are JSON files, the queue is a folder of tickets claimed by atomic rename.
//          Works on one server, or on many sharing the folder (NFS, EFS, CephFS…).
//   redis  records in Redis, the queue in BullMQ (retries, stalled-job recovery, any number of workers on
//          any number of servers). Files go to S3 or a shared folder.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { log, sleep } from '../util.js'

// ── Local ───────────────────────────────────────────────────────────────────────────
const writeJson = (file, data) => {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

export const localStore = root => {
  const jobs = join(root, 'jobs')
  const pending = join(root, 'queue', 'pending')
  const running = join(root, 'queue', 'running')
  for (const d of [jobs, pending, running]) mkdirSync(d, { recursive: true })
  const recordFile = id => join(jobs, id, 'job.json')
  const store = {
    save: async job => {
      mkdirSync(join(jobs, job.id), { recursive: true })
      writeJson(recordFile(job.id), job)
      return job
    },
    get: async id => {
      if (!/^[\w-]+$/.test(id)) return null
      try {
        return JSON.parse(readFileSync(recordFile(id), 'utf8'))
      } catch {
        return null
      }
    },
    update: async (id, patch) => {
      const job = await store.get(id)
      if (!job) return null
      return store.save({ ...job, ...(typeof patch === 'function' ? patch(job) : patch) })
    },
    /** @param {{ owner?: string | null, limit?: number, status?: string }} [filter] */
    list: async ({ owner = undefined, limit = 50, status = undefined } = {}) => {
      const all = []
      for (const id of readdirSync(jobs)) {
        const j = await store.get(id)
        if (j && (!owner || j.owner === owner) && (!status || j.status === status)) all.push(j)
      }
      return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit)
    },
    remove: async id => rmSync(join(jobs, id, 'job.json'), { force: true }),
    counts: async () => ({ queued: readdirSync(pending).length, running: readdirSync(running).length }),
  }
  const queue = {
    retriesItself: false,
    enqueue: async id => writeFileSync(join(pending, `${Date.now()}-${id}`), id),
    // Polls the pending folder; renaming a ticket claims it (only one worker wins). Running tickets are
    // touched every few seconds; one that stops being touched belonged to a dead worker and goes back.
    /** @param {Function} handler @param {{ concurrency?: number, staleSeconds?: number, signal?: AbortSignal }} [options] */
    consume: async (handler, { concurrency = 1, staleSeconds = 120, signal = undefined } = {}) => {
      let active = 0
      const me = `${hostname()}-${process.pid}`
      const heartbeat = setInterval(() => {
        for (const t of readdirSync(running).filter(t => t.endsWith(`.${me}`))) {
          try {
            const now = new Date()
            utimesSync(join(running, t), now, now)
          } catch {
            // Finished meanwhile.
          }
        }
      }, 10_000)
      const recover = () => {
        for (const t of readdirSync(running)) {
          try {
            const age = (Date.now() - statSync(join(running, t)).mtimeMs) / 1000
            if (age > staleSeconds) {
              renameSync(join(running, t), join(pending, t.replace(/\.[^.]+$/, '')))
              log.warn(`job ${t} came back to the queue (its worker stopped)`)
            }
          } catch {
            // Another worker recovered it.
          }
        }
      }
      let lastRecover = 0
      while (!signal?.aborted) {
        if (Date.now() - lastRecover > 30_000) {
          recover()
          lastRecover = Date.now()
        }
        if (active < concurrency) {
          const ticket = readdirSync(pending).sort()[0]
          if (ticket) {
            const claimed = join(running, `${ticket}.${me}`)
            try {
              renameSync(join(pending, ticket), claimed)
            } catch {
              continue
            }
            const id = ticket.slice(ticket.indexOf('-') + 1)
            active++
            Promise.resolve(handler(id))
              .catch(error => log.error(`job ${id}: ${error.message}`))
              .finally(() => {
                active--
                rmSync(claimed, { force: true })
              })
            continue
          }
        }
        await sleep(1000)
      }
      clearInterval(heartbeat)
      while (active) await sleep(500)
    },
    close: async () => {},
  }
  return { store, queue }
}

// ── Redis (BullMQ) ──────────────────────────────────────────────────────────────────
export const redisStore = async config => {
  let bull
  let IORedis
  try {
    bull = await import('bullmq')
    IORedis = (await import('ioredis')).default
  } catch {
    throw new Error('the redis queue needs the optional packages bullmq and ioredis (npm install bullmq ioredis)')
  }
  const url = config.queue.redisUrl
  // BullMQ does not close connections it is given: keep them to close on shutdown, or the process stays up
  const connections = []
  const connection = () => {
    const c = new /** @type {any} */ (IORedis)(url, { maxRetriesPerRequest: null })
    connections.push(c)
    return c
  }
  const redis = connection()
  const prefix = `${config.queue.name}:job:`
  const index = `${config.queue.name}:jobs`
  const ttl = config.queue.retentionHours ? config.queue.retentionHours * 3600 + 86_400 : 0
  const queueName = config.queue.name
  const q = new bull.Queue(queueName, { connection: connection() })
  const store = {
    save: async job => {
      const multi = redis.multi().set(prefix + job.id, JSON.stringify(job)).zadd(index, Date.parse(job.createdAt), job.id)
      if (ttl) multi.expire(prefix + job.id, ttl)
      await multi.exec()
      return job
    },
    get: async id => {
      const raw = await redis.get(prefix + id)
      return raw ? JSON.parse(raw) : null
    },
    update: async (id, patch) => {
      const job = await store.get(id)
      if (!job) return null
      return store.save({ ...job, ...(typeof patch === 'function' ? patch(job) : patch) })
    },
    /** @param {{ owner?: string | null, limit?: number, status?: string }} [filter] */
    list: async ({ owner = undefined, limit = 50, status = undefined } = {}) => {
      const out = []
      let offset = 0
      while (out.length < limit) {
        const ids = await redis.zrevrange(index, offset, offset + 199)
        if (!ids.length) break
        offset += ids.length
        const raws = await redis.mget(ids.map(i => prefix + i))
        for (const [i, raw] of raws.entries()) {
          if (!raw) {
            await redis.zrem(index, ids[i])
            continue
          }
          const j = JSON.parse(raw)
          if ((!owner || j.owner === owner) && (!status || j.status === status)) out.push(j)
        }
      }
      return out.slice(0, limit)
    },
    remove: async id => {
      await redis.multi().del(prefix + id).zrem(index, id).exec()
    },
    counts: async () => {
      const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed')
      return { queued: c.waiting + c.delayed, running: c.active }
    },
    // One worker in the whole cluster runs the periodic cleanup
    lock: async (name, seconds) => (await redis.set(`${config.queue.name}:lock:${name}`, hostname(), 'EX', seconds, 'NX')) === 'OK',
  }
  const queue = {
    retriesItself: true,
    enqueue: async id =>
      q.add('render', { id }, { jobId: id, attempts: config.queue.attempts, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 1000 }),
    /** @param {Function} handler @param {{ concurrency?: number, signal?: AbortSignal }} [options] */
    consume: async (handler, { concurrency = 1, signal = undefined } = {}) => {
      const worker = new bull.Worker(queueName, async job => handler(job.data.id, { attempt: job.attemptsMade + 1 }), {
        connection: connection(),
        concurrency,
        // A render can take minutes; the lock is renewed while it runs
        lockDuration: 120_000,
      })
      worker.on('failed', (job, error) => log.warn(`job ${job?.data?.id}: attempt failed: ${error.message}`))
      await new Promise(resolve => signal?.addEventListener('abort', resolve, { once: true }))
      await worker.close()
    },
    close: async () => {
      await q.close()
      for (const c of connections) c.disconnect()
    },
  }
  return { store, queue }
}

export const createBackend = async config =>
  config.queue.driver === 'redis' ? redisStore(config) : localStore(config.dataDir)

export const PUBLIC_FIELDS = ['id', 'status', 'title', 'kind', 'progress', 'createdAt', 'startedAt', 'finishedAt', 'attempts', 'error', 'result']
export const publicJob = job => Object.fromEntries(PUBLIC_FIELDS.filter(k => job[k] !== undefined).map(k => [k, job[k]]))

