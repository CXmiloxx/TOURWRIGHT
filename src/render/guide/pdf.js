// `tourwright guide --pdf`: the guide's HTML printed by Chromium as a PDF to hand over: A4, the brand's colors,
// a cover, bookmarks from the sections, a footer with «page / pages» and tags for screen readers.
import { readFileSync } from 'node:fs'
import { launchChromium } from '#render/browser/chromium.js'
import { footerTemplate } from './layout.js'
import { reviewGuide, weightFinding } from './review.js'

/**
 * @param {{ html: string, out: string, title: string, accent?: string, paper?: string, footer?: string, header?: boolean, signal?: AbortSignal }} guide  the guide's HTML file and where the PDF goes
 * @param {Record<string, any>} config
 * @returns {Promise<{ path: string, pages: number, review: { kind: string, message: string }[] }>}
 */
export const printGuide = async ({ html, out, title, accent, paper = 'A4', footer, header = true, signal }, config) => {
  // Its own headless browser: printing works only there, whatever the recording used
  const browser = await launchChromium(config, { headless: true, args: ['--font-render-hinting=none'] })
  // The job's time limit closes it: the print in progress fails instead of going on unseen
  const close = () => browser.close().catch(() => {})
  signal?.addEventListener('abort', close, { once: true })
  try {
    if (signal?.aborted) throw new Error('stopped before printing')
    // The guide is static: no script runs and nothing is fetched. Its pictures and logo are inside the HTML (data
    // URLs), so a request to anywhere else can only come from text that should not be there
    const context = await browser.newContext({ javaScriptEnabled: false })
    await context.route('**/*', route => (route.request().url().startsWith('data:') ? route.continue() : route.abort()))
    const page = await context.newPage()
    await page.setContent(readFileSync(html, 'utf8'), { waitUntil: 'load' })
    await page.emulateMedia({ media: 'print' })
    await page.evaluate(() => document.fonts.ready)
    // Laid out at the width of the paper's text (less 15 mm a side), so the review measures what prints
    await page.setViewportSize({ width: Math.round(((paper === 'Letter' ? 215.9 : 210) - 30) * (96 / 25.4)), height: 1000 })
    const review = await reviewGuide(page, { paper, accent, header })
    // Chromium 131+ draws the footer from the page's CSS (@page margin boxes), the cover without one; older
    // ones need the footer template, on every page
    const marginBoxes = Number(browser.version().split('.')[0]) >= 131
    const pdf = await page.pdf({
      path: out,
      preferCSSPageSize: true,
      printBackground: true,
      ...(marginBoxes ? {} : { displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footerTemplate(footer ?? title, accent) }),
      outline: true,
      tagged: true,
    })
    return { path: out, pages: countPages(pdf), review: [...review, ...weightFinding(pdf.length)] }
  } finally {
    signal?.removeEventListener('abort', close)
    await close()
  }
}

/** How many pages a PDF has (its /Type /Page objects; /Pages is the tree that holds them) */
export const countPages = pdf => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
