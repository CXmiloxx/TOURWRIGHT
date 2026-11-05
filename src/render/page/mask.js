// `mask`: real data on screen (emails, phone numbers, ID numbers, names) is replaced by invented data in the
// page itself, so a video made on a real account shows nothing personal, and stays readable (blurring hides,
// masking keeps the screen natural). The same real value always becomes the same invented one, on every page
// of the video. What the page sends and receives is not changed: only what is drawn, and never the value of a
// field that can be edited (a form would send the invented value).
//
// Steps still find elements by the real text: `window.__twMask(text)` says what a text looks like masked, and
// targets.js looks for both.
/**
 * Runs in the page: replaces the matches in every text and every field that is not being typed in, now and
 * whenever the page changes.
 * @param {(string | { text?: string, pattern?: string, as?: string, flags?: string })[]} rules
 */
export const maskInPage = rules => {
  // An amount ($ 1.250.000, € 300) is not personal: a number right after a currency sign is left alone
  const MONEY = String.raw`(?<![$€£¥₡₲₱₹]\s?)`
  const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre'
  const MONTHS_EN = 'january|february|march|april|may|june|july|august|september|october|november|december'
  const SHORT = 'ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic|jan|apr|aug|dec'
  const KINDS = {
    date: new RegExp([
      String.raw`(?<![\d.,/-])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2}))(?![\d/-])`,
      String.raw`\b\d{1,2}\s+de\s+(?:${MONTHS})(?:\s+(?:de|del)\s+\d{4})?\b`,
      String.raw`\b(?:${MONTHS_EN})\s+\d{1,2},?\s+\d{4}\b`,
      String.raw`\b\d{1,2}[\s-]+(?:${SHORT})\.?[\s-]+\d{4}\b`,
    ].join('|'), 'giu'),
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
  // Another date in the same format: day and month from 1 to 12 (valid read either way, dd/mm or mm/dd), the
  // year moved a few years, the month names kept
  const date = v => {
    let h = seed(v)
    const next = n => {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
      return h % n
    }
    const groups = v.match(/\d+/g) ?? []
    const numeric = !/\p{L}/u.test(v)
    return v.replace(/\d+/g, (g, offset) => {
      const last = offset + g.length === v.length
      if (g.length === 4 || (numeric && groups.length === 3 && last && g.length === 2 && groups[0].length !== 4)) {
        const year = (Number(g) + next(9) - 4 + 10000) % 10 ** g.length
        return String(year).padStart(g.length, '0')
      }
      const n = 1 + next(numeric ? 12 : 28)
      return String(n).padStart(g.length, '0')
    })
  }
  const fake = {
    date,
    email: v => `${NAMES[seed(v) % NAMES.length]}${seed(v) % 97}@ejemplo.com`,
    phone: v => digits(v),
    id: v => digits(v),
  }
  // What was already invented is never masked again (a field looked at twice keeps one invented value)
  const invented = new Set()
  // `record`: false to only see what a text would become (a step looking for it), without marking it as invented
  const keep = (v, next, record) => {
    if (invented.has(v)) return v
    if (record) invented.add(next)
    return next
  }
  const replacers = rules.map(rule => {
    if (typeof rule === 'string') return (text, record) => text.replace(KINDS[rule], v => keep(v, fake[rule](v), record))
    if (rule.text !== undefined) return text => text.split(rule.text).join(rule.as)
    const re = new RegExp(rule.pattern, `g${(rule.flags ?? '').replace(/g/g, '')}`)
    return (text, record) => text.replace(re, v => keep(v, rule.as ?? digits(v), record))
  })
  const apply = (text, record = true) => replacers.reduce((t, r) => r(t, record), text)
  /** @param {string} text */
  window.__twMask = text => apply(String(text), false)
  // A filled date field keeps its real value (a form sends it): it is blurred instead
  const dates = rules.includes('date')
  const DATE_FIELDS = 'input[type=date], input[type=datetime-local], input[type=month], input[type=week]'
  const blurDates = () => {
    if (!dates) return
    for (const el of document.querySelectorAll(DATE_FIELDS)) {
      const filled = Boolean(/** @type {HTMLInputElement} */ (el).value)
      if (filled && !el.classList.contains('tw-blur')) {
        el.classList.add('tw-blur')
        el.setAttribute('data-tw-masked', '')
      } else if (!filled && el.hasAttribute('data-tw-masked')) {
        el.classList.remove('tw-blur')
        el.removeAttribute('data-tw-masked')
      }
    }
  }

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
      blurDates()
    }, 250)
    document.addEventListener('input', blurDates, true)
    document.addEventListener('change', blurDates, true)
    blurDates()
  }
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
