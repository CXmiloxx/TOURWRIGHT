// Signed download links to the API (`/v1/jobs/:id/files/:file?exp=…&sig=…`): a person or an agent can open
// the video without the API token, until the link expires. Every API replica and worker that shares the
// same TOURWRIGHT_LINK_SECRET (or the same API tokens) signs and checks the same links.
import { createHmac, timingSafeEqual } from 'node:crypto'

const secretOf = config => process.env.TOURWRIGHT_LINK_SECRET ?? (config.api.tokens.length ? `tokens:${config.api.tokens.join(',')}` : null)

const sign = (secret, id, file, exp) => createHmac('sha256', secret).update(`${id}/${file}:${exp}`).digest('base64url')

export const linkSigner = config => {
  const secret = secretOf(config)
  const base = (process.env.TOURWRIGHT_PUBLIC_URL ?? `http://${config.api.host === '0.0.0.0' ? '127.0.0.1' : config.api.host}:${config.api.port}`).replace(/\/$/, '')
  const ttl = Number(process.env.TOURWRIGHT_LINK_TTL ?? 86_400)
  return (id, file) => {
    const path = `${base}/v1/jobs/${id}/files/${encodeURIComponent(file)}`
    if (!secret) return path
    const exp = Math.floor(Date.now() / 1000) + ttl
    return `${path}?exp=${exp}&sig=${sign(secret, id, file, exp)}`
  }
}

export const checkLink = (config, id, file, exp, sig) => {
  const secret = secretOf(config)
  if (!secret || !exp || !sig || Number(exp) < Date.now() / 1000) return false
  const a = Buffer.from(sign(secret, id, file, exp))
  const b = Buffer.from(String(sig))
  return a.length === b.length && timingSafeEqual(a, b)
}
