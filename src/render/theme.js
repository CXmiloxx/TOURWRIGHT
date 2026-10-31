// Look of everything Tourwright draws: title cards, captions, cursor, highlight frames. Shared by browser
// walkthroughs (an overlay on top of the website) and slides (whole pages).
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { TITLE_ANIMATIONS, TITLE_BACKGROUNDS } from '../script/schema.js'
import { escapeHtml, isInside } from '../util.js'

export const DEFAULT_THEME = {
  accent: '#F5A524',
  background: '#0F172A',
  text: '#F8FAFC',
  muted: '#94A3B8',
  gradient: 'radial-gradient(ellipse at 30% 20%, #1E3A5F 0%, #111827 50%, #0B1120 100%)',
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  logo: null,
  titleAnimation: 'rise',
  titleBackground: 'gradient',
}

// A known name, else the first (the default): the class names come from these lists only
/** @param {readonly string[]} list @param {string} value */
const oneOf = (list, value) => (list.includes(value) ? value : list[0])

/**
 * The markup of a title card, the same in walkthroughs and slides. The CSS animates it (themeCss).
 * @param {{ text: string, subtitle?: string, kicker?: string, animation?: string, background?: string, logo?: string | null }} t
 */
export const titleHtml = ({ text, subtitle, kicker, animation = 'rise', background = 'gradient', logo }) => {
  const words = String(text ?? '').split(/(\s+)/).filter(Boolean)
  let i = 0
  let c = 0
  // `rise` moves word by word; `type` shows letter by letter, with a caret
  const h1 = animation === 'type'
    ? `${[...String(text ?? '')].map(ch => `<span class="tw-c" style="--i:${c++}">${escapeHtml(ch)}</span>`).join('')}<span class="tw-caret"></span>`
    : words.map(w => (/^\s+$/.test(w) ? ' ' : `<span class="tw-w" style="--i:${i++}">${escapeHtml(w)}</span>`)).join('')
  const n = animation === 'type' ? Math.ceil(c * 0.6) : i
  return `<div id="tw-title" class="tw-s-${oneOf(TITLE_ANIMATIONS, animation)} tw-bg-${oneOf(TITLE_BACKGROUNDS, background)}" style="--n:${n};--c:${c}">` +
    '<div class="tw-bg"></div>' +
    (logo ? `<img src="${escapeHtml(logo)}" alt="">` : '') +
    (kicker ? `<div class="tw-kicker">${escapeHtml(kicker)}</div>` : '') +
    `<h1>${h1}</h1>` +
    (subtitle ? `<p>${escapeHtml(subtitle)}</p>` : '') +
    '</div>'
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
    font-family: var(--tw-font); background: var(--tw-gradient); overflow: hidden; }
  #tw-title > :not(.tw-bg) { position: relative; z-index: 1; }
  #tw-title.tw-out { animation: tw-out .55s ease-in forwards; }
  @keyframes tw-out { to { opacity: 0; transform: scale(1.04); filter: blur(10px); } }
  #tw-title .tw-kicker { font: 700 min(1.3vw, 2vh)/1 var(--tw-font); letter-spacing: .24em; text-transform: uppercase;
    color: var(--tw-accent); padding: .75em 1.3em; border-radius: 999px; background: color-mix(in srgb, var(--tw-accent) 12%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--tw-accent) 55%, transparent); }
  #tw-title h1 .tw-w { display: inline-block; }

  /* Backgrounds: a still gradient, soft lights that drift, a moving grid, or the page itself, blurred */
  #tw-title .tw-bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
  #tw-title.tw-bg-aurora { background: var(--tw-bg); }
  #tw-title.tw-bg-aurora .tw-bg::before, #tw-title.tw-bg-aurora .tw-bg::after { content: ''; position: absolute; width: 75vmax; height: 75vmax;
    border-radius: 50%; filter: blur(70px); opacity: .55; }
  #tw-title.tw-bg-aurora .tw-bg::before { top: -38vmax; left: -22vmax; background: radial-gradient(circle, var(--tw-accent), transparent 62%);
    animation: tw-drift-a 9s ease-in-out infinite alternate; }
  #tw-title.tw-bg-aurora .tw-bg::after { bottom: -42vmax; right: -24vmax; background: radial-gradient(circle, color-mix(in srgb, var(--tw-accent) 25%, #6366F1), transparent 62%);
    animation: tw-drift-b 11s ease-in-out infinite alternate; }
  @keyframes tw-drift-a { to { transform: translate(18vw, 14vh) scale(1.15); } }
  @keyframes tw-drift-b { to { transform: translate(-16vw, -12vh) scale(.9); } }
  #tw-title.tw-bg-grid .tw-bg { background-image: linear-gradient(color-mix(in srgb, var(--tw-accent) 16%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--tw-accent) 16%, transparent) 1px, transparent 1px);
    background-size: 64px 64px; mask-image: radial-gradient(ellipse at center, #000 10%, transparent 70%);
    animation: tw-grid 6s linear infinite; }
  @keyframes tw-grid { to { background-position: 64px 64px, 64px 64px; } }
  #tw-title.tw-bg-page { background: linear-gradient(160deg, color-mix(in srgb, var(--tw-bg) 80%, transparent), color-mix(in srgb, var(--tw-bg) 62%, transparent));
    backdrop-filter: blur(18px) saturate(1.2); }

  /* rise: the logo pops, the words come up one by one, the line draws itself, the subtitle follows */
  .tw-s-rise img { animation: tw-pop .7s cubic-bezier(.2, .9, .3, 1.3) both; }
  .tw-s-rise .tw-kicker { animation: tw-down .6s .1s ease-out both; }
  .tw-s-rise h1 .tw-w { animation: tw-rise .75s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(.25s + var(--i) * .08s); }
  .tw-s-rise h1::after { animation: tw-draw .8s cubic-bezier(.6, 0, .2, 1) both; animation-delay: calc(.45s + var(--n) * .08s); }
  .tw-s-rise p { animation: tw-up-in .7s ease-out both; animation-delay: calc(.6s + var(--n) * .08s); }
  @keyframes tw-pop { from { opacity: 0; transform: scale(.6); } }
  @keyframes tw-down { from { opacity: 0; transform: translateY(-14px); } }
  @keyframes tw-rise { from { opacity: 0; transform: translateY(.7em) rotate(3deg); filter: blur(6px); } }
  @keyframes tw-draw { from { width: 0; } }
  @keyframes tw-up-in { from { opacity: 0; transform: translateY(16px); } }

  /* type: letter by letter, with a blinking caret */
  .tw-s-type img, .tw-s-type .tw-kicker { animation: tw-up-in .5s ease-out both; }
  .tw-s-type h1 .tw-c { position: relative; opacity: 0; animation: tw-show .01s both; animation-delay: calc(.35s + var(--i) * .05s); white-space: pre; }
  /* The caret follows the last letter typed, then blinks after the last one */
  .tw-s-type h1 .tw-c::before { content: ''; position: absolute; right: -.08em; top: .12em; width: .07em; height: .95em; background: var(--tw-accent);
    opacity: 0; animation: tw-on .05s linear; animation-delay: calc(.35s + var(--i) * .05s); }
  .tw-s-type h1 .tw-caret { display: inline-block; width: .07em; height: .95em; margin-left: .06em; vertical-align: -.08em; opacity: 0;
    background: var(--tw-accent); animation: tw-blink 1s steps(1) infinite; animation-delay: calc(.35s + var(--c) * .05s); }
  @keyframes tw-on { from, to { opacity: 1; } }
  .tw-s-type h1::after { animation: tw-draw .6s ease-out both; animation-delay: calc(.4s + var(--n) * .08s); }
  .tw-s-type p { animation: tw-up-in .6s ease-out both; animation-delay: calc(.5s + var(--n) * .08s); }
  @keyframes tw-show { to { opacity: 1; } }
  @keyframes tw-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

  /* zoom: everything comes into focus, from big and blurred */
  .tw-s-zoom > :not(.tw-bg) { animation: tw-focus-in 1.1s cubic-bezier(.2, .8, .2, 1) both; }
  .tw-s-zoom h1 { animation-delay: .1s; } .tw-s-zoom p { animation-delay: .35s; }
  @keyframes tw-focus-in { from { opacity: 0; transform: scale(1.3); filter: blur(16px); } }

  /* split: aligned to the left, the title from the left and the subtitle from the right */
  #tw-title.tw-s-split { align-items: flex-start; text-align: left; padding: 0 10vw; box-sizing: border-box; }
  .tw-s-split h1::after { margin: 22px 0 0 !important; animation: tw-draw .8s .5s cubic-bezier(.6, 0, .2, 1) both; }
  .tw-s-split img, .tw-s-split .tw-kicker { animation: tw-down .6s ease-out both; }
  .tw-s-split h1 { animation: tw-from-left .8s .15s cubic-bezier(.2, .8, .2, 1) both; }
  .tw-s-split p { animation: tw-from-right .8s .45s cubic-bezier(.2, .8, .2, 1) both; }
  @keyframes tw-from-left { from { opacity: 0; transform: translateX(-8vw); } }
  @keyframes tw-from-right { from { opacity: 0; transform: translateX(6vw); } }

  /* fade: the card simply appears */
  .tw-s-fade { animation: tw-show-card .6s ease-out both; }
  @keyframes tw-show-card { from { opacity: 0; } }
  /* The page's own styles for h1, p, b… must not reach Tourwright's layers (Wikipedia makes h1 dark and serif) */
  #tw-title h1, #tw-title p { font-family: var(--tw-font) !important; border: 0 !important; background: none !important;
    padding: 0 !important; text-shadow: none; text-transform: none; }
  #tw-title h1 { color: var(--tw-text) !important; }
  #tw-title p { color: var(--tw-muted) !important; }
  #tw-caption, .tw-callout, #tw-caption *, .tw-callout * { font-family: var(--tw-font) !important; }
  #tw-caption, .tw-callout { color: var(--tw-text) !important; }
  #tw-title img { width: min(9vw, 9vh); height: min(9vw, 9vh); object-fit: contain; margin-bottom: 6px; }
  #tw-title h1 { margin: 0; font-size: min(5.8vw, 8vh); font-weight: 800; max-width: 82%; letter-spacing: -.02em; line-height: 1.1; }
  #tw-title h1::after { content: ''; display: block; width: 120px; height: 5px; margin: 22px auto 0; border-radius: 3px; background: var(--tw-accent); }
  #tw-title p { margin: 0; font-size: min(2.5vw, 3.4vh); color: var(--tw-muted); max-width: 72%; line-height: 1.4; }
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
