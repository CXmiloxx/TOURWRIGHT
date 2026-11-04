// The mouse on camera: it travels to each element instead of jumping.
import { UserError } from '../util.js'

// How long the cursor takes to reach an element (ms): a short hop and the longest way across the screen
export const MOVE_MIN = 280
export const MOVE_MAX = 650

/** @param {import('playwright').Page} page @param {{ width: number, height: number, dryRun: boolean }} options */
export const createCursor = (page, { width, height, dryRun }) => {
  let at = { x: width / 2, y: height / 2 }
  return {
    get position() {
      return at
    },
    // Ease-in-out, like a hand: starts soft, speeds up, brakes on arrival. The glide takes a set time (longer for
    // a longer way), not a set number of moves: each move waits for the page to take it, and on a heavy page
    // (a long list with hover styles, a server without GPU) 60 moves took seconds of silence. A slow page gets
    // fewer, bigger moves in the same time.
    moveTo: async (x, y) => {
      const from = at
      at = { x, y }
      const distance = Math.hypot(x - from.x, y - from.y)
      if (dryRun || distance < 2) return void (await page.mouse.move(x, y))
      const duration = Math.min(MOVE_MAX, Math.max(MOVE_MIN, distance * 0.9))
      const start = Date.now()
      for (;;) {
        const t = Math.min(1, (Date.now() - start) / duration)
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
        if (t >= 1) break
        await page.waitForTimeout(12)
      }
    },
    // Puts the cursor back after a navigation (the new page does not know where it was)
    restore: () => page.mouse.move(at.x, at.y),
  }
}

// Scrolls the element to the middle of the screen when it is not already in view, and returns its center and size.
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
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height }
}
