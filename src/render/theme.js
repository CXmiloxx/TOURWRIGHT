// Look of everything Tourwright draws: title cards, captions, cursor, highlight frames. Shared by browser
// walkthroughs (an overlay on top of the website) and slides (whole pages).
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { isInside } from '../util.js'

export const DEFAULT_THEME = {
  accent: '#F5A524',
  background: '#0F172A',
  text: '#F8FAFC',
  muted: '#94A3B8',
  gradient: 'radial-gradient(ellipse at 30% 20%, #1E3A5F 0%, #111827 50%, #0B1120 100%)',
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  logo: null,
}

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

// A local image becomes a data URL: pages never need to reach the disk or the network for it.
export const toDataUrl = (ref, baseDir, { sandboxed = false } = {}) => {
  if (!ref) return null
  if (/^(data:|https?:\/\/)/.test(ref)) return ref
  const path = safePath(ref, baseDir, sandboxed)
  if (!existsSync(path)) throw new Error(`image not found: ${ref}`)
  return `data:${MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'};base64,${readFileSync(path).toString('base64')}`
}

// Jobs from the API may only read files inside their own folder.
export const safePath = (ref, baseDir, sandboxed) => {
  const path = resolve(baseDir, ref)
  if (sandboxed && !isInside(path, baseDir)) throw new Error(`path outside the job folder: ${ref}`)
  return path
}

export const resolveTheme = (scriptTheme = {}, configTheme = {}, baseDir = process.cwd(), opts = {}) => {
  const t = { ...DEFAULT_THEME, ...configTheme, ...scriptTheme }
  return { ...t, logo: t.logo ? toDataUrl(t.logo, baseDir, opts) : null }
}

// Plain CSS values only: a theme from the API must not be able to inject rules.
const cssValue = v => String(v ?? '').replace(/[;{}<>]/g, '')

