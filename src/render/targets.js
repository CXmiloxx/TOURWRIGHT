// Finding the element a step names, and saying clearly what went wrong when it is not there.
//
// `{ label: X }` falls back when no field is linked to that label: many apps wrap the input to add an icon
// and the <label> no longer points at it. Then the placeholder X, a textbox named X, or the first field
// after the visible text X is used, with a warning naming the target that would match directly.
import { log } from '../util.js'
import { locate } from './steps.js'

const quote = s => JSON.stringify(String(s))

// YAML splits an unquoted flow value at a comma or a colon (the "Unrecognized keys" mistake): those are quoted
const needsQuotes = v => /[,:{}[\]#&*!|>'"%@`]|^\s|\s$|^$/.test(v)

/** A target the way a script writes it: { placeholder: Tu usuario o tu correo } */
export const asTarget = target =>
  `{ ${Object.entries(target).map(([k, v]) => `${k}: ${typeof v === 'string' && needsQuotes(v) ? JSON.stringify(v) : v}`).join(', ')} }`

/** A target of a script as a person would say it */
export const describeTarget = t => {
  if (typeof t === 'string') return `the element matching ${quote(t)}`
  const nth = t.nth !== undefined ? ` (number ${t.nth + 1})` : ''
  if (t.role) return `the ${t.role}${t.name ? ` named ${quote(t.name)}` : ''}${nth}`
  if (t.label) return `the field labelled ${quote(t.label)}${nth}`
  if (t.placeholder) return `the field with placeholder ${quote(t.placeholder)}${nth}`
  if (t.testId) return `the element with test id ${quote(t.testId)}${nth}`
  if (t.text) return `the text ${quote(t.text)}${nth}`
  return `the element matching ${quote(t.css)}${nth}`
}

const warned = new WeakMap()

const FIELD = 'xpath=following::*[self::input[not(@type="hidden")] or self::textarea or self::select][1]'

/**
 * The locator for a target, after waiting up to `timeout` for it to show up.
 * @param {import('playwright').Page} page
 * @param {any} t
 * @param {number} timeout
 */
export const resolveTarget = async (page, t, timeout) => {
  const direct = locate(page, t)
  if (typeof t !== 'object' || !t.label || t.role || t.css || t.testId) return direct
  const exact = t.exact
  const nth = l => (t.nth !== undefined ? l.nth(t.nth) : l)
  const fallbacks = [
    ['placeholder', nth(page.getByPlaceholder(t.label, { exact })), { placeholder: t.label }],
    ['name', nth(page.getByRole('textbox', { name: t.label, exact })), { role: 'textbox', name: t.label }],
    ['visible text before it', nth(page.getByText(t.label, { exact }).first().locator(FIELD)), null],
  ]
  // Whichever shows up first; the page may still be loading
  await fallbacks.reduce((any, [, l]) => any.or(l), direct).first().waitFor({ state: 'attached', timeout }).catch(() => {})
  if (await direct.count().catch(() => 0)) return direct
  for (const [how, l, better] of fallbacks) {
    if (!(await l.count().catch(() => 0))) continue
    // The field found next to the text: its own placeholder targets it directly
    const placeholder = better ? null : await l.first().getAttribute('placeholder').catch(() => null)
    const own = better ?? (placeholder ? { placeholder } : null)
    // Said once per page and label, not at every step that uses it
    const said = warned.get(page) ?? new Set()
    warned.set(page, said)
    if (!said.has(t.label)) {
      said.add(t.label)
      log.warn(`${asTarget({ label: t.label })}: no field is linked to that label; used the field found by its ${how}` +
        (own ? `. Write ${asTarget(own)} to target it directly` : ''))
    }
    return l
  }
  const error = new Error(`Timeout ${timeout}ms exceeded waiting for ${describeTarget(t)}`)
  error.name = 'TimeoutError'
  throw error
}

/**
 * The fields, buttons and links on screen, each with the target that finds it and where it is
 * @returns {Promise<{ target: Record<string, string>, kind: 'field' | 'button' | 'link', hint: string, rect: { x: number, y: number, width: number, height: number } }[]>}
 */
export const offeredElements = page =>
  page
    .evaluate(() => {
      const visible = el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      }
      const clean = s => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
      const rectOf = el => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      const out = []
      for (const el of document.querySelectorAll('input:not([type=hidden]), textarea, select')) {
        if (!visible(el)) continue
        // The label's own words, without the field it wraps (a <select> inside it would add every option)
        const own = [...(/** @type {HTMLInputElement} */ (el).labels ?? [])].map(l => [...l.childNodes].filter(n => n !== el && !n.contains?.(el)).map(n => n.textContent).join(' '))
        const label = clean(own.join(' ') || el.getAttribute('aria-label'))
        const placeholder = clean(el.getAttribute('placeholder'))
        // The visible text just before the field: what a person calls it when the label is not linked
        let hint = ''
        for (let n = el.parentElement; n && !hint && n !== document.body; n = n.parentElement) hint = clean(n.previousElementSibling?.textContent)
        const target = label ? { label } : placeholder ? { placeholder } : el.getAttribute('name') ? { css: `[name="${el.getAttribute('name')}"]` } : null
        if (target) out.push({ target, kind: 'field', hint: [label, placeholder, hint].filter(Boolean).join(' '), rect: rectOf(el) })
      }
      for (const el of document.querySelectorAll('button, [role=button], input[type=submit], a[href]')) {
        if (!visible(el)) continue
        const name = clean(el.getAttribute('aria-label') || el.textContent || el.getAttribute('value'))
        const kind = el.tagName === 'A' ? 'link' : 'button'
        if (name) out.push({ target: { role: kind, name }, kind, hint: name, rect: rectOf(el) })
      }
      return out
    })
    .catch(() => [])

