// `tourwright guide`: before each step, its element marked and the page captured; the text from the narration.
import { guideEntry } from './write.js'
import { resolveTarget } from '#render/steps/targets.js'

/**
 * Hooks `v.onStep` so the guide is collected while the script runs (fast, like a dry run).
 * @param {import('playwright').Page} page @param {Record<string, any>} v @param {string | undefined} language
 * @returns {any[]} the entries, filled as the steps run
 */
export const collectGuide = (page, v, language) => {
  const guide = []
  // The page now, with the element marked, without Tourwright's own caption and cursor
  const shoot = async target => {
    const locator = target === undefined ? null : await resolveTarget(page, target, 5000).catch(() => null)
    const box = locator && (await locator.first().scrollIntoViewIfNeeded().then(() => locator.first().boundingBox()).catch(() => null))
    await page.evaluate(box => {
      // Tourwright's own layers (caption, cursor, title card, focus…) stay out of the picture
      const style = document.createElement('style')
      style.id = 'tw-guide-style'
      style.textContent = '#tw-caption, #tw-cursor, #tw-ripple, #tw-title, .tw-frame, .tw-spot, .tw-callout, .tw-focus, .tw-ring, .tw-step { display: none !important }'
      document.documentElement.append(style)
      if (!box) return
      const mark = document.createElement('div')
      mark.id = 'tw-guide-mark'
      mark.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${box.x - 6}px;top:${box.y - 6}px;width:${box.width + 12}px;height:${box.height + 12}px;border:3px solid #e11d48;border-radius:10px;box-shadow:0 0 0 4000px rgba(0,0,0,.12)`
      document.documentElement.append(mark)
    }, box).catch(() => {})
    const image = await page.screenshot({ type: 'jpeg', quality: 80 }).catch(() => undefined)
    await page.evaluate(() => {
      document.getElementById('tw-guide-mark')?.remove()
      document.getElementById('tw-guide-style')?.remove()
    }).catch(() => {})
    return image
  }
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
  return guide
}
