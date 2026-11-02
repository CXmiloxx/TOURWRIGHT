#!/usr/bin/env node
// A small app to film and to test Tourwright against, with no dependencies: the cases real apps have.
//   - a login whose user field is wrapped with an icon (its label is not linked to it), then a 2FA code
//   - a customer table with emails, phones and ID numbers (for `mask`)
//   - an upload form, a long process that says when it is done, and a live notice (server-sent events)
//
//   node examples/app/server.js            http://127.0.0.1:4800  (PORT=… for another port)
//   user demo@acme.test · password demo123 · 2FA key JBSWY3DPEHPK3PXP (any authenticator app)
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 4800)
const USER = 'demo@acme.test'
const PASSWORD = 'demo123'
export const TOTP_KEY = 'JBSWY3DPEHPK3PXP'

// RFC 6238, 30 s steps, 6 digits; the code of the step before is accepted too (a slow typist)
const base32 = s => {
  let bits = ''
  for (const c of s.replace(/=+$/, '')) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')
  return Buffer.from(bits.match(/.{8}/g).map(b => Number.parseInt(b, 2)))
}
const code = step => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32(TOTP_KEY)).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}
const validCode = c => {
  const now = Math.floor(Date.now() / 30000)
  return [now, now - 1].some(s => code(s) === c)
}

const sessions = new Map()
const page = (title, body) => `<!doctype html><html lang="es"><meta charset="utf-8"><title>${title} · Acme</title>
<meta name="viewport" content="width=device-width">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; background: #f4f4f7; color: #1f2330 }
  header { background: #1f2330; color: #fff; padding: 14px 28px; display: flex; gap: 24px; align-items: center }
  header a { color: #cdd3ff; text-decoration: none } header b { margin-right: auto }
  main { max-width: 960px; margin: 32px auto; padding: 0 24px }
  .card { background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px #0001 }
  form.login { max-width: 360px; margin: 10vh auto; display: grid; gap: 10px }
  .wrap { display: flex; align-items: center; gap: 8px; border: 1px solid #ccd; border-radius: 8px; padding: 0 10px; background: #fff }
  .wrap input { border: 0; outline: 0; flex: 1 }
  input, button, select { font: inherit; padding: 10px; border: 1px solid #ccd; border-radius: 8px }
  button { background: #4f46e5; color: #fff; border: 0; cursor: pointer }
  table { width: 100%; border-collapse: collapse } td, th { text-align: left; padding: 10px; border-bottom: 1px solid #eee }
  #notice { position: fixed; right: 20px; bottom: 20px; background: #16a34a; color: #fff; padding: 12px 18px; border-radius: 10px; display: none }
</style>${body}</html>`

const nav = `<header><b>Acme</b><a href="/clientes">Clientes</a><a href="/facturas">Facturas</a><a href="/reportes">Reportes</a><a href="/salir">Salir</a></header>`

const LOGIN = page('Ingresar', `
<form class="login card" method="post" action="/login">
  <h2>Iniciar sesión</h2>
  <span>Usuario o correo</span>
  <div class="wrap"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="5" r="3" fill="#99a"/><rect x="2" y="10" width="12" height="5" rx="2" fill="#99a"/></svg><input name="user" placeholder="Tu usuario o tu correo" autocomplete="username"></div>
  <label>Contraseña <input name="password" type="password" autocomplete="current-password"></label>
  <button type="submit">Ingresar</button>
  <p id="error" style="color:#b91c1c"></p>
</form>`)

const TWO_FA = page('Verificación', `
<form class="login card" method="post" action="/2fa">
  <h2>Verificación en dos pasos</h2>
  <label>Código de verificación <input name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <button type="submit">Verificar</button>
</form>`)

const CUSTOMERS = page('Clientes', `${nav}<main><div class="card">
  <h1>Clientes</h1>
  <table><tr><th>Nombre</th><th>Correo</th><th>Celular</th><th>Documento</th><th>Saldo</th></tr>
  <tr><td>Ana Pérez</td><td>ana.perez@gmail.com</td><td>300 555 1234</td><td>CC 1.023.456.789</td><td>$ 1.250.000</td></tr>
  <tr><td>Luis Gómez</td><td>lgomez@empresa.co</td><td>311 222 3344</td><td>CC 79.845.123</td><td>$ 430.500</td></tr>
  <tr><td>Marta Ruiz</td><td>marta.ruiz@hotmail.com</td><td>315 678 9012</td><td>CC 52.111.222</td><td>$ 0</td></tr>
  </table></div></main>`)

