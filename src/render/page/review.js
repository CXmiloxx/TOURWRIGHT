// What goes wrong on the page while it is filmed: a JavaScript error, a 500, a click that changed nothing, a page
// too small to read or wider than the video. The findings join the video's own (video/review.js).

/** @typedef {import('#video/review.js').Finding} Finding */


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
