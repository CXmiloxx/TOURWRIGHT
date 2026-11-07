// What the browser may load, and from where.
//
// - Sandbox (jobs from the API or MCP): only http(s); optional host allowlist; optional block of private
//   networks and cloud metadata, so a script cannot make the worker browse your internal services.
// - `hosts`: serve a public hostname from another origin ({ "app.example.com": "http://localhost:3000" }).
//   Useful to film a staging or local copy under its real domain (cookies are per domain). Live event
//   streams (EventSource) cannot be proxied that way — a response that never ends — so the page's
//   EventSource is replaced by a bridge that receives events from a stream this process opens.
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { readFileSync } from 'node:fs'

// Private networks, loopback, link-local, carrier-grade NAT, "this network", multicast and reserved
const PRIVATE_V4 = [
  [0x0a000000, 8], [0xac100000, 12], [0xc0a80000, 16], [0x7f000000, 8], [0xa9fe0000, 16], [0x64400000, 10], [0x00000000, 8],
  [0xe0000000, 4], [0xf0000000, 4],
]
const v4ToInt = ip => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0

// An IPv6 address as its 8 groups of 16 bits (null when it is not one). A dotted tail (::ffff:1.2.3.4) is two groups.
const v6Groups = ip => {
  let text = ip.toLowerCase().split('%')[0]
  if (isIP(text) !== 6) return null
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (tail) {
    const n = v4ToInt(tail[1])
    text = `${text.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, rest] = text.split('::')
  const groups = s => (s ? s.split(':').map(h => Number.parseInt(h, 16)) : [])
  const a = groups(head)
  const b = groups(rest)
  return [...a, ...new Array(8 - a.length - b.length).fill(0), ...b]
}

// The IPv4 address an IPv6 one carries, written in any of its forms: mapped (::ffff:7f00:1, what the URL parser
// makes of [::ffff:127.0.0.1]), compatible (::7f00:1), NAT64 (64:ff9b::…) and 6to4 (2002:7f00:1::)
const carriedV4 = g => {
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6], g[7])
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return v4(g[6], g[7])
  if (g[0] === 0x2002) return v4(g[1], g[2])
  return null
}

export const isPrivateAddress = ip => {
  if (isIP(ip) === 4) {
    const n = v4ToInt(ip)
    return PRIVATE_V4.some(([base, bits]) => (n & (~0 << (32 - bits))) >>> 0 === base)
  }
  const g = v6Groups(ip)
  if (!g) return false
  const v4 = carriedV4(g)
  if (v4) return isPrivateAddress(v4)
  // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00
}

// "*.example.com" matches example.com and its subdomains; "example.com" only itself.
export const hostAllowed = (host, allowed) =>
  !allowed.length || allowed.some(p => (p.startsWith('*.') ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p))

/**
 * Whether a URL may be loaded. `guard.addressOf(host)` gives the address to connect to (the one that was checked,
 * so a name that resolves elsewhere later cannot reach a private network) or null when the host is not allowed.
 * `guard.strict`: it limits hosts or addresses, beyond the schemes.
 */
export const createGuard = ({ allowedHosts = [], blockPrivate = false }) => {
  /** @type {Map<string, Promise<string | null>>} */
  const resolved = new Map()
  /** @param {string} host @returns {Promise<string | null>} */
  const addressOf = host => {
    host = host.replace(/^\[|\]$/g, '')
    if (!hostAllowed(host, allowedHosts)) return Promise.resolve(null)
    if (!blockPrivate) return Promise.resolve(host)
    if (!resolved.has(host)) {
      resolved.set(host, (isIP(host) ? Promise.resolve([{ address: host }]) : lookup(host, { all: true })).then(
        addrs => (addrs.length && addrs.every(a => !isPrivateAddress(a.address)) ? addrs[0].address : null),
        () => null
      ))
    }
    return /** @type {Promise<string | null>} */ (resolved.get(host))
  }
  /** @param {string} url */
  const guard = async url => {
    let u
    try {
      u = new URL(url)
    } catch {
      return false
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return true
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return false
    return (await addressOf(u.hostname)) !== null
  }
  return Object.assign(guard, { addressOf, strict: blockPrivate || allowedHosts.length > 0 })
}

// Chromium sends empty file parts to an intercepted multipart request; the forwarder refills them from disk.
const refillFiles = (body, contentType, uploads) => {
  const boundary = /boundary=(.+)$/.exec(contentType ?? '')?.[1]
  if (!boundary || !uploads.size) return body
  const sep = Buffer.from(`--${boundary}`)
  const parts = []
  let from = 0
  for (;;) {
    const i = body.indexOf(sep, from)
    if (i < 0) break
    parts.push(body.subarray(from, i))
    from = i + sep.length
  }
  parts.push(body.subarray(from))
  const out = parts.map((part, n) => {
    if (n === 0) return part
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd < 0) return part
    const name = /filename="([^"]+)"/.exec(part.subarray(0, headerEnd).toString())?.[1]
    const path = name && uploads.get(name)
    if (!path) return part
    return Buffer.concat([part.subarray(0, headerEnd + 4), readFileSync(path), Buffer.from('\r\n')])
  })
  return Buffer.concat(out.flatMap((part, n) => (n === 0 ? [part] : [sep, part])))
}

// Runs in the page: EventSource for mapped hosts is fed by __twSseOpen / __twSseEmit.
export const SSE_BRIDGE = hostnames => {
  if (window.__twSse) return
  window.__twSse = true
  const Native = window.EventSource
  const open = {}
  class Bridge extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 2
    constructor(url, options) {
      const u = new URL(String(url), location.href)
      // Other hosts get the real EventSource
      if (!hostnames.includes(u.hostname)) return /** @type {any} */ (new Native(url, options))
      super()
      this.url = u.href
      this.withCredentials = Boolean(options?.withCredentials)
      this.readyState = 0
      this.onopen = this.onmessage = this.onerror = null
      this.id = Math.random().toString(36).slice(2)
      open[this.id] = this
      window.__twSseOpen(this.id, this.url)
    }
    close() {
      if (this.readyState === 2) return
      this.readyState = 2
      delete open[this.id]
      window.__twSseClose(this.id)
    }
  }
  window.EventSource = /** @type {any} */ (Bridge)
  window.__twSseEmit = (id, type, data) => {
    const s = open[id]
    if (!s) return
    if (type === 'open') {
      s.readyState = 1
      const e = new Event('open')
      s.onopen?.(e)
      s.dispatchEvent(e)
    } else if (type === 'error') {
      s.readyState = 2
      delete open[id]
      const e = new Event('error')
      s.onerror?.(e)
      s.dispatchEvent(e)
    } else {
      const e = new MessageEvent(type, { data })
      if (type === 'message') s.onmessage?.(e)
      s.dispatchEvent(e)
    }
  }
  window.addEventListener('pagehide', () => Object.values(open).forEach(s => s.close()))
}

const target = (hosts, url) => {
  const u = new URL(url)
  const to = hosts[u.hostname]
  return to ? new URL(`${u.pathname}${u.search}`, to) : null
}

export const setupNetwork = async (context, { hosts = {}, guard = null, uploads = new Map(), origin }) => {
  const mapped = Object.keys(hosts)
  const streams = new Map()
  if (guard || mapped.length) {
    await context.route('**/*', async route => {
      const request = route.request()
      const url = request.url()
      if (guard && !(await guard(url))) return route.abort('blockedbyclient')
      const to = mapped.length ? target(hosts, url) : null
      if (!to) return route.fallback()
      if (request.headers().accept?.includes('text/event-stream')) return route.abort()
      try {
        const raw = request.postDataBuffer()
        const body = raw && refillFiles(raw, await request.headerValue('content-type'), uploads)
        const response = await route.fetch({ url: to.href, timeout: 60_000, ...(body ? { postData: body } : {}) })
        await route.fulfill({ response })
      } catch {
        await route.abort().catch(() => {})
      }
    })
  }
  if (mapped.length) {
    await context.routeWebSocket(url => mapped.includes(new URL(url).hostname), ws => {
      const to = target(hosts, ws.url())
      to.protocol = to.protocol === 'https:' ? 'wss:' : 'ws:'
      ws.connectToServer(to.href)
    })
    await context.addInitScript(SSE_BRIDGE, mapped)
    await context.exposeBinding('__twSseOpen', async ({ page }, id, url) => {
      const emit = (type, data = '') => page.evaluate(([i, t, d]) => window.__twSseEmit?.(i, t, d), [id, type, data]).catch(() => {})
      const to = target(hosts, url)
      if (!to) return void emit('error')
      const cookie = (await context.cookies(url)).map(c => `${c.name}=${c.value}`).join('; ')
      const req = (to.protocol === 'https:' ? httpsRequest : httpRequest)(to, { headers: { cookie, origin, accept: 'text/event-stream' } }, res => {
        if (res.statusCode !== 200) {
          res.resume()
          return void emit('error')
        }
        void emit('open')
        res.setEncoding('utf8')
        let rest = ''
        res.on('data', chunk => {
          rest += chunk.replace(/\r\n/g, '\n')
          let end
          while ((end = rest.indexOf('\n\n')) >= 0) {
            const block = rest.slice(0, end)
            rest = rest.slice(end + 2)
            let type = 'message'
            const data = []
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim()
              else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
            }
            if (data.length) void emit(type, data.join('\n'))
          }
        })
        res.on('end', () => void emit('error'))
      })
      req.on('error', () => void emit('error'))
      req.end()
      streams.set(id, req)
    })
    await context.exposeBinding('__twSseClose', (_, id) => {
      streams.get(id)?.destroy()
      streams.delete(id)
    })
  }
  return () => streams.forEach(s => s.destroy())
}
