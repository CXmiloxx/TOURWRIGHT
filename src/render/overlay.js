// Runs inside every page of the recording: the cursor, its click ripple, and the theme styles. Captions,
// title cards and frames are added on demand by the helpers.
export const OVERLAY = ([css, blurCss, logo]) => {
  if (window.__tourwright) return
  window.__tourwright = { logo }
  const put = () => {
    if (document.getElementById('tw-cursor')) return
    const style = document.createElement('style')
    style.id = 'tw-style'
    style.textContent = `${css}\n${blurCss}\n nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }`
    document.head.appendChild(style)
    const cursor = document.createElement('div')
    cursor.id = 'tw-cursor'
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#111827" stroke="#F8FAFC" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    cursor.style.left = '-50px'
    document.body.appendChild(cursor)
    const ripple = document.createElement('div')
    ripple.id = 'tw-ripple'
    document.body.appendChild(ripple)
    document.addEventListener('mousemove', e => {
      cursor.style.left = `${e.clientX}px`
      cursor.style.top = `${e.clientY}px`
    }, true)
    document.addEventListener('mousedown', e => {
      cursor.classList.add('tw-down')
      ripple.style.left = `${e.clientX}px`
      ripple.style.top = `${e.clientY}px`
      ripple.classList.remove('tw-show')
      void ripple.offsetWidth
      ripple.classList.add('tw-show')
    }, true)
    document.addEventListener('mouseup', () => cursor.classList.remove('tw-down'), true)
  }
  if (document.body) put()
  else document.addEventListener('DOMContentLoaded', put)
  // A visible browser shows native tooltips (title attributes, <title> in SVG) on top of everything
  const noTooltip = el => {
    if (el.nodeType !== 1) return
    if (el.tagName.toLowerCase() === 'title' && el.closest('svg')) return el.remove()
    if (el.hasAttribute('title')) {
      el.dataset.twTitle = el.getAttribute('title')
      el.removeAttribute('title')
    }
    el.querySelectorAll?.('[title], svg title').forEach(noTooltip)
  }
  new MutationObserver(changes => {
    for (const c of changes) {
      if (c.type === 'attributes') noTooltip(c.target)
      else c.addedNodes.forEach(noTooltip)
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] })
}