const INVOICES = page('Facturas', `${nav}<main><div class="card">
  <h1>Facturas</h1>
  <form id="upload" style="display:grid;gap:10px;max-width:420px">
    <label>Archivo de la factura <input type="file" name="file"></label>
    <label>Cliente <select name="customer"><option>Ana Pérez</option><option>Luis Gómez</option></select></label>
    <button type="submit">Subir factura</button>
  </form>
  <p id="status" aria-live="polite"></p>
  <script>
    document.getElementById('upload').onsubmit = async e => {
      e.preventDefault()
      const file = e.target.file.files[0]
      document.getElementById('status').textContent = file ? 'Factura ' + file.name + ' guardada' : 'Elige un archivo'
    }
  </script></div></main>`)

const REPORTS = page('Reportes', `${nav}<main><div class="card">
  <h1>Reportes</h1>
  <button id="run">Generar reporte</button>
  <p id="progress" aria-live="polite"></p>
  <script>
    document.getElementById('run').onclick = () => {
      const p = document.getElementById('progress')
      p.textContent = 'Procesando…'
      setTimeout(() => { p.textContent = 'Reporte listo: 3 clientes, $ 1.680.500' }, 4000)
    }
  </script></div></main>
<div id="notice" role="status"></div>
<script>
  // A live notice from the server
  new EventSource('/events').onmessage = e => {
    const n = document.getElementById('notice')
    n.textContent = e.data
    n.style.display = 'block'
  }
</script>`)

const read = req => new Promise(resolve => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(body))))
})
const cookie = req => /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
const send = (res, status, html, headers = {}) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
  res.end(html)
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const session = sessions.get(cookie(req) ?? '')
  if (url.pathname === '/login' && req.method === 'POST') {
    const { user, password } = await read(req)
    if (user !== USER || password !== PASSWORD) return send(res, 200, LOGIN.replace('<p id="error" style="color:#b91c1c"></p>', '<p id="error" style="color:#b91c1c">Usuario o contraseña incorrectos</p>'))
    const sid = randomBytes(12).toString('hex')
    sessions.set(sid, { verified: false })
    return send(res, 303, '', { location: '/2fa', 'set-cookie': `sid=${sid}; HttpOnly; Path=/` })
  }
  if (url.pathname === '/2fa') {
    if (!session) return send(res, 303, '', { location: '/login' })
    if (req.method === 'POST') {
      const { code: typed } = await read(req)
      if (!validCode(String(typed ?? '').trim())) return send(res, 200, TWO_FA)
      session.verified = true
      return send(res, 303, '', { location: '/clientes' })
    }
    return send(res, 200, TWO_FA)
  }
  if (url.pathname === '/login' || url.pathname === '/') return send(res, 200, LOGIN)
  if (url.pathname === '/salir') {
    sessions.delete(cookie(req) ?? '')
    return send(res, 303, '', { location: '/login', 'set-cookie': 'sid=; Max-Age=0; Path=/' })
  }
  if (!session?.verified) return send(res, 303, '', { location: '/login' })
  if (url.pathname === '/clientes') return send(res, 200, CUSTOMERS)
  if (url.pathname === '/facturas') return send(res, 200, INVOICES)
  if (url.pathname === '/reportes') return send(res, 200, REPORTS)
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const timer = setTimeout(() => res.write('data: Nuevo pago recibido de Luis Gómez\n\n'), 2500)
    req.on('close', () => clearTimeout(timer))
    return
  }
  send(res, 404, page('No encontrado', `${nav}<main><h1>No encontrado</h1></main>`))
})

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.js')) {
  server.listen(PORT, '127.0.0.1', () => process.stderr.write(`Acme demo app on http://127.0.0.1:${PORT}\n`))
}
