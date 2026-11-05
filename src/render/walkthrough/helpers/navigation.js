// Going somewhere and moving around the page: pages, scrolling, pauses, the cursor, what is cut or blurred.
import { UserError } from '#core/util.js'

/** @param {import('#render/walkthrough/stage.js').Stage} s @param {Record<string, any>} v the helpers, for the ones each step calls */
export const navigationHelpers = (s, v) => {
  const { page, clock, resolveUrl, settle } = s
  return {
    goto: async path => {
      await page.goto(resolveUrl(path), { waitUntil: 'domcontentloaded' }).catch(error => {
        if (/ERR_BLOCKED_BY_CLIENT/.test(error.message)) throw new UserError(`${path}: blocked by the network policy of this server (TOURWRIGHT_ALLOWED_HOSTS / TOURWRIGHT_BLOCK_PRIVATE)`)
        throw error
      })
      await settle()
    },
    back: async () => {
      await page.goBack({ waitUntil: 'domcontentloaded' })
      await settle()
    },
    reload: async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await settle()
    },
    scrollTo: async locator => {
      await locator.first().evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      await clock.wait(900)
    },
    scroll: async dy => {
      await page.evaluate(dy => window.scrollBy({ top: dy, behavior: 'smooth' }), dy)
      await clock.wait(900)
    },
    pause: ms => clock.wait(ms),
    // What happens inside `fn` is cut from the video: wait minutes without boring anyone
    offCamera: fn => clock.offCamera(fn),
    cursor: async visible => {
      s.state.cursorHidden = !visible
      await page.evaluate(hidden => document.documentElement.classList.toggle('tw-no-cursor', hidden), s.state.cursorHidden)
    },
    blur: locator => locator.evaluateAll(els => els.forEach(el => el.classList.add('tw-blur'))),
    // A safe dry run: the element is found and could be used, but nothing is pressed
    skipped: [],
    skip: async (action, locator = null) => {
      if (locator) await s.center(locator, ['click', 'check', 'uncheck', 'select', 'type', 'fill'].includes(action))
      v.skipped.push({ step: v.step, action })
      // What comes after it may never show up (nothing was pressed): later steps look briefly, not 5 s each
      s.onSkip()
    },
  }
}