export const themeCss = t => `
  :root { --tw-accent: ${cssValue(t.accent)}; --tw-bg: ${cssValue(t.background)}; --tw-text: ${cssValue(t.text)};
    --tw-muted: ${cssValue(t.muted)}; --tw-gradient: ${cssValue(t.gradient)}; --tw-font: ${cssValue(t.font)}; }
  #tw-cursor { position: fixed; z-index: 2147483647; width: 26px; height: 26px; margin: -3px 0 0 -3px;
    pointer-events: none; transition: transform .08s; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
  #tw-cursor.tw-down { transform: scale(.82); }
  body:has(#tw-title) #tw-cursor, body:has(#tw-title) #tw-caption { display: none; }
  #tw-ripple { position: fixed; z-index: 2147483646; width: 46px; height: 46px; margin: -23px 0 0 -23px;
    border-radius: 50%; background: color-mix(in srgb, var(--tw-accent) 45%, transparent); pointer-events: none; opacity: 0; }
  #tw-ripple.tw-show { animation: tw-ripple .55s ease-out; }
  @keyframes tw-ripple { from { opacity: 1; transform: scale(.3) } to { opacity: 0; transform: scale(1.7) } }
  #tw-caption { position: fixed; z-index: 2147483645; left: 50%; bottom: 3.5vh; transform: translateX(-50%);
    max-width: 72%; padding: .65em 1.25em; border-radius: 16px; background: color-mix(in srgb, var(--tw-bg) 90%, transparent);
    border-left: 5px solid var(--tw-accent); color: var(--tw-text); font: 500 clamp(17px, 1.35vw, 26px)/1.45 var(--tw-font);
    text-align: center; pointer-events: none; box-shadow: 0 10px 34px rgba(0,0,0,.32); animation: tw-up .35s ease-out; }
  @keyframes tw-up { from { opacity: 0; transform: translate(-50%, 12px) } to { opacity: 1; transform: translate(-50%, 0) } }
  #tw-caption b, #tw-caption strong { color: var(--tw-accent); }
  #tw-title { position: fixed; inset: 0; z-index: 2147483644; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 22px; color: var(--tw-text); text-align: center;
    font-family: var(--tw-font); transition: opacity .5s; background: var(--tw-gradient); }
  /* The page's own styles for h1, p, b… must not reach Tourwright's layers (Wikipedia makes h1 dark and serif) */
  #tw-title h1, #tw-title p { font-family: var(--tw-font) !important; border: 0 !important; background: none !important;
    padding: 0 !important; text-shadow: none; text-transform: none; }
  #tw-title h1 { color: var(--tw-text) !important; }
  #tw-title p { color: var(--tw-muted) !important; }
  #tw-caption, .tw-callout, #tw-caption *, .tw-callout * { font-family: var(--tw-font) !important; }
  #tw-caption, .tw-callout { color: var(--tw-text) !important; }
  #tw-title img { width: min(9vw, 9vh); height: min(9vw, 9vh); object-fit: contain; margin-bottom: 6px; }
  #tw-title h1 { margin: 0; font-size: min(4.6vw, 6vh); font-weight: 700; max-width: 82%; letter-spacing: -.5px; line-height: 1.15; }
  #tw-title h1::after { content: ''; display: block; width: 120px; height: 5px; margin: 22px auto 0; border-radius: 3px; background: var(--tw-accent); }
  #tw-title p { margin: 0; font-size: min(2.2vw, 3vh); color: var(--tw-muted); max-width: 72%; line-height: 1.4; }
  .tw-frame { position: fixed; z-index: 2147483643; border: 4px solid var(--tw-accent); border-radius: 12px;
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--tw-accent) 22%, transparent); pointer-events: none; transition: opacity .3s; }
  .tw-blur { filter: blur(8px) !important; }
  html.tw-no-cursor #tw-cursor, html.tw-no-cursor #tw-ripple { display: none; }
  .tw-spot { position: fixed; z-index: 2147483642; border-radius: 12px; pointer-events: none; opacity: 0; transition: opacity .45s;
    box-shadow: 0 0 0 200vmax rgba(2, 6, 23, .66), 0 0 0 3px color-mix(in srgb, var(--tw-accent) 70%, transparent); }
  .tw-spot.tw-show { opacity: 1; }
  .tw-callout { position: fixed; z-index: 2147483646; max-width: min(360px, 40vw); padding: .7em 1em; border-radius: 14px;
    background: var(--tw-bg); color: var(--tw-text); border: 2px solid var(--tw-accent); font: 500 clamp(15px, 1.15vw, 22px)/1.4 var(--tw-font);
    box-shadow: 0 12px 32px rgba(0,0,0,.35); pointer-events: none; opacity: 0; transform: scale(.92); transition: opacity .3s, transform .3s; }
  .tw-callout.tw-show { opacity: 1; transform: none; }
  .tw-callout b, .tw-callout strong { color: var(--tw-accent); }
  .tw-callout::after { content: ''; position: absolute; width: 14px; height: 14px; background: var(--tw-bg);
    border: 2px solid var(--tw-accent); transform: rotate(45deg); }
  .tw-callout.tw-bottom::after { top: -9px; left: calc(var(--tw-arrow) - 9px); border-right: 0; border-bottom: 0; }
  .tw-callout.tw-top::after { bottom: -9px; left: calc(var(--tw-arrow) - 9px); border-left: 0; border-top: 0; }
  .tw-callout.tw-right::after { left: -9px; top: calc(var(--tw-arrow) - 9px); border-right: 0; border-top: 0; }
  .tw-callout.tw-left::after { right: -9px; top: calc(var(--tw-arrow) - 9px); border-left: 0; border-bottom: 0; }
  .tw-focus { position: fixed; z-index: 2147483642; border-radius: 14px; pointer-events: none; opacity: 0; transition: opacity .5s;
    box-shadow: 0 0 0 200vmax rgba(2, 6, 23, .64); }
  .tw-ring { position: fixed; z-index: 2147483643; border-radius: 14px; pointer-events: none; opacity: 0; transition: opacity .4s;
    border: 3px solid var(--tw-accent); box-shadow: 0 0 22px color-mix(in srgb, var(--tw-accent) 55%, transparent); }
  .tw-focus.tw-show, .tw-ring.tw-show { opacity: 1; }
  .tw-ring.tw-pulse { animation: tw-pulse 1.6s ease-out infinite; }
  @keyframes tw-pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--tw-accent) 60%, transparent) }
    to { box-shadow: 0 0 0 20px color-mix(in srgb, var(--tw-accent) 0%, transparent) } }
  .tw-step { display: inline-block; margin: 0 .55em .1em 0; padding: .1em .55em; border-radius: 999px; background: var(--tw-accent);
    color: var(--tw-bg); font-size: .78em; font-weight: 700; letter-spacing: .3px; vertical-align: .1em; }
`
