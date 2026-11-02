// The mouse on camera: it travels to each element instead of jumping.
import { UserError } from '../util.js'

/** @param {import('playwright').Page} page @param {{ width: number, height: number, dryRun: boolean }} options */
export const createCursor = (page, { width, height, dryRun }) => {
  let at = { x: width / 2, y: height / 2 }
  return {
    get position() {
      return at
    },
    // Ease-in-out, like a hand: starts soft, speeds up, brakes on arrival
    moveTo: async (x, y) => {
      const from = at
      const steps = dryRun ? 1 : Math.max(18, Math.min(60, Math.round(Math.hypot(x - from.x, y - from.y) / 14)))
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
        if (!dryRun) await page.waitForTimeout(12)
      }
      at = { x, y }
    },
    // Puts the cursor back after a navigation (the new page does not know where it was)
    restore: () => page.mouse.move(at.x, at.y),
  }
}

// Scrolls the element to the middle of the screen when it is not already in view, and returns its center.
// Only a real scroll is waited for: an element on screen costs no time.
/** @param {import('playwright').Page} page @param {import('playwright').Locator} locator */
export const centerOf = async (page, locator, dryRun = false) => {
  const scrolled = await locator.evaluate(el => {
    const r = el.getBoundingClientRect()
    const margin = 40
    if (r.top >= margin && r.bottom <= innerHeight - margin && r.left >= 0 && r.right <= innerWidth) return false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  })
  if (scrolled) await page.waitForTimeout(dryRun ? 50 : 500)
  const box = await locator.boundingBox()
  if (!box) throw new UserError('element is not visible')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
