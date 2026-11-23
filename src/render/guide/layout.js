// The look of a guide: one HTML page for the screen and for print, with the script's brand (accent, font,
// logo from `theme`), a cover and the footer the PDF puts on every page. The page itself stays light: a dark
// video theme would print as black pages.
import { escapeHtml } from '#core/util.js'
import { headerImage, logoUrl } from './logo.js'

// Plain CSS values only: a theme from the API must not be able to inject rules (as in page/theme.js)
const cssValue = v => String(v ?? '').replace(/[;{}<>]/g, '')

// A text inside a CSS string ("…"): quotes, backslashes and `<` (no `</style>`) escaped, no line breaks
const cssString = v => `"${String(v ?? '').replace(/[\\"<>]/g, c => `\\${c.charCodeAt(0).toString(16)} `).replace(/[\n\r\f]+/g, ' ')}"`

/** '#abc' or '#aabbcc' → [r, g, b] 0-255, or null for anything else (a named color, a gradient) */
const rgb = color => {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(String(color ?? '').trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16))
}

/** @param {number[]} c */
const luminance = ([r, g, b]) => {
  const lin = c => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio of two hex colors (1 to 21); null when one is not a hex color */
export const contrast = (a, b) => {
  const [x, y] = [rgb(a), rgb(b)]
  if (!x || !y) return null
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** The text that reads on the accent: dark ink on a light accent (an orange, a yellow), white on a dark one */
export const inkOn = accent => {
  const c = rgb(accent)
  if (!c) return '#ffffff'
  return contrast('#ffffff', accent) >= contrast('#1f2330', accent) ? '#ffffff' : '#1f2330'
}

/** The accent used on the white page: the theme's, unless it is too pale to read there (then the default) */
/** An accent readable on white: a pale one (yellow, light gray) falls back to the default */
export const pageAccent = accent => ((contrast(accent, '#ffffff') ?? 0) >= 2 ? accent : '#4f46e5')

// Page margins in mm: room for the header (logo, title, a line) and the footer (text, page N of M)
export const margins = header => ({ top: header ? 24 : 16, bottom: 20, x: 15 })

// Paper sizes: the cover fills the first page, so it needs the height
export const PAPER = { A4: { width: '210mm', height: '297mm' }, Letter: { width: '8.5in', height: '11in' } }

/** The cover's colors: light (white, a band of the accent) or dark (the theme's background when it is dark) */
const coverColors = (style, theme) => {
  if (style !== 'dark') return { bg: '#ffffff', ink: '#1f2330', muted: '#5d6475' }
  const bg = (contrast(theme?.background, '#ffffff') ?? 0) >= 7 ? theme.background : '#141824'
  return { bg, ink: '#f8fafc', muted: '#a3a9b8' }
}

/** A locale the date can be written in: `es_ES` becomes `es-ES`, anything unreadable English */
export const locale = language => {
  if (!language || language === 'en') return 'en-US'
  try {
    return Intl.getCanonicalLocales(String(language).replace(/_/g, '-'))[0] ?? 'en-US'
  } catch {
    return 'en-US'
  }
}

/**
 * The whole page.
 * @param {{ title: string, language: string, theme?: Record<string, any> | null, document?: Record<string, any>, body: string,
 *   toc: { id: string, text: string }[], steps: number, made: string, words: { contents: string, steps: (n: number) => string, page: string, of: string } }} page
 */
export const guidePage = ({ title, language, theme, document = {}, body, toc, steps, made, words }) => {
  const accent = pageAccent(theme?.accent ?? '#4f46e5')
  const font = theme?.font ?? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  const paper = PAPER[document.paper ?? 'A4'] ?? PAPER.A4
  const style = document.cover ?? 'light'
  const cover = coverColors(style, theme)
  const coverLogo = logoUrl(document.coverLogo ?? theme?.logo)
  const logo = coverLogo ? `<img class="logo" src="${coverLogo}" alt="">` : ''
  const foot = document.footer ?? title
  const date = new Date().toLocaleDateString(locale(language), { year: 'numeric', month: 'long', day: 'numeric' })
  const contents = (document.toc ?? toc.length > 1) && toc.length
    ? `<nav class="toc"><h2>${escapeHtml(words.contents)}</h2><ol>${toc.map(s => `<li><a href="#${s.id}">${escapeHtml(s.text)}</a></li>`).join('')}</ol></nav>`
    : ''
  const subtitle = document.subtitle ? `<p class="subtitle">${escapeHtml(document.subtitle)}</p>` : ''
  // Every page but the cover: a header (the logo, the title, a line in the accent) and a footer (the footer
  // text, «page N of M», a light line). Drawn by Chromium in the page margins (@page boxes, Chromium 131+).
  const header = document.header !== false
  const m = margins(header)
  const headerLogo = header && theme?.logo ? headerImage(theme.logo, 22) : null
  const small = `font: 8pt ${cssValue(font)}; color: #5d6475`
  const rule = `0.75pt solid ${cssValue(accent)}`
  const line = '0.5pt solid #d5d8e0'
  const boxes = `${header
    ? `@top-left { content: ${headerLogo ?? cssString(title)}; ${headerLogo ? '' : `font: 600 9pt ${cssValue(font)}; color: ${cssValue(accent)};`} vertical-align: bottom; padding-bottom: 3mm; border-bottom: ${rule} }
    @top-right { content: ${headerLogo ? cssString(title) : '""'}; ${small}; vertical-align: bottom; padding-bottom: 3mm; border-bottom: ${rule} }`
    : ''}
    @bottom-left { content: ${cssString(foot)}; ${small}; vertical-align: top; padding-top: 3mm; border-top: ${line} }
    @bottom-right { content: ${cssString(words.page)} " " counter(page) " " ${cssString(words.of)} " " counter(pages); ${small}; vertical-align: top; padding-top: 3mm; border-top: ${line} }`
  const none = '@top-left { content: none; border: 0 } @top-right { content: none; border: 0 } @bottom-left { content: none; border: 0 } @bottom-right { content: none; border: 0 }'
  const printCover = style === 'none'
    ? '.cover { padding: 0 0 8mm; margin-bottom: 6mm } .cover h1 { font-size: 24pt }'
    : `.cover { position: relative; height: ${paper.height}; padding: 34mm 22mm 0; margin: 0; border: 0; border-top: 8mm solid var(--accent); break-after: page;
        background: ${cssValue(cover.bg)}; color: ${cssValue(cover.ink)} }
      .cover .logo { max-height: 22mm; max-width: 90mm; margin-bottom: 36mm }
      .cover h1 { font-size: 32pt; letter-spacing: -0.01em } .cover .meta, .cover .subtitle { color: ${cssValue(cover.muted)} }
      .cover .subtitle { font-size: 15pt } .cover .toc { margin-top: 22mm; padding-top: 8mm; border-top: 0.75pt solid ${cssValue(cover.muted)} }
      .cover .toc h2 { color: ${cssValue(cover.muted)}; font-size: 9pt; text-transform: uppercase; letter-spacing: .12em }
      .cover .foot { display: block; position: absolute; left: 22mm; right: 22mm; bottom: 16mm; padding-top: 5mm; font-size: 9pt;
        color: ${cssValue(cover.muted)}; border-top: 2pt solid var(--accent) }`
  return `<!doctype html>
<html lang="${escapeHtml(language)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink: #1f2330; --muted: #5d6475; --line: #e3e5ec; --soft: #f5f6f9; --accent: ${cssValue(accent)}; --on-accent: ${inkOn(accent)}; --bg: #fff; --font: ${cssValue(font)} }
  @media screen and (prefers-color-scheme: dark) { :root { --ink: #eceef4; --muted: #a3a9b8; --line: #30343f; --soft: #1d2028; --bg: #15171c } }
  * { box-sizing: border-box }
  body { font: 16px/1.6 var(--font); color: var(--ink); background: var(--bg); max-width: 860px; margin: 0 auto; padding: 32px 16px 64px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact }
  a { color: var(--accent) }
  .cover { padding: 48px 0 32px; border-bottom: 4px solid var(--accent); margin-bottom: 24px }
  .cover .logo { max-height: 56px; max-width: 220px; display: block; margin-bottom: 32px }
  .cover h1 { font-size: 34px; line-height: 1.2; margin: 0 0 12px }
  .cover .subtitle { font-size: 19px; margin: 0 0 10px }
  .cover .meta { color: var(--muted); font-size: 15px }
  .toc h2 { font-size: 18px; border: 0; margin: 24px 0 8px; padding: 0 }
  .toc ol { margin: 0; padding-left: 22px } .toc a { color: inherit; text-decoration: none } .toc li { margin: 4px 0 }
  .keep { break-inside: avoid }
  h2 { font-size: 22px; margin: 40px 0 12px; padding-top: 16px; border-top: 1px solid var(--line); break-after: avoid }
  h3, h4, h5 { margin: 22px 0 8px; break-after: avoid }
  p, li { orphans: 3; widows: 3 }
  .text { color: var(--muted) }
  .look { margin: 18px 0 18px 50px; break-inside: avoid }
  .step { display: grid; grid-template-columns: 36px 1fr; gap: 14px; margin: 22px 0; break-inside: avoid }
  .n { width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; font-weight: 700; font-size: 15px }
  .step p { margin: 3px 0 10px }
  img.shot { max-width: 100%; border: 1px solid var(--line); border-radius: 10px; display: block }
  figure { margin: 18px 0; break-inside: avoid } figcaption { color: var(--muted); font-size: 14px; margin-top: 6px; text-align: center }
  code { background: var(--soft); padding: 1px 5px; border-radius: 4px; font-size: .9em }
  .note { border-left: 4px solid var(--accent); background: var(--soft); padding: 10px 16px; margin: 18px 0; border-radius: 0 8px 8px 0; break-inside: avoid }
  .note p { margin: 6px 0 } .note-ok { border-color: #16a34a } .note-warn { border-color: #d97706 }
  table { border-collapse: collapse; width: 100%; font-size: 14px } th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top }
  th { background: var(--soft) } tr { break-inside: avoid } thead { display: table-header-group }
  .gallery { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 14px; margin: 18px 0; align-items: start }
  .gallery figure { margin: 0 } .gallery img.shot { width: 100% }
  footer { margin-top: 48px; color: var(--muted); font-size: 13px }
  .cover .foot { display: none }
  @page { size: ${paper.width} ${paper.height}; margin: ${m.top}mm ${m.x}mm ${m.bottom}mm;
    ${boxes} }
  ${style === 'none' ? '' : `@page :first { margin: 0; ${none} }`}
  @media print {
    body { max-width: none; padding: 0; font-size: 11pt }
    ${printCover}
    h2 { margin-top: 18pt } h2:first-of-type { border-top: 0 }
    .break { break-after: page }
    /* A picture never runs past the page: tall ones (a phone) keep their shape and get narrower */
    img.shot { max-height: 165mm; width: auto; margin: 0 auto }
    .gallery img.shot { max-height: 120mm; width: 100%; object-fit: contain }
    footer { display: none }
  }
</style>
<header class="cover">${logo}<h1>${escapeHtml(title)}</h1>${subtitle}<div class="meta">${steps ? `${escapeHtml(words.steps(steps))} · ` : ''}${escapeHtml(date)}</div>${contents}<div class="foot">${escapeHtml(foot)}</div></header>
${body}
<footer>${escapeHtml(made)}</footer>
</html>
`
}

/** The footer for a Chromium older than 131 (no @page margin boxes): on every page, the cover too. Inline styles only. */
export const footerTemplate = (title, accent) =>
  `<div style="font:8px system-ui,sans-serif;color:#5d6475;width:100%;padding:0 15mm;display:flex;justify-content:space-between">` +
  `<span>${escapeHtml(title)}</span><span><b style="color:${cssValue(pageAccent(accent ?? '#4f46e5'))}" class="pageNumber"></b> / <span class="totalPages"></span></span></div>`
