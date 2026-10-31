// What Tourwright draws over the page while recording: title cards, captions, frames, spotlights, callouts
// and the zoom. The styles live in overlay.js; these functions only add, place and remove elements.

/** @typedef {{ x: number, y: number, width: number, height: number }} Box */

// `html` comes from titleHtml (theme.js): the same card as in slides, animated by the theme's CSS
/** @param {import('playwright').Page} page @param {string} html */
export const showTitle = (page, html) =>
  page.evaluate(html => {
    document.getElementById('tw-title')?.remove()
    document.body.insertAdjacentHTML('beforeend', html)
  }, html)

/** @param {import('playwright').Page} page */
export const hideTitle = page =>
  page.evaluate(() => {
    const t = document.getElementById('tw-title')
    if (!t) return
    t.classList.add('tw-out')
    setTimeout(() => t.remove(), 550)
  })

// An empty `html` removes the caption
/** @param {import('playwright').Page} page */
export const setCaption = (page, html) =>
  page.evaluate(html => {
    let c = document.getElementById('tw-caption')
    if (!html) return c?.remove()
    if (!c) {
      c = document.createElement('div')
      c.id = 'tw-caption'
      document.body.appendChild(c)
    }
    c.innerHTML = html
  }, html ?? '')

/** @param {import('playwright').Page} page @param {Box} box */
export const frame = (page, box, ms) =>
  page.evaluate(([b, ms]) => {
    const f = document.createElement('div')
    f.className = 'tw-frame'
    Object.assign(f.style, { left: `${b.x - 8}px`, top: `${b.y - 8}px`, width: `${b.width + 16}px`, height: `${b.height + 16}px` })
    document.body.appendChild(f)
    setTimeout(() => {
      f.style.opacity = '0'
      setTimeout(() => f.remove(), 300)
    }, ms)
  }, /** @type {const} */ ([box, ms]))

/** @param {import('playwright').Page} page @param {Box} box */
export const spotlight = (page, box, ms) =>
  page.evaluate(([b, ms]) => {
    const s = document.createElement('div')
    s.className = 'tw-spot'
    Object.assign(s.style, { left: `${b.x - 10}px`, top: `${b.y - 10}px`, width: `${b.width + 20}px`, height: `${b.height + 20}px` })
    document.body.appendChild(s)
    requestAnimationFrame(() => s.classList.add('tw-show'))
    setTimeout(() => {
      s.classList.remove('tw-show')
      setTimeout(() => s.remove(), 500)
    }, ms)
  }, /** @type {const} */ ([box, ms]))

/** @param {import('playwright').Page} page @param {Box} box */
export const callout = (page, box, html, ms, position) =>
  page.evaluate(([b, html, ms, position]) => {
    const c = document.createElement('div')
    c.className = 'tw-callout'
    c.innerHTML = html
    document.body.appendChild(c)
    const w = c.offsetWidth
    const h = c.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 16
    let side = position
    if (side === 'auto') side = b.y + b.height + gap + h < vh * 0.82 ? 'bottom' : b.y - gap - h > 0 ? 'top' : b.x + b.width + gap + w < vw ? 'right' : 'left'
    const clamp = (v, max) => Math.max(12, Math.min(v, max - 12))
    let left
    let top
    if (side === 'bottom' || side === 'top') {
      left = clamp(b.x + b.width / 2 - w / 2, vw - w)
      top = side === 'bottom' ? b.y + b.height + gap : b.y - gap - h
    } else {
      top = clamp(b.y + b.height / 2 - h / 2, vh - h)
      left = side === 'right' ? b.x + b.width + gap : b.x - gap - w
    }
    // The arrow points at the element's center even when the bubble is pushed aside
    c.style.setProperty('--tw-arrow', side === 'bottom' || side === 'top' ? `${b.x + b.width / 2 - left}px` : `${b.y + b.height / 2 - top}px`)
    c.classList.add(`tw-${side}`)
    Object.assign(c.style, { left: `${left}px`, top: `${top}px` })
    requestAnimationFrame(() => c.classList.add('tw-show'))
    setTimeout(() => {
      c.classList.remove('tw-show')
      setTimeout(() => c.remove(), 400)
    }, ms)
  }, /** @type {const} */ ([box, html, ms, position]))

