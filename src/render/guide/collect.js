// `tourwright guide`: before each step, its element marked and the page captured; the text from the narration.
// The content steps (`md`, `note`, `table`, `shot`, `gallery`, `pageBreak`) become entries of their own.
import { guideEntry } from './write.js'
import { resolveTarget } from '#render/steps/targets.js'

// Tourwright's own layers (caption, cursor, title card, focus…) and the blinking text cursor stay out of the picture
const CLEAN = '#tw-caption, #tw-cursor, #tw-ripple, #tw-title, .tw-frame, .tw-spot, .tw-callout, .tw-focus, .tw-ring, .tw-step { display: none !important } * { caret-color: transparent !important }'

/**
 * Hooks `v.onStep` and `v.document` so the guide is collected while the script runs (fast, like a dry run).
 * @param {import('playwright').Page} page @param {Record<string, any>} v @param {string | undefined} language
 * @param {{ marks?: boolean, phone?: boolean }} [options]  marks: the element of each step marked (default true)
 * @returns {any[]} the entries, filled as the steps run
 */
export const collectGuide = (page, v, language, { marks = true, phone = false } = {}) => {
  const guide = []
  /**
   * The page now, without Tourwright's own layers. `mark`: a target to frame; `element`: only that element;
   * `fullPage`: all of it.
   * @param {{ mark?: any, element?: any, fullPage?: boolean }} what
   */
  const capture = async ({ mark, element, fullPage = false }) => {
    const find = async t => (t === undefined ? null : await resolveTarget(page, t, 5000).catch(() => null))
    const marked = marks ? await find(mark) : null
    const box = marked && (await marked.first().scrollIntoViewIfNeeded().then(() => marked.first().boundingBox()).catch(() => null))
    await page.evaluate(([box, css]) => {
      const style = document.createElement('style')
      style.id = 'tw-guide-style'
      style.textContent = css
      document.documentElement.append(style)
      if (!box) return
      const frame = document.createElement('div')
      frame.id = 'tw-guide-mark'
      frame.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${box.x - 6}px;top:${box.y - 6}px;width:${box.width + 12}px;height:${box.height + 12}px;border:3px solid #e11d48;border-radius:10px;box-shadow:0 0 0 4000px rgba(0,0,0,.12)`
      document.documentElement.append(frame)
    }, [box, CLEAN]).catch(() => {})
    const only = await find(element)
    const image = await (only ? only.first().screenshot({ type: 'jpeg', quality: 80 }) : page.screenshot({ type: 'jpeg', quality: 80, fullPage })).catch(() => undefined)
    await page.evaluate(() => {
      document.getElementById('tw-guide-mark')?.remove()
      document.getElementById('tw-guide-style')?.remove()
    }).catch(() => {})
    return image
  }
  const shoot = target => capture({ mark: target })

  v.onStep = async step => {
    const entry = guideEntry(step, language)
    if (!entry) return
    // Which step of the script it is (`tourwright narrate` writes back to it)
    entry.step = v.step
    const previous = guide.at(-1)
    // A focus on a field, then typing in it: one step of the guide, with what to type
    if ((step.type || step.fill) && previous?.merge && JSON.stringify(previous.target) === JSON.stringify(entry.target)) {
      previous.detail = entry.example
      previous.merge = false
      return
    }
    // Something only shown (a highlight, a zoom): its picture goes with the paragraph before, or alone
    if (entry.kind === 'look') {
      if (previous?.kind === 'text' && !previous.image) {
        previous.image = await shoot(entry.target)
        return
      }
      guide.push({ kind: 'text', text: entry.text, image: await shoot(entry.target) })
      return
    }
    if (entry.kind === 'step') entry.image = await shoot(entry.target)
    guide.push(entry)
  }

  // The content steps, run by render/steps when a guide is being made
  v.document = async (action, arg) => {
    switch (action) {
      case 'md': return void guide.push({ kind: 'md', md: arg })
      case 'note': return void guide.push(typeof arg === 'string' ? { kind: 'note', md: arg, tone: 'info' } : { kind: 'note', md: arg.md, tone: arg.tone ?? 'info' })
      case 'table': return void guide.push({ kind: 'table', columns: arg.columns, rows: arg.rows.map(r => r.map(String)), caption: arg.caption })
      case 'pageBreak': return void guide.push({ kind: 'break' })
      case 'shot': {
        const a = arg === true ? {} : arg
        return void guide.push({ kind: 'shot', name: a.name, caption: a.caption, image: await capture({ element: a.target, fullPage: a.fullPage }) })
      }
      case 'gallery': {
        const items = []
        // The steps after a gallery run on the page before it, as in a video (which skips the gallery)
        const back = page.url()
        for (const s of arg.shots) {
          if (s.goto) await v.goto(s.goto)
          items.push({ caption: s.caption, image: await capture({ element: s.target, fullPage: s.fullPage }) })
        }
        if (page.url() !== back) await v.goto(back)
        return void guide.push({ kind: 'gallery', columns: arg.columns ?? (phone ? 4 : 3), items })
      }
    }
  }
  return guide
}
