// `mask`: real data on screen (emails, phone numbers, ID numbers, names) is replaced by invented data in the
// page itself, so a video made on a real account shows nothing personal, and stays readable (blurring hides,
// masking keeps the screen natural). The same real value always becomes the same invented one, on every page
// of the video. What the page sends and receives is not changed: only what is drawn, and never the value of a
// field that can be edited (a form would send the invented value).
import { z } from 'zod'

// Built-in kinds: what each finds. `id` is a run of 6 to 12 digits, with or without dots (cédulas, DNI, NIT…)
export const MASK_KINDS = ['email', 'phone', 'id']

export const maskRule = z.union([
  z.enum(MASK_KINDS),
  z.object({ text: z.string().min(1), as: z.string() }).strict(),
  z.object({ pattern: z.string().min(1), as: z.string().optional(), flags: z.string().regex(/^[imsu]*$/).optional() }).strict(),
])

/**
 * Runs in the page: replaces the matches in every text and every field that is not being typed in, now and
 * whenever the page changes.
 * @param {(string | { text?: string, pattern?: string, as?: string, flags?: string })[]} rules
 */
export const maskInPage = rules => {
  // An amount ($ 1.250.000, € 300) is not personal: a number right after a currency sign is left alone
  const MONEY = String.raw`(?<![$€£¥₡₲₱₹]\s?)`
  const KINDS = {
    email: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu,
    phone: new RegExp(String.raw`${MONEY}(?<![\d.])(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{4}(?![\d.])`, 'g'),
    id: new RegExp(String.raw`${MONEY}(?<![\d.,])\d{1,3}(?:\.\d{3}){1,3}(?![\d.,])|${MONEY}(?<![\d.,])\d{6,12}(?![\d.,])`, 'g'),
  }
  // A number from a text, always the same for the same text
  const seed = s => {
    let h = 2166136261
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
    return h
  }
  // Digits replaced by others (same length and layout), letters kept: the format still looks real
  const digits = s => {
    let h = seed(s)
    return s.replace(/\d/g, () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
      return String(h % 10)
    })
  }
  const NAMES = ['ana', 'luis', 'sofia', 'carlos', 'lucia', 'mateo', 'valeria', 'diego', 'camila', 'andres']
  const fake = {
    email: v => `${NAMES[seed(v) % NAMES.length]}${seed(v) % 97}@ejemplo.com`,
    phone: v => digits(v),
    id: v => digits(v),
  }
  // What was already invented is never masked again (a field looked at twice keeps one invented value)
  const invented = new Set()
  const keep = (v, next) => {
    if (invented.has(v)) return v
    invented.add(next)
    return next
  }
  const replacers = rules.map(rule => {
    if (typeof rule === 'string') return text => text.replace(KINDS[rule], v => keep(v, fake[rule](v)))
    if (rule.text !== undefined) return text => text.split(rule.text).join(rule.as)
    const re = new RegExp(rule.pattern, `g${(rule.flags ?? '').replace(/g/g, '')}`)
    return text => text.replace(re, v => keep(v, rule.as ?? digits(v)))
  })
  const apply = text => replacers.reduce((t, r) => r(t), text)

  const masked = new WeakMap()
  const maskNode = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.nodeValue?.trim() || masked.get(node) === node.nodeValue) return
      const next = apply(node.nodeValue)
      masked.set(node, next)
      if (next !== node.nodeValue) node.nodeValue = next
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = /** @type {Element} */ (node)
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return
    // Only a field nobody can edit (read-only or disabled) has its value replaced: an editable field keeps its
    // real value, or a form sent later would carry the invented one (a login that fails, a record saved with
    // fake data). Blur those instead.
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && (el.readOnly || el.disabled) && el.value) {
      const next = apply(el.value)
      if (next !== el.value) el.value = next
    }
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(attr)
      if (v) {
        const next = apply(v)
        if (next !== v) el.setAttribute(attr, next)
      }
    }
    for (const child of el.childNodes) maskNode(child)
    if (el.shadowRoot) for (const child of el.shadowRoot.childNodes) maskNode(child)
  }
  const start = () => {
    maskNode(document.documentElement)
    new MutationObserver(changes => {
      for (const c of changes) {
        if (c.type === 'characterData') maskNode(c.target)
        else for (const n of c.addedNodes) maskNode(n)
        if (c.type === 'attributes' && c.target.nodeType === Node.ELEMENT_NODE) maskNode(c.target)
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'value'] })
    // Values set by scripts do not fire mutations: fields are looked at again now and then
    setInterval(() => {
      for (const el of document.querySelectorAll('input, textarea')) maskNode(el)
    }, 500)
  }
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