// The camera: scales the page around an element and pans it toward the middle of the screen, never so far
// that an empty edge shows. 1 goes back. Tourwright's own layers (cursor, captions, focus) stay as they are.
/** @param {import('playwright').Locator} locator */
export const camera = (locator, value) =>
  locator.evaluate((el, value) => {
    const OURS = ['tw-frame', 'tw-spot', 'tw-callout', 'tw-focus', 'tw-ring']
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const vw = window.innerWidth
    const vh = window.innerHeight
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
    const tx = clamp(vw / 2 - cx, -(vw - cx) * (value - 1), cx * (value - 1))
    const ty = clamp(vh / 2 - cy, -(vh - cy) * (value - 1), cy * (value - 1))
    for (const child of /** @type {HTMLElement[]} */ ([...document.body.children])) {
      if (child.id?.startsWith('tw-') || OURS.some(c => child.classList.contains(c)) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue
      if (value === 1) {
        child.style.transform = ''
        continue
      }
      const b = child.getBoundingClientRect()
      // Ease out: fast start, long soft landing, like a camera operator
      child.style.transition = 'transform .85s cubic-bezier(.22,1,.36,1)'
      child.style.transformOrigin = `${cx - b.left}px ${cy - b.top}px`
      child.style.transform = `translate(${tx}px, ${ty}px) scale(${value})`
    }
  }, value)

/**
 * Onboarding-style focus: everything dims except the element, a ring (pulsing if asked) marks it and a
 * bubble explains it, with an optional "3/5" badge. The layers follow the element on every frame, so they
 * stay on it while the camera moves. `zoom` only helps choose the bubble's side.
 * @param {import('playwright').Locator} locator
 * @param {{ html?: string, step?: string, pulse?: boolean, position?: string, zoom?: number }} options
 */
export const focusOn = (locator, options) =>
  locator.evaluate((el, { html, step, pulse, position, zoom }) => {
    window.__tourwright?.focusOff?.()
    const make = className => {
      const d = document.createElement('div')
      d.className = className
      document.body.appendChild(d)
      return d
    }
    const hole = make('tw-focus')
    const ring = make(`tw-ring${pulse ? ' tw-pulse' : ''}`)
    let bubble = null
    if (html || step) {
      bubble = make('tw-callout')
      bubble.innerHTML = html ?? ''
      if (step) {
        const badge = document.createElement('span')
        badge.className = 'tw-step'
        badge.textContent = step
        bubble.prepend(badge)
      }
    }
    const pad = 8
    const gap = 18
    const clamp = (v, max) => Math.max(12, Math.min(v, max - 12))
    // The side is chosen once, for the size the element will have after the zoom
    let side = position ?? 'auto'
    if (bubble && side === 'auto') {
      const r = el.getBoundingClientRect()
      const z = zoom ?? 1
      const w = bubble.offsetWidth
      const h = bubble.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const bottom = Math.min(vh / 2 + (r.height * z) / 2, r.top + r.height * z)
      side = bottom + gap + h < vh * 0.8 ? 'bottom' : r.top - gap - h > 0 ? 'top' : r.right + gap + w < vw ? 'right' : 'left'
    }
    bubble?.classList.add(`tw-${side}`)
    let alive = true
    let closing = false
    const place = () => {
      if (!alive) return
      const r = el.getBoundingClientRect()
      for (const layer of [hole, ring]) {
        Object.assign(layer.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` })
      }
      if (bubble) {
        const w = bubble.offsetWidth
        const h = bubble.offsetHeight
        const vw = window.innerWidth
        const vh = window.innerHeight
        let left
        let top
        if (side === 'bottom' || side === 'top') {
          left = clamp(r.left + r.width / 2 - w / 2, vw - w)
          top = side === 'bottom' ? r.bottom + pad + gap : r.top - pad - gap - h
        } else {
          top = clamp(r.top + r.height / 2 - h / 2, vh - h)
          left = side === 'right' ? r.right + pad + gap : r.left - pad - gap - w
        }
        bubble.style.setProperty('--tw-arrow', side === 'bottom' || side === 'top' ? `${r.left + r.width / 2 - left}px` : `${r.top + r.height / 2 - top}px`)
        Object.assign(bubble.style, { left: `${left}px`, top: `${top}px` })
      }
      requestAnimationFrame(place)
    }
    place()
    requestAnimationFrame(() => {
      hole.classList.add('tw-show')
      ring.classList.add('tw-show')
      // The bubble arrives a beat later, once the eye has found the element
      setTimeout(() => !closing && bubble?.classList.add('tw-show'), 250)
    })
    window.__tourwright.focusOff = () => {
      window.__tourwright.focusOff = null
      closing = true
      for (const layer of [hole, ring, bubble]) layer?.classList.remove('tw-show')
      setTimeout(() => {
        alive = false
        for (const layer of [hole, ring, bubble]) layer?.remove()
      }, 500)
    }
  }, options)

/** @param {import('playwright').Page} page */
export const focusOff = page => page.evaluate(() => window.__tourwright?.focusOff?.())
