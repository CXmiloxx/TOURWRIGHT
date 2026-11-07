// The sandbox's proxy. `context.route` sees only the first request of a redirect and no WebSockets, so a page
// could reach a private network through a redirect or a socket. With a strict guard (an allowlist or
// TOURWRIGHT_BLOCK_PRIVATE) every connection the browser makes goes through this proxy instead: each hop of a
// redirect, every WebSocket, every fetch. Each is checked against the guard, and the proxy connects to the
// address the guard checked, so a name that resolves elsewhere a moment later (DNS rebinding) gets nowhere.
import { Agent, createServer, request } from 'node:http'
import { connect } from 'node:net'

// A page the proxy refused carries this header: `goto` turns it into an error that names the network policy
export const BLOCKED_HEADER = 'x-tourwright-blocked'

const REFUSED = `HTTP/1.1 403 Forbidden\r\n${BLOCKED_HEADER}: 1\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`

/**
 * @param {((url: string) => Promise<boolean>) & { addressOf: (host: string) => Promise<string | null> }} guard
 * @returns {Promise<{ server: string, close: () => void }>} what a browser context's `proxy.server` takes
 */
export const startGuardProxy = async guard => {
  const sockets = new Set()
  const track = socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    return socket
  }
  const agent = new Agent({ keepAlive: true })
  // The address to connect to, or null when the URL may not be loaded
  const allowed = async url => ((await guard(url)) ? guard.addressOf(new URL(url).hostname) : null)

  const server = createServer(async (req, res) => {
    let u
    try {
      u = new URL(req.url ?? '')
    } catch {
      return void res.writeHead(400).end()
    }
    const address = u.protocol === 'http:' ? await allowed(u.href) : null
    if (!address) {
      res.writeHead(403, { [BLOCKED_HEADER]: '1', 'content-type': 'text/plain; charset=utf-8' })
      return void res.end('Blocked by the network policy of this server')
    }
    const headers = { ...req.headers }
    delete headers['proxy-connection']
    delete headers['proxy-authorization']
    const upstream = request({ host: address, port: u.port || 80, method: req.method, path: `${u.pathname}${u.search}`, headers, agent }, answer => {
      res.writeHead(answer.statusCode ?? 502, answer.rawHeaders)
      answer.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  server.on('connection', track)

  // https and WebSockets: a tunnel to host:port
  server.on('connect', async (req, client, head) => {
    client.on('error', () => client.destroy())
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '')
    const host = m && (m[1].includes(':') ? `[${m[1]}]` : m[1])
    const address = m ? await allowed(`https://${host}:${m[2]}/`) : null
    if (!m || !address) return void client.end(REFUSED)
    const upstream = track(connect(Number(m[2]), address, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    }))
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  let closed = false
  return {
    server: `http://127.0.0.1:${port}`,
    close: () => {
      if (closed) return
      closed = true
      server.close()
      for (const socket of sockets) socket.destroy()
      agent.destroy()
    },
  }
}
