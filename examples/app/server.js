#!/usr/bin/env node
// A small app to film and to test Tourwright against, with no dependencies: the cases real apps have.
//   - a login whose user field is wrapped with an icon (its label is not linked to it), then a 2FA code
//   - a customer table with emails, phones and ID numbers (for `mask`)
//   - an upload form, a long process that says when it is done, and a live notice (server-sent events)
//
//   node examples/app/server.js            http://127.0.0.1:4800  (PORT=… for another port)
//   user demo@facturero.test · password demo123 · 2FA key JBSWY3DPEHPK3PXP (any authenticator app)
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 4800)
const USER = 'demo@facturero.test'
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

// Icons drawn inline (Lucide shapes): no network, and hidden from screen readers so names stay "Clientes"…
const icon = (d, size = 18) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const I = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
}

const mark = (size, id) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 32 32"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#${id})"/><path d="M11.5 23V9h10M11.5 16h8" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const LOGO = `<span class="logo">${mark(30, 'lg')}<b>Facturero</b></span>`
const BIG_LOGO = `<span class="logo big">${mark(46, 'lg-big')}<span><b>Facturero</b><small>Facturación</small></span></span>`

const page = (title, body) => `<!doctype html><html lang="es"><meta charset="utf-8"><title>${title} · Facturero</title>
<meta name="viewport" content="width=device-width">
<style>
  :root { --primary: #2563EB; --primary-600: #1D4ED8; --ink: #0F172A; --text: #1E293B; --muted: #64748B; --line: #E2E8F0;
    --bg: #F1F5F9; --card: #fff; --ok: #059669; --ok-bg: #ECFDF5; --warn: #B45309; --warn-bg: #FFFBEB; --navy: #0B1630;
    --font: "Inter", "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif }
  * { box-sizing: border-box }
  body { font: 15px/1.5 var(--font); margin: 0; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased }
  h1, h2 { color: var(--ink); letter-spacing: -.02em; margin: 0 }
  a { color: inherit; text-decoration: none }
  button, input, select { font: inherit }
  button { cursor: pointer }
  :focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 45%, transparent); outline-offset: 2px }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important } }

  /* Login and 2FA: the brand and a preview of the product next to the form */
  .auth { height: 100vh; min-height: 640px; display: grid; grid-template-columns: 1.1fr 1fr }
  .brand { position: relative; overflow: hidden; color: #fff; padding: 40px 52px; display: grid; grid-template-rows: auto 1fr auto; gap: 18px;
    background: radial-gradient(circle at 15% 0%, #1D4ED8 0, transparent 50%), radial-gradient(circle at 100% 100%, #0891B2 0, transparent 45%), var(--navy) }
  .brand::after { content: ''; position: absolute; inset: 0; background-image: linear-gradient(#ffffff0b 1px, transparent 1px), linear-gradient(90deg, #ffffff0b 1px, transparent 1px);
    background-size: 40px 40px; mask-image: radial-gradient(ellipse at 40% 45%, #000, transparent 75%); pointer-events: none }
  .brand > * { position: relative; z-index: 1 }
  .logo.big { gap: 14px } .logo.big b { display: block; font-size: 28px; line-height: 1; color: #fff; letter-spacing: -.03em }
  .logo.big small { display: inline-block; margin-top: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .14em;
    text-transform: uppercase; color: #BFDBFE; background: #ffffff14; border: 1px solid #ffffff26 }
  .pitch { align-self: center; display: grid; gap: 22px }
  .brand h2 { color: #fff; font-size: 38px; line-height: 1.12; max-width: 540px; letter-spacing: -.03em }
  .brand h2 span { background: linear-gradient(90deg, #93C5FD, #67E8F9); -webkit-background-clip: text; background-clip: text; color: transparent }
  .brand p { color: #BFDBFE; max-width: 430px; margin: 10px 0 0; font-size: 16px }
  .preview { position: relative; height: 178px; max-width: 470px }
  .glass { position: absolute; border-radius: 16px; background: #ffffff14; border: 1px solid #ffffff2b; backdrop-filter: blur(12px); box-shadow: 0 20px 50px #02061766 }
  .glass.main { left: 0; top: 0; width: 300px; padding: 16px 18px; animation: float 6s ease-in-out infinite }
  .glass.main small { color: #BFDBFE; font-weight: 600 } .glass.main b { display: block; font-size: 26px; letter-spacing: -.02em }
  .glass.main em { font-style: normal; font-size: 12px; font-weight: 700; color: #6EE7B7; background: #10B98126; padding: 2px 8px; border-radius: 999px; margin-left: 6px; vertical-align: 4px }
  .glass.main svg { display: block; margin-top: 8px }
  .glass.pay { left: 236px; bottom: 0; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #ffffffeb; color: var(--ink); animation: float 6s 1.2s ease-in-out infinite }
  .glass.pay .ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--ok-bg); color: var(--ok) }
  .glass.pay small { display: block; color: var(--muted); font-size: 12px } .glass.pay b { font-size: 14px }
  .trust { display: flex; align-items: center; gap: 18px; color: #BFDBFE; font-size: 13px; font-weight: 600 }
  .trust span { display: inline-flex; align-items: center; gap: 7px } .trust svg { color: #67E8F9 }
  .side { display: flex; align-items: center; justify-content: center; padding: 32px; background: #fff;
    background-image: radial-gradient(circle at 100% 0, #EFF6FF 0, transparent 40%) }
  form.login { width: 100%; max-width: 390px; display: grid; gap: 13px; animation: rise .5s ease-out both }
  form.login h2 { font-size: 30px } form.login .lead { color: var(--muted); margin: -6px 0 4px }
  .sso { height: 46px; display: flex; align-items: center; justify-content: center; gap: 10px; border: 1.5px solid var(--line); border-radius: 12px;
    background: #fff; color: var(--ink); font-weight: 600; transition: background .2s, border-color .2s }
  .sso:hover { background: #F8FAFC; border-color: #CBD5E1 }
  .or { display: flex; align-items: center; gap: 12px; color: #94A3B8; font-size: 13px; font-weight: 600 }
  .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line) }
  .field-name, form.login label { font-weight: 600; font-size: 14px; color: var(--ink); display: grid; gap: 6px }
  .control { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border: 1.5px solid var(--line); border-radius: 12px; background: #F8FAFC;
    color: #94A3B8; transition: border-color .2s, box-shadow .2s, background .2s }
  .control:focus-within { border-color: var(--primary); background: #fff; box-shadow: 0 0 0 4px #2563EB22; color: var(--primary) }
  .control input { border: 0; outline: 0; flex: 1; height: 100%; background: none; color: var(--ink); font-weight: 500 }
  .code input { letter-spacing: .55em; font-size: 22px; font-weight: 700; text-align: center }
  .row { display: flex; align-items: center; justify-content: space-between; font-size: 14px }
  form.login label.check { display: flex; align-items: center; gap: 8px; font-weight: 500; color: var(--muted) }
  .check input { width: 17px; height: 17px; accent-color: var(--primary) }
  .link { color: var(--primary); font-weight: 600 }
  .primary { height: 48px; border: 0; border-radius: 12px; color: #fff; font-weight: 700; letter-spacing: .01em;
    background: linear-gradient(180deg, #3B82F6, var(--primary)); box-shadow: 0 8px 20px #2563EB40, inset 0 1px 0 #ffffff40; transition: transform .15s, box-shadow .2s }
  .primary:hover { transform: translateY(-1px); box-shadow: 0 12px 26px #2563EB55 }
  .hint { display: flex; gap: 8px; align-items: center; justify-content: center; color: var(--muted); font-size: 13px; margin: 0 }
  .foot { text-align: center; color: var(--muted); font-size: 14px; margin: 2px 0 0 }
  #error { color: #B91C1C; margin: 0; font-weight: 600 } #error:empty { display: none }
  @keyframes float { 50% { transform: translateY(-6px) } }

  /* The app: a sidebar, a top bar and the page */
  .app { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh }
  aside { background: var(--navy); color: #CBD5E1; padding: 22px 14px; display: flex; flex-direction: column; gap: 6px }
  aside .logo { padding: 0 10px 18px } aside .logo b { color: #fff }
  .logo { display: flex; align-items: center; gap: 10px; font-size: 19px }
  aside nav { display: grid; gap: 4px }
  aside nav a { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; font-weight: 600; transition: background .2s, color .2s }
  aside nav a:hover { background: #ffffff10; color: #fff }
  aside nav a.on { background: linear-gradient(90deg, #2563EB, #2563EBaa); color: #fff; box-shadow: 0 6px 16px #2563EB44 }
  aside .out { margin-top: auto }
  .top { height: 64px; display: flex; align-items: center; gap: 16px; padding: 0 32px; background: #ffffffcc; backdrop-filter: blur(10px); border-bottom: 1px solid var(--line) }
  .search { display: flex; align-items: center; gap: 8px; width: 320px; height: 38px; padding: 0 12px; border-radius: 10px; background: var(--bg); color: #94A3B8; font-size: 14px }
  .top .me { margin-left: auto; display: flex; align-items: center; gap: 14px; color: var(--muted) }
  .avatar { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #60A5FA, #7C3AED) }
  main { padding: 28px 32px; display: grid; gap: 20px; align-content: start; animation: rise .45s ease-out both }
  .head { display: flex; align-items: end; justify-content: space-between }
  .head h1 { font-size: 26px } .head p { margin: 2px 0 0; color: var(--muted) }
  .card { background: var(--card); border-radius: 16px; border: 1px solid var(--line); box-shadow: 0 1px 2px #0f172a0a, 0 8px 24px #0f172a0a; padding: 22px }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px }
  .kpi { display: flex; gap: 14px; align-items: center }
  .kpi .ico { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center }
  .kpi small { color: var(--muted); font-weight: 600 } .kpi b { display: block; font-size: 22px; color: var(--ink); letter-spacing: -.02em }
  .kpi em { font-style: normal; color: var(--ok); font-size: 13px; font-weight: 700 }
  table { width: 100%; border-collapse: collapse; font-size: 14px }
  th { text-align: left; padding: 10px 14px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; background: #F8FAFC; border-bottom: 1px solid var(--line) }
  td { padding: 13px 14px; border-bottom: 1px solid #F1F5F9 } tr:last-child td { border-bottom: 0 }
  td.name { font-weight: 600; color: var(--ink) } td.name span { display: flex; align-items: center; gap: 10px }
  td.name i { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff }
  td.money { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700 }
  .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50% ; background: currentColor }
  .ok { color: var(--ok); background: var(--ok-bg) } .warn { color: var(--warn); background: var(--warn-bg) } .idle { color: var(--muted); background: #F1F5F9 }
  form.stack { display: grid; gap: 16px; max-width: 520px }
  .drop { display: grid; justify-items: center; gap: 6px; padding: 26px; border: 2px dashed #BFDBFE; border-radius: 14px; background: #EFF6FF; color: var(--primary); font-weight: 700; cursor: pointer; transition: background .2s }
  .drop:hover { background: #DBEAFE } .drop small { color: var(--muted); font-weight: 500 }
  .drop input { position: absolute; width: 1px; height: 1px; opacity: 0 }
  .drop.has { border-style: solid; border-color: #6EE7B7; background: var(--ok-bg); color: var(--ok) }
  select { height: 44px; padding: 0 12px; border: 1.5px solid var(--line); border-radius: 12px; background: #fff; color: var(--ink); font-weight: 500 }
  label.plain { display: grid; gap: 6px; font-weight: 600; font-size: 14px; color: var(--ink) }
  .primary.inline { padding: 0 22px; display: inline-flex; align-items: center; gap: 8px; justify-self: start }
  .done { display: flex; align-items: center; gap: 10px; margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-weight: 700; animation: rise .35s ease-out both }
  .done:empty { display: none }
  .bar { height: 10px; border-radius: 99px; background: #E2E8F0; overflow: hidden } .bar i { display: block; height: 100%; width: 0; border-radius: 99px; background: linear-gradient(90deg, #60A5FA, var(--primary)); transition: width 4s linear }
  .report { display: grid; grid-template-columns: 1fr 1.3fr; gap: 20px; align-items: center }
  .chart { display: flex; align-items: end; gap: 12px; height: 140px; padding-top: 10px }
  .chart span { flex: 1; border-radius: 8px 8px 4px 4px; background: linear-gradient(180deg, #60A5FA, #2563EB); transform-origin: bottom; animation: grow .8s cubic-bezier(.2,.8,.2,1) both }
  #notice { position: fixed; right: 24px; bottom: 24px; display: none; align-items: center; gap: 12px; padding: 14px 18px 14px 14px; border-radius: 14px;
    background: #fff; color: var(--ink); font-weight: 600; border: 1px solid var(--line); box-shadow: 0 18px 40px #0f172a26; animation: toast .5s cubic-bezier(.2,.9,.3,1.2) both }
  #notice .ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--ok-bg); color: var(--ok) }
  /* Phones: one column, the menu as a bar on top */
  @media (max-width: 760px) {
    .auth { grid-template-columns: 1fr; grid-template-rows: auto 1fr; height: auto; min-height: 100vh }
    .brand { padding: 22px 22px 26px; grid-template-rows: auto auto; gap: 14px }
    .brand h2 { font-size: 26px } .brand p { font-size: 14px } .preview, .trust { display: none }
    .side { padding: 26px 22px; align-items: flex-start }
    .app { grid-template-columns: 1fr; grid-template-rows: auto 1fr }
    aside { flex-direction: row; align-items: center; padding: 10px 12px; gap: 4px; overflow-x: auto }
    aside .logo { padding: 0 8px 0 2px } aside .logo b { display: none }
    aside nav { display: flex; gap: 2px } aside nav a { padding: 8px 10px; gap: 6px; font-size: 14px } aside .out { margin: 0 0 0 auto }
    .top { display: none }
    main { padding: 18px 16px; gap: 14px }
    .head { flex-direction: column; align-items: flex-start; gap: 12px } .head h1 { font-size: 24px }
    .kpis { grid-template-columns: 1fr; gap: 10px } .kpi { padding: 14px 16px }
    .card { padding: 16px }
    table { font-size: 13px } th:nth-child(3), td:nth-child(3), th:nth-child(4), td:nth-child(4), th:nth-child(6), td:nth-child(6) { display: none }
    .report { grid-template-columns: 1fr } .chart { height: 110px }
    #notice { left: 16px; right: 16px; bottom: 16px }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(10px) } }
  @keyframes grow { from { transform: scaleY(0) } }
  @keyframes toast { from { opacity: 0; transform: translateY(16px) scale(.96) } }
</style>${body}</html>`