/** What a script could target on the page now: fields, buttons and links, as targets to paste */
export const pageInventory = async page => {
  const seen = new Set()
  return (await offeredElements(page)).map(e => asTarget(e.target)).filter(s => !seen.has(s) && seen.add(s)).slice(0, 15)
}

/** Marks on the page what a script could target, for the screenshot of a failure */
export const markOffered = async page => {
  const items = (await offeredElements(page)).slice(0, 30).map(e => ({ text: asTarget(e.target), rect: e.rect }))
  await page
    .evaluate(items => {
      const layer = document.createElement('div')
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:12px/1.3 system-ui,sans-serif'
      for (const { text, rect } of items) {
        const box = document.createElement('div')
        box.style.cssText = `position:fixed;left:${rect.x - 2}px;top:${rect.y - 2}px;width:${rect.width + 4}px;height:${rect.height + 4}px;outline:2px solid #e11d48;border-radius:4px`
        const tag = document.createElement('div')
        tag.textContent = text
        tag.style.cssText = `position:fixed;left:${rect.x}px;top:${Math.max(0, rect.y - 18)}px;background:#e11d48;color:#fff;padding:1px 5px;border-radius:3px;white-space:nowrap`
        layer.append(box, tag)
      }
      document.documentElement.append(layer)
    }, items)
    .catch(() => {})
}

// The targets a step names, to say which one was missing
export const targetsOf = (action, arg) => {
  if (arg === null || arg === undefined || typeof arg === 'number' || typeof arg === 'boolean') return []
  if (['goto', 'say', 'caption', 'title', 'chapter', 'press', 'scroll', 'pause', 'cursor', 'back', 'reload', 'sound', 'offCamera', 'try', 'if', 'wait'].includes(action)) return []
  if (typeof arg === 'string') return [arg]
  if (arg.from && arg.to) return [arg.from, arg.to]
  if ('target' in arg) return [arg.target]
  return [arg]
}

// Playwright's "waiting for an element" errors: a timeout, or an element that never became visible
export const isMissingElement = error =>
  error?.name === 'TimeoutError' ||
  /Timeout \d+ms exceeded|element is not visible|drop target is not visible|not attached to the DOM/.test(String(error?.message))
