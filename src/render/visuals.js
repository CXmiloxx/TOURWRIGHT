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
// From one element to another it glides: the page is measured without the zoom it has now, and every transform
// has its origin at the top-left corner, so one transform eases into the next.
/** @param {import('playwright').Locator} locator */
export const camera = (locator, value) =>
  locator.evaluate((el, value) => {
    const OURS = ['tw-frame', 'tw-spot', 'tw-callout', 'tw-focus', 'tw-ring']
    const kids = /** @type {HTMLElement[]} */ ([...document.body.children]).filter(child =>
      !(child.id?.startsWith('tw-') || OURS.some(c => child.classList.contains(c)) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE'))
    const before = kids.map(k => k.style.transform)
    for (const k of kids) {
      k.style.transition = 'none'
      k.style.transform = ''
    }
    const r = el.getBoundingClientRect()
    const boxes = kids.map(k => k.getBoundingClientRect())
    kids.forEach((k, i) => (k.style.transform = before[i]))
    void document.body.offsetWidth
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const vw = window.innerWidth
    const vh = window.innerHeight
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
    const tx = clamp(vw / 2 - cx, -(vw - cx) * (value - 1), cx * (value - 1))
    const ty = clamp(vh / 2 - cy, -(vh - cy) * (value - 1), cy * (value - 1))
    kids.forEach((k, i) => {
      // Ease out: fast start, long soft landing, like a camera operator
      k.style.transition = 'transform .85s cubic-bezier(.22,1,.36,1)'
      k.style.transformOrigin = '0 0'
      if (value === 1) return void (k.style.transform = 'translate(0px, 0px) scale(1)')
      // The element's center lands at (cx + tx, cy + ty) with the origin at the child's corner
      const b = boxes[i]
      k.style.transform = `translate(${tx + (1 - value) * (cx - b.left)}px, ${ty + (1 - value) * (cy - b.top)}px) scale(${value})`
    })
  }, value)

/** The camera back to the whole page, whatever it was looking at @param {import('playwright').Page} page */
// Resolves to whether there was a zoom to undo (a page opened since has none)
export const cameraOut = page =>
  page.evaluate(() => {
    let moved = false
    for (const k of /** @type {HTMLElement[]} */ ([...document.body.children])) {
      if (!k.style.transform || k.style.transform === 'translate(0px, 0px) scale(1)') continue
      k.style.transition = 'transform .85s cubic-bezier(.22,1,.36,1)'
      k.style.transform = 'translate(0px, 0px) scale(1)'
      moved = true
    }
    return moved
  })

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

// A click drawn without clicking: the ripple and the pressed cursor where the mouse is. For elements whose real
// click would open something the video cannot show (the system's file chooser).
/** @param {import('playwright').Page} page */
export const tap = (page, x, y) =>
  page.evaluate(([x, y]) => {
    const ripple = document.getElementById('tw-ripple')
    const cursor = document.getElementById('tw-cursor')
    if (!ripple) return
    Object.assign(ripple.style, { left: `${x}px`, top: `${y}px` })
    ripple.classList.remove('tw-show')
    void ripple.offsetWidth
    ripple.classList.add('tw-show')
    cursor?.classList.add('tw-down')
    setTimeout(() => cursor?.classList.remove('tw-down'), 140)
  }, /** @type {const} */ ([x, y]))

// The file chooser, drawn: the system's own never shows in a recording. The files to pick are listed, the first
// one gets selected, "Open" is pressed and it closes. `step` paces it; it resolves when the chooser is gone.
/** @param {import('playwright').Page} page @param {string[]} names @param {{ title: string, open: string, folder: string }} words */
export const filePicker = (page, names, words, step = 420) =>
  page.evaluate(([names, words, step]) => new Promise(resolve => {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    const ext = n => (/\.([a-z0-9]{1,4})$/i.exec(n)?.[1] ?? '').toUpperCase()
    const others = ['Contrato.pdf', 'Logo.png', 'Notas.txt'].filter(n => !names.includes(n)).slice(0, Math.max(0, 4 - names.length))
    const rows = [...names, ...others].map((n, i) => `<div class="tw-fp-row${i < names.length ? ' tw-fp-pick' : ''}"><span class="tw-fp-ico">${esc(ext(n) || 'FILE')}</span>${esc(n)}</div>`).join('')
    const box = document.createElement('div')
    box.id = 'tw-picker'
    box.innerHTML = `<div class="tw-fp"><div class="tw-fp-bar"><b>${esc(words.title)}</b></div><div class="tw-fp-body"><div class="tw-fp-side">${esc(words.folder)}</div><div class="tw-fp-list">${rows}</div></div><div class="tw-fp-foot"><span class="tw-fp-btn">${esc(words.open)}</span></div></div>`
    document.body.appendChild(box)
    requestAnimationFrame(() => box.classList.add('tw-show'))
    setTimeout(() => { for (const r of box.querySelectorAll('.tw-fp-pick')) r.classList.add('tw-on') }, step * 2)
    setTimeout(() => box.querySelector('.tw-fp-btn')?.classList.add('tw-on'), step * 3.4)
    setTimeout(() => box.classList.remove('tw-show'), step * 4.2)
    setTimeout(() => { box.remove(); resolve(undefined) }, step * 4.2 + 320)
  }), /** @type {const} */ ([names, words, step]))