const shell = (active, content) => `<div class="app"><aside>${LOGO}<nav>
  ${[['clientes', 'Clientes', I.users], ['facturas', 'Facturas', I.file], ['reportes', 'Reportes', I.chart]].map(([href, name, d]) => `<a href="/${href}"${href === active ? ' class="on" aria-current="page"' : ''}>${icon(d)}${name}</a>`).join('')}
  </nav><nav class="out"><a href="/salir">${icon(I.out)}Salir</a></nav></aside>
  <div><div class="top"><div class="search">${icon(I.search, 16)}Buscar clientes, facturas…</div><div class="me">${icon(I.bell)}<span class="avatar">${icon(I.user, 18)}</span></div></div>
  <main>${content}</main></div></div>`

const SPARK = '<svg aria-hidden="true" width="264" height="54" viewBox="0 0 264 54"><defs><linearGradient id="sp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67E8F9" stop-opacity=".45"/><stop offset="1" stop-color="#67E8F9" stop-opacity="0"/></linearGradient></defs><path d="M0 44 30 38 58 41 88 28 118 32 148 20 178 24 208 12 238 15 264 4V54H0Z" fill="url(#sp)"/><path d="M0 44 30 38 58 41 88 28 118 32 148 20 178 24 208 12 238 15 264 4" fill="none" stroke="#67E8F9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const brand = (title, text) => `<section class="brand">${BIG_LOGO}
  <div class="pitch"><div><h2>${title}</h2><p>${text}</p></div>
    <div class="preview" aria-hidden="true">
      <div class="glass main"><small>Por cobrar este mes</small><b>$ 4,2 M<em>+12 %</em></b>${SPARK}</div>
      <div class="glass pay"><span class="ico">${icon(I.check, 20)}</span><div><small>Pago recibido</small><b>+ $ 430.500</b></div></div>
    </div></div>
  <div class="trust"><span>${icon(I.shield, 16)}2FA en cada ingreso</span><span>${icon(I.lock, 16)}Datos cifrados</span><span>${icon(I.users, 16)}Miles de empresas</span></div></section>`

const GOOGLE = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'

const LOGIN = page('Ingresar', `<div class="auth">${brand('Tus cobros,<br><span>claros y al día</span>', 'Clientes, facturas y reportes de tu empresa en un solo lugar, con avisos en tiempo real.')}
<div class="side"><form class="login" method="post" action="/login">
  <h2>Iniciar sesión</h2><p class="lead">Bienvenido de nuevo a Facturero.</p>
  <a class="sso" href="#">${GOOGLE}Continuar con Google</a>
  <div class="or">o con tu correo</div>
  <span class="field-name">Usuario o correo</span>
  <div class="control">${icon(I.user)}<input name="user" placeholder="Tu usuario o tu correo" autocomplete="username"></div>
  <label>Contraseña <span class="control">${icon(I.lock)}<input name="password" type="password" autocomplete="current-password"></span></label>
  <div class="row"><label class="check"><input type="checkbox" checked>Recordarme</label><a class="link" href="#">¿La olvidaste?</a></div>
  <button class="primary" type="submit">Ingresar</button>
  <p id="error"></p>
  <p class="foot">¿Nuevo en Facturero? <a class="link" href="#">Crea una cuenta</a></p>
