// A look at the video before anyone else sees it: what went wrong on the page while it was filmed (a
// JavaScript error, a 500, a click that changed nothing, a page too small to read or wider than the video,
// a caption over the element shown) and what the finished video shows (a blank or black screen for more than
// a second, a long stretch with nothing to hear). Each finding names its step; none of them stops the render.
import { log, run } from '../util.js'

/**
 * @typedef {{ kind: 'page-error' | 'http' | 'no-effect' | 'blank' | 'silence' | 'caption' | 'layout', message: string, step?: number, at?: number }} Finding
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

// Text under this share of the video height is hard to read on a phone: 16 px is 1.5 % of a 1080 p video
const SMALL_TEXT = 0.011

/**
 * How the page fits the video: text too small to read (a desktop layout filmed for a phone) and content
 * wider than the screen (cut at the right). Once per address.
 * @param {import('playwright').Page} page @param {{ density: number, height: number }} video
 * @returns {Promise<string[]>}
 */
export const checkLayout = (page, video) =>
  page
    .evaluate(({ density, height, small }) => {
      const problems = []
      const root = document.documentElement
      // The page as laid out, without our camera: a zoom moves it past the edges on purpose. Put back before the
      // next frame is drawn
      const kids = /** @type {HTMLElement[]} */ ([...(document.body?.children ?? [])])
      const before = kids.map(k => [k.style.transform, k.style.transition])
      for (const k of kids) Object.assign(k.style, { transition: 'none', transform: '' })
      const cut = root.scrollWidth - root.clientWidth
      if (cut > 4) problems.push(`the page is ${cut} px wider than the video: the right side is cut off (a fixed width, or a layout for a bigger screen)`)
      // The size most visible text is drawn at: the median over text nodes in view, weighted by length
      const sizes = []
      const walker = document.createTreeWalker(document.body ?? root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n && sizes.length < 400; n = walker.nextNode()) {
        const text = n.textContent?.trim()
        const el = n.parentElement
        if (!text || !el || el.closest('[id^="tw-"], [class*="tw-"]')) continue
        const r = el.getBoundingClientRect()
        if (!r.width || r.bottom < 0 || r.top > innerHeight) continue
        const px = Number.parseFloat(getComputedStyle(el).fontSize)
        for (let i = 0; i < Math.min(20, Math.ceil(text.length / 10)); i++) sizes.push(px)
      }
      if (sizes.length >= 10) {
        sizes.sort((a, b) => a - b)
        const median = sizes[Math.floor(sizes.length / 2)]
        const share = (median * density) / height
        if (share < small) problems.push(`the text is ${Math.round(median * density)} px tall in a ${height} px video: too small to read (set \`scale: 2\`, or film the page's mobile layout)`)
      }
      kids.forEach((k, i) => {
        k.style.transform = before[i][0]
        void k.offsetWidth
        k.style.transition = before[i][1]
      })
      return problems
    }, { ...video, small: SMALL_TEXT })
    .catch(() => [])

const SPANS = /black_start:([\d.]+)\s+black_end:([\d.]+)/g

/**
 * Blank (white) and black screens of a second or more in the finished video and, when it is narrated, long
 * stretches with nothing to hear.
 * @param {string} file @param {{ ffmpeg?: string }} config @param {{ narrated?: boolean }} [opts]
 * @returns {Promise<Finding[]>}
 */
export const reviewVideo = async (file, config, { narrated = true } = {}) => {
  if (!config.ffmpeg) return []
  // Nearly every pixel near pure black, or near pure white once the picture is inverted. A small grey picture
  // at 10 fps says the same, and both passes run at once
  const look = [['black', 'blackdetect=d=1:pix_th=0.03:pic_th=0.995'], ['blank (white)', 'negate,blackdetect=d=1:pix_th=0.03:pic_th=0.995']]
  const found = await Promise.all(look.map(async ([what, filter]) => {
    // blackdetect reports at the info level, on stderr
    const { stderr } = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `fps=10,scale=320:-2,format=gray,${filter}`, '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 })
      .catch(error => ({ stderr: String(error.stderr ?? '') }))
    return [...String(stderr ?? '').matchAll(SPANS)].map(m => {
      const [start, end] = [Number(m[1]), Number(m[2])]
      return /** @type {Finding} */ ({ kind: 'blank', at: start, message: `the screen is ${what} from ${start.toFixed(1)} s to ${end.toFixed(1)} s` })
    })
  }))
  return [...found.flat(), ...(narrated ? await silences(file, config) : [])]
}

const QUIET = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g

/**
 * Long stretches with nothing to hear: no voice, no sound, no music. A pause to read a note or watch a field
 * fill takes 3–5 s; 6 s of nothing feels like the video stopped (a slow page or a long search filmed whole).
 * @returns {Promise<Finding[]>}
 */
export const silences = async (file, config, seconds = 6) => {
  const { stderr } = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=n=-45dB:d=${seconds}`, '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 })
    .catch(error => ({ stderr: String(error.stderr ?? '') }))
  // A video with no sound at all has no audio stream: nothing to say about it
  const out = String(stderr ?? '')
  if (!/Audio:/.test(out)) return []
  // A quiet opening or closing card (the title, the logo at the end) is on purpose
  const [, h = '0', min = '0', sec = '0'] = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(out) ?? []
  const duration = Number(h) * 3600 + Number(min) * 60 + Number(sec)
  return [...out.matchAll(QUIET)].flatMap(m => {
    const [start, end] = [Number(m[1]), Number(m[2])]
    if (start < 0.3 || (duration && end > duration - 0.3)) return []
    return /** @type {Finding} */ ({ kind: 'silence', at: start, message: `nothing is heard from ${start.toFixed(1)} s to ${end.toFixed(1)} s (a slow page or search filmed whole? a long \`ms\`?)` })
  })
}

/** Says each finding once, with its step */
export const reportFindings = findings => {
  for (const f of findings) log.warn(`review: ${f.step ? `step ${f.step}: ` : ''}${f.message}`)
}
