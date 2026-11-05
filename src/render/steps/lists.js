// Lists that are not a <select>: opened with a click, narrowed by typing into the field they bring, the option
// picked by its text. Shared by the filmed helpers (walkthrough/helpers/pointer.js) and the quick ones (quick.js).
import { sleep, UserError } from '#core/util.js'

// A list of its own (React Select, MUI, Ant, a search box over a list of cities…) rather than a <select>: opened
// with a click, narrowed by typing, the option picked by its text. Shared by the filmed and the quick helpers.
export const isNativeSelect = l => l.evaluate(el => el.tagName === 'SELECT').catch(() => false)

// Fields on screen before the list opens: the search box is the one that shows up with it
const FIELDS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=""], [contenteditable=true]'
export const markFields = page => page.evaluate(sel => {
  const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  window.__twFields = new WeakSet([...document.querySelectorAll(sel)].filter(shown))
}, FIELDS).catch(() => {})

/** The field the search is typed into once the list is open: the one it focused, the list itself, or the one it brought */
export const listSearch = async (page, list) => {
  const editable = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)
  if (await list.evaluate(editable).catch(() => false)) return list
  // A list that opens with an animation brings its field a moment later
  for (let i = 0; i < 8; i++) {
    const focused = page.locator(':focus')
    if (await focused.evaluate(editable).catch(() => false)) return focused
    const found = await page.evaluate(sel => {
      const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
      const seen = window.__twFields ?? new WeakSet()
      const fresh = [...document.querySelectorAll(sel)].filter(el => shown(el) && !seen.has(el))
      for (const el of document.querySelectorAll('[data-tw-search]')) el.removeAttribute('data-tw-search')
      fresh.at(-1)?.setAttribute('data-tw-search', '')
      return fresh.length > 0
    }, FIELDS).catch(() => false)
    if (found) return page.locator('[data-tw-search]')
    await sleep(150)
  }
  throw new UserError(`the list ${list} opened without a search field to type into: leave \`search\` out, or \`type\` into the field first`)
}

/** The option by its text, or part of it, among the visible ones */
export const listOption = (page, text, shown = text) => {
  const one = t => page.getByRole('option', { name: t }).or(page.getByText(t, { exact: true }))
  return (shown === text ? one(text) : one(text).or(one(shown))).filter({ visible: true }).first()
}

/** When the option never shows up: what the list offers instead */
export const missingOption = async (page, text, error) => {
  if (error?.name !== 'TimeoutError') throw error
  const offered = await page.getByRole('option').filter({ visible: true }).allInnerTexts().catch(() => [])
  const list = offered.map(t => t.trim()).filter(Boolean).slice(0, 12)
  throw new UserError(`the option "${text}" did not show up in the list${list.length ? `; it offers: ${list.map(t => `"${t}"`).join(', ')}` : ''}`)
}
