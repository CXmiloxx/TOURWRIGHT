// Where job inputs and outputs live. `local`: a folder (on one server, or a shared volume such as NFS for
// many). `s3`: any S3-compatible bucket (AWS, MinIO, Cloudflare R2, Backblaze B2, Wasabi…), with presigned
// download links. S3 is spoken directly (Signature V4): no SDK to install.
import { createHash, createHmac } from 'node:crypto'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const local = root => ({
  kind: 'local',
  path: key => join(root, key),
  put: async (key, file) => {
    const target = join(root, key)
    if (target === file) return
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(file, target)
  },
  get: async (key, file) => {
    mkdirSync(dirname(file), { recursive: true })
    copyFileSync(join(root, key), file)
  },
  exists: async key => existsSync(join(root, key)),
  size: async key => statSync(join(root, key)).size,
  url: async () => null,
  removePrefix: async prefix => rmSync(join(root, prefix), { recursive: true, force: true }),
})

// RFC 3986 encoding, as Signature V4 wants it
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const sha256 = data => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

export const s3 = cfg => {
  if (!cfg.bucket || !cfg.accessKey || !cfg.secretKey) throw new Error('S3 storage needs TOURWRIGHT_S3_BUCKET, TOURWRIGHT_S3_ACCESS_KEY and TOURWRIGHT_S3_SECRET_KEY')
  const endpoint = new URL(cfg.endpoint ?? `https://s3.${cfg.region}.amazonaws.com`)
  // Download links are signed for the address clients use (inside Docker the endpoint may be http://s3:8333)
  const publicEndpoint = cfg.publicEndpoint ? new URL(cfg.publicEndpoint) : endpoint
  const objectUrl = (key, base = endpoint) => {
    const path = `${cfg.prefix}${key}`.split('/').map(enc).join('/')
    return cfg.pathStyle
      ? new URL(`${base.origin}${base.pathname.replace(/\/$/, '')}/${cfg.bucket}/${path}`)
      : new URL(`${base.protocol}//${cfg.bucket}.${base.host}/${path}`)
  }
  const signingKey = date => hmac(hmac(hmac(hmac(`AWS4${cfg.secretKey}`, date), cfg.region), 's3'), 'aws4_request')
  const stamp = () => {
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
    return { amzDate, date: amzDate.slice(0, 8) }
  }
  const canonicalQuery = params => [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')

  const bucketUrl = () =>
    cfg.pathStyle ? new URL(`${endpoint.origin}${endpoint.pathname.replace(/\/$/, '')}/${cfg.bucket}`) : new URL(`${endpoint.protocol}//${cfg.bucket}.${endpoint.host}/`)
  /** @param {string} method @param {string} key @param {{ body?: any, length?: number, type?: string, url?: URL }} [options] */
  const signed = async (method, key, { body = undefined, length = undefined, type = undefined, url = objectUrl(key) } = {}) => {
    const { amzDate, date } = stamp()
    const headers = { host: url.host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amzDate }
    if (length !== undefined) headers['content-length'] = String(length)
    if (type) headers['content-type'] = type
    const names = Object.keys(headers).sort()
    const canonical = [method, url.pathname, '', ...names.map(n => `${n}:${headers[n]}`), '', names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n')
    const scope = `${date}/${cfg.region}/s3/aws4_request`
    const signature = hmac(signingKey(date), ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')).toString('hex')
    const { host, ...sent } = headers
    const response = await fetch(url, {
      method,
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
      ...(body ? { body, duplex: 'half' } : {}),
    })
    if (!response.ok && !(method === 'DELETE' && response.status === 404) && !(method === 'HEAD' && response.status === 404)) {
      throw new Error(`S3 ${method} ${key}: ${response.status} ${(await response.text()).slice(0, 300)}`)
    }
    return response
  }

  const TYPES = { mp4: 'video/mp4', jpg: 'image/jpeg', srt: 'application/x-subrip', vtt: 'text/vtt', json: 'application/json', png: 'image/png' }
  return {
    kind: 's3',
    put: async (key, file) => {
      const { size } = statSync(file)
      await signed('PUT', key, { body: Readable.toWeb(createReadStream(file)), length: size, type: TYPES[key.split('.').pop()] })
    },
    get: async (key, file) => {
      const r = await signed('GET', key)
      mkdirSync(dirname(file), { recursive: true })
      await pipeline(Readable.fromWeb(/** @type {any} */ (r.body)), createWriteStream(file))
    },
    exists: async key => (await signed('HEAD', key)).ok,
    size: async key => Number((await signed('HEAD', key)).headers.get('content-length')),
    // Presigned GET: whoever has the link can download until it expires
    url: async (key, expires = cfg.urlExpires) => {
      const url = objectUrl(key, publicEndpoint)
      const { amzDate, date } = stamp()
      const scope = `${date}/${cfg.region}/s3/aws4_request`
      const params = [['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'], ['X-Amz-Credential', `${cfg.accessKey}/${scope}`], ['X-Amz-Date', amzDate],
        ['X-Amz-Expires', String(expires)], ['X-Amz-SignedHeaders', 'host']]
      const query = canonicalQuery(params)
      const canonical = ['GET', url.pathname, query, `host:${url.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n')
      const signature = hmac(signingKey(date), ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')).toString('hex')
      return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${signature}`
    },
    // Deletes known keys (the job record lists its files): no bucket listing needed
    remove: async keys => {
      for (const k of keys) await signed('DELETE', k)
    },
    removePrefix: async () => {},
    // Creates the bucket when it does not exist (MinIO, SeaweedFS, Garage… start empty)
    ensureBucket: async () => {
      const head = await signed('HEAD', '', { url: bucketUrl() })
      if (head.ok) return
      // Several workers start at once: another one may create it first
      await signed('PUT', '', { url: bucketUrl(), length: 0 }).catch(error => {
        if (!/BucketAlready(Exists|OwnedByYou)/.test(error.message)) throw error
      })
    },
  }
}

export const createBlobs = config => (config.storage.driver === 's3' ? s3(config.storage.s3) : local(config.dataDir))

// Storage ready to use: with S3, the bucket exists (TOURWRIGHT_S3_CREATE_BUCKET=false skips the check)
export const openBlobs = async config => {
  const blobs = createBlobs(config)
  if (blobs.ensureBucket && process.env.TOURWRIGHT_S3_CREATE_BUCKET !== 'false') await blobs.ensureBucket()
  return blobs
}
