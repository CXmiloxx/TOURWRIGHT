// Signed download links to the API (`/v1/jobs/:id/files/:file?exp=…&sig=…`): a person or an agent can open
// the video without the API token, until the link expires. Every API replica and worker that shares the
// same TOURWRIGHT_LINK_SECRET (or the same API tokens) signs and checks the same links.
import { createHmac, timingSafeEqual } from 'node:crypto'

const secretOf = config => process.env.TOURWRIGHT_LINK_SECRET ?? (config.api.tokens.length ? `tokens:${config.api.tokens.join(',')}` : null)

const sign = (secret, id, file, exp) => createHmac('sha256', secret).update(`${id}/${file}:${exp}`).digest('base64url')

// Where the API is reached when no public URL is set: an "every interface" host is reached on this machine,
// and an IPv6 address goes in brackets
const hostInUrl = host => {
  if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host.includes(':') ? `[${host}]` : host
}

// Seconds a link works: a whole number above zero, else the default (a link must never be valid forever)
const DEFAULT_TTL = 86_400
const ttlOf = value => {
  const n = Number(value ?? DEFAULT_TTL)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TTL
}

export const linkSigner = config => {
  const secret = secretOf(config)
  const base = (process.env.TOURWRIGHT_PUBLIC_URL ?? `http://${hostInUrl(config.api.host)}:${config.api.port}`).replace(/\/$/, '')
  const ttl = ttlOf(process.env.TOURWRIGHT_LINK_TTL)
  return (id, file) => {
    const path = `${base}/v1/jobs/${id}/files/${encodeURIComponent(file)}`
    if (!secret) return path
    const exp = Math.floor(Date.now() / 1000) + ttl
    return `${path}?exp=${exp}&sig=${sign(secret, id, file, exp)}`
  }
}

export const checkLink = (config, id, file, exp, sig) => {
  const secret = secretOf(config)
  if (!secret || !/^\d{1,12}$/.test(String(exp ?? '')) || !sig || Number(exp) < Date.now() / 1000) return false
  const a = Buffer.from(sign(secret, id, file, exp))
  const b = Buffer.from(String(sig))
  return a.length === b.length && timingSafeEqual(a, b)
}
