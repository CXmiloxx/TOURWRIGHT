// A look at the video before anyone else sees it: what went wrong on the page while it was filmed (a
// JavaScript error, a 500, a click that changed nothing) and what the finished video shows (a blank or
// black screen for more than a second). Each finding names its step; none of them stops the render.
import { log, run } from '../util.js'

/**
 * @typedef {{ kind: 'page-error' | 'http' | 'no-effect' | 'blank', message: string, step?: number, at?: number }} Finding
 */

/**
 * Listens to the page while it is filmed.
 * @param {import('playwright').Page} page
 * @param {() => number | undefined} currentStep
 */
export const watchPage = (page, currentStep) => {
  /** @type {Finding[]} */
  const findings = []
  const seen = new Set()
  const add = finding => {
    const key = `${finding.kind}|${finding.message}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ ...finding, step: currentStep() })
  }
  page.on('pageerror', error => add({ kind: 'page-error', message: `the page threw: ${String(error.message).split('\n')[0].slice(0, 200)}` }))
  page.on('response', response => {
    const status = response.status()
    const document = response.request().resourceType() === 'document'
    if (status >= 500 || (document && status >= 400)) add({ kind: 'http', message: `${status} from ${response.url().slice(0, 200)}` })
  })
  return { findings, add }
}

// Our own layers (cursor, ripples, captions, focus) change the page too: they do not count as an effect
const PROBE = () => {
  const ours = n => {
    for (let e = n.nodeType === 1 ? n : n.parentElement; e; e = e.parentElement) {
      if (e.id?.startsWith('tw-') || [...(e.classList ?? [])].some(c => c.startsWith('tw-'))) return true
    }
    return false
  }
  window.__twChanges = 0
  window.__twProbe?.disconnect()
  window.__twProbe = new MutationObserver(list => {
    for (const m of list) if (!ours(m.target)) window.__twChanges++
  })
  window.__twProbe.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
}

/**
 * Wraps a click: true when it changed something on the page (or took it somewhere else).
 * A click on a field only focuses it: that is never reported.
 * @param {import('playwright').Page} page @param {import('playwright').Locator} locator @param {() => Promise<void>} click
 */
export const clickWithEffect = async (page, locator, click) => {
  const field = await locator.evaluate(el => ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'LABEL'].includes(el.tagName) || (el instanceof HTMLElement && el.isContentEditable)).catch(() => true)
  if (field) return void (await click())
  const url = page.url()
  await page.evaluate(PROBE).catch(() => {})
  await click()
  if (page.url() !== url) return true
  // A navigation that just started destroys the page: that is an effect too
  const changes = await page.evaluate(() => window.__twChanges ?? 0).catch(() => 1)
  return changes > 0
}

const SPANS = /black_start:([\d.]+)\s+black_end:([\d.]+)/g

/**
 * Blank (white) and black screens of a second or more in the finished video.
 * @returns {Promise<Finding[]>}
 */
export const reviewVideo = async (file, config) => {
  const findings = []
  // Nearly every pixel near pure black, or near pure white once the picture is inverted
  for (const [what, filter] of [['black', 'blackdetect=d=1:pix_th=0.03:pic_th=0.995'], ['blank (white)', 'negate,blackdetect=d=1:pix_th=0.03:pic_th=0.995']]) {
    if (!config.ffmpeg) return findings
    // blackdetect reports at the info level, on stderr
    const { stderr } = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', filter, '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 })
      .catch(error => ({ stderr: String(error.stderr ?? '') }))
    for (const m of String(stderr ?? '').matchAll(SPANS)) {
      const [start, end] = [Number(m[1]), Number(m[2])]
      findings.push({ kind: 'blank', at: start, message: `the screen is ${what} from ${start.toFixed(1)} s to ${end.toFixed(1)} s` })
    }
  }
  return findings
}

/** Says each finding once, with its step */
export const reportFindings = findings => {
  for (const f of findings) log.warn(`review: ${f.step ? `step ${f.step}: ` : ''}${f.message}`)
}
