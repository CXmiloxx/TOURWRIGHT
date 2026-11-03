// The studio frame (`theme.frame: window`): the recording inside a browser window, with rounded corners and a
// soft shadow, on a wallpaper made from the theme's colors. Tourwright draws two still pictures here, the
// wallpaper with the empty window and the mask of its rounded corners, and compose() puts the recording in.
import { join } from 'node:path'
import { escapeHtml } from '../util.js'

export const FRAMES = /** @type {const} */ (['none', 'window'])

// Plain CSS values only, as in themeCss
const css = v => String(v ?? '').replace(/[;{}<>]/g, '')
const even = n => Math.round(n / 2) * 2

// Where the recording goes: scaled down, centered, with the window's bar above it
/** @param {number} width @param {number} height */
export const frameLayout = (width, height) => {
  const portrait = height > width
  const scale = portrait ? 0.9 : 0.86
  const w = even(width * scale)
  const h = even(height * scale)
  const bar = Math.round(Math.min(width, height) * (portrait ? 0.045 : 0.05))
  const x = even((width - w) / 2)
  const y = even((height - h - bar) / 2 + bar)
  const radius = Math.round(Math.min(width, height) * 0.018)
  return { x, y, w, h, bar, radius }
}

const wallpaper = (theme, width, height, title, l) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: ${css(theme.background)}; font-family: ${css(theme.font)}; }
  .glow { position: absolute; border-radius: 50%; filter: blur(${Math.round(width * 0.06)}px); opacity: .7; }
  .a { width: 70vmax; height: 70vmax; left: -22vmax; top: -34vmax; background: radial-gradient(circle, ${css(theme.accent)}, transparent 62%); }
  .b { width: 80vmax; height: 80vmax; right: -30vmax; bottom: -44vmax; background: radial-gradient(circle, color-mix(in srgb, ${css(theme.accent)} 25%, #6366F1), transparent 62%); }
  .grain { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.35)); }
  .win { position: absolute; left: ${l.x}px; top: ${l.y - l.bar}px; width: ${l.w}px; height: ${l.h + l.bar}px; border-radius: ${l.radius}px;
    background: #0B1120; box-shadow: 0 ${Math.round(height * 0.03)}px ${Math.round(height * 0.09)}px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.12); overflow: hidden; }
  .bar { height: ${l.bar}px; display: flex; align-items: center; padding: 0 ${Math.round(l.bar * 0.45)}px; gap: ${Math.round(l.bar * 0.22)}px;
    background: linear-gradient(#1F2937, #161E2E); border-bottom: 1px solid rgba(255,255,255,.06); box-sizing: border-box; position: relative; }
  .dot { width: ${Math.round(l.bar * 0.26)}px; height: ${Math.round(l.bar * 0.26)}px; border-radius: 50%; }
  .title { position: absolute; left: 50%; transform: translateX(-50%); max-width: 60%; padding: ${Math.round(l.bar * 0.1)}px ${Math.round(l.bar * 0.6)}px;
    border-radius: 999px; background: rgba(255,255,255,.07); color: #CBD5E1; font-size: ${Math.round(l.bar * 0.36)}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body><div class="glow a"></div><div class="glow b"></div><div class="grain"></div>
<div class="win"><div class="bar"><span class="dot" style="background:#FF5F57"></span><span class="dot" style="background:#FEBC2E"></span><span class="dot" style="background:#28C840"></span>${title ? `<span class="title">${escapeHtml(title)}</span>` : ''}</div></div></body></html>`

// White where the recording shows, black around it: the bottom corners are rounded like the window's
const mask = l => `<!doctype html><html><head><style>html, body { margin: 0; width: ${l.w}px; height: ${l.h}px; background: #000; overflow: hidden; }
  div { width: 100%; height: 100%; background: #fff; border-radius: 0 0 ${l.radius}px ${l.radius}px; }</style></head><body><div></div></body></html>`

/**
 * Draws the wallpaper and the mask with a browser that is already open, and returns what compose() needs.
 * @param {import('playwright').Browser} browser
 * @param {{ width: number, height: number, theme: Record<string, any>, title?: string, workDir: string }} p
 */
export const drawFrame = async (browser, { width, height, theme, title, workDir }) => {
  const l = frameLayout(width, height)
  const files = { background: join(workDir, 'frame-background.png'), mask: join(workDir, 'frame-mask.png') }
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  try {
    await page.setContent(wallpaper(theme, width, height, title, l))
    await page.screenshot({ path: files.background })
    await page.setViewportSize({ width: l.w, height: l.h })
    await page.setContent(mask(l))
    await page.screenshot({ path: files.mask })
  } finally {
    await page.close()
  }
  return { ...files, x: l.x, y: l.y, width: l.w, height: l.h }
}

// The video part of the filter graph: the cut recording `[cut]` goes into the window. Inputs `bg` and `mask`
// are the indexes of the two pictures (looped).
/** @param {{ x: number, y: number, width: number, height: number }} f @param {number} bg @param {number} maskInput */
export const frameFilter = (f, bg, maskInput) =>
  `[cut]scale=${f.width}:${f.height}:flags=lanczos,format=yuva420p[rec];[${maskInput}:v]format=gray,scale=${f.width}:${f.height}[fm];` +
  `[rec][fm]alphamerge[win];[${bg}:v]format=yuv420p[fb];[fb][win]overlay=${f.x}:${f.y}:shortest=1:format=auto[vout]`