</form></div></div>`)

const TWO_FA = page('Verificación', `<div class="auth">${brand('Un paso más,<br><span>tu cuenta segura</span>', 'Usa el código de tu aplicación de autenticación: nadie entra sin él.')}
<div class="side"><form class="login" method="post" action="/2fa">
  <h2>Verificación en dos pasos</h2><p class="lead">Escribe los 6 dígitos que ves en tu aplicación.</p>
  <label>Código de verificación <span class="control code">${icon(I.shield)}<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></span></label>
  <button class="primary" type="submit">Verificar</button>
  <p class="hint">${icon(I.shield, 16)}El código cambia cada 30 segundos</p>
</form></div></div>`)

const person = (name, email, phone, id, balance, status, color) => `<tr><td class="name"><span><i style="background:${color}">${icon(I.user, 16)}</i>${name}</span></td><td>${email}</td><td>${phone}</td><td>${id}</td><td class="money">${balance}</td><td>${status}</td></tr>`

const CUSTOMERS = page('Clientes', shell('clientes', `
  <div class="head"><div><h1>Clientes</h1><p>Contacto y saldo de cada cliente</p></div></div>
  <div class="kpis">
    <div class="card kpi"><span class="ico" style="background:#EFF6FF;color:#2563EB">${icon(I.users, 22)}</span><div><small>Clientes activos</small><b>3</b></div></div>
    <div class="card kpi"><span class="ico" style="background:#ECFDF5;color:#059669">${icon(I.wallet, 22)}</span><div><small>Por cobrar</small><b>$ 1.680.500</b></div></div>
    <div class="card kpi"><span class="ico" style="background:#F5F3FF;color:#7C3AED">${icon(I.trend, 22)}</span><div><small>Cobrado este mes</small><b>$ 4,2 M <em>+12 %</em></b></div></div>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
  <table><tr><th>Nombre</th><th>Correo</th><th>Celular</th><th>Documento</th><th>Saldo</th><th>Estado</th></tr>
  ${person('Ana Pérez', 'ana.perez@gmail.com', '300 555 1234', 'CC 1.023.456.789', '$ 1.250.000', '<span class="badge warn">Pendiente</span>', 'linear-gradient(135deg,#F472B6,#DB2777)')}
  ${person('Luis Gómez', 'lgomez@empresa.co', '311 222 3344', 'CC 79.845.123', '$ 430.500', '<span class="badge warn">Pendiente</span>', 'linear-gradient(135deg,#60A5FA,#2563EB)')}
  ${person('Marta Ruiz', 'marta.ruiz@hotmail.com', '315 678 9012', 'CC 52.111.222', '$ 0', '<span class="badge ok">Al día</span>', 'linear-gradient(135deg,#34D399,#059669)')}
  </table></div>`))

const INVOICES = page('Facturas', shell('facturas', `
  <div class="head"><div><h1>Facturas</h1><p>Sube la factura y asígnala a un cliente</p></div></div>
  <div class="card"><form id="upload" class="stack">
    <label class="drop" id="drop">${icon(I.upload, 28)}<span id="drop-text">Archivo de la factura</span><small id="drop-hint">PDF, imagen o texto · hasta 10 MB</small><input type="file" name="file"></label>
    <label class="plain">Cliente <select name="customer"><option>Ana Pérez</option><option>Luis Gómez</option></select></label>
    <button class="primary inline" type="submit">${icon(I.upload, 18)}Subir factura</button>
  </form>
  <p id="status" class="done" aria-live="polite" style="margin-top:16px"></p>
  <script>
    const form = document.getElementById('upload')
    form.file.onchange = () => {
      const f = form.file.files[0]
      document.getElementById('drop').classList.toggle('has', !!f)
      document.getElementById('drop-hint').textContent = f ? f.name + ' · listo para subir' : 'PDF, imagen o texto · hasta 10 MB'
    }
    form.onsubmit = async e => {
      e.preventDefault()
      const file = form.file.files[0]
      document.getElementById('status').textContent = file ? 'Factura ' + file.name + ' guardada' : 'Elige un archivo'
    }
  </script></div>`))

const REPORTS = page('Reportes', `${shell('reportes', `
  <div class="head"><div><h1>Reportes</h1><p>El resumen del mes, listo para compartir</p></div>
  <button id="run" class="primary inline">${icon(I.chart, 18)}Generar reporte</button></div>
  <div class="card report"><div style="display:grid;gap:12px">
    <b style="color:var(--ink);font-size:17px">Resumen de noviembre</b>
    <div class="bar"><i id="bar"></i></div>
    <p id="progress" aria-live="polite" style="margin:0;color:var(--muted);font-weight:600">Pulsa Generar reporte para empezar</p>
  </div><div class="chart" id="chart" hidden></div></div>
  <script>
    document.getElementById('run').onclick = () => {
      const p = document.getElementById('progress')
      p.textContent = 'Procesando…'
      requestAnimationFrame(() => (document.getElementById('bar').style.width = '100%'))
      setTimeout(() => {
        p.textContent = 'Reporte listo: 3 clientes, $ 1.680.500'
        p.style.color = 'var(--ok)'
        const c = document.getElementById('chart')
        c.innerHTML = [38, 52, 46, 70, 64, 88].map((h, i) => '<span style="height:' + h + '%;animation-delay:' + i * 70 + 'ms"></span>').join('')
        c.hidden = false
      }, 4000)
    }
  </script>`)}
<div id="notice" role="status"><span class="ico">${icon(I.check, 20)}</span><span id="notice-text"></span></div>
<script>
  // A live notice from the server
  new EventSource('/events').onmessage = e => {
    document.getElementById('notice-text').textContent = e.data
    document.getElementById('notice').style.display = 'flex'
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
    if (user !== USER || password !== PASSWORD) return send(res, 200, LOGIN.replace('<p id="error"></p>', '<p id="error">Usuario o contraseña incorrectos</p>'))
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
  send(res, 404, page('No encontrado', shell('', '<h1>No encontrado</h1>')))
})

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.js')) {
  server.listen(PORT, '127.0.0.1', () => process.stderr.write(`Facturero demo app on http://127.0.0.1:${PORT}\n`))
}
