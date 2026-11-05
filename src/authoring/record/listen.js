// Runs in the page while a person does the tour by hand: what they did, with the target that finds it again.


// Runs in the page: what a person did, with the target that finds the element again
export const LISTEN = () => {
  if (window.__twRecording) return
  window.__twRecording = true
  const clean = s => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  // A label's own words, without the field it wraps (a <select> inside its <label> would add every option)
  const labelText = (el, labels) => [...(labels ?? [])].map(l => [...l.childNodes].filter(n => n !== el && !n.contains?.(el)).map(n => n.textContent).join(' ')).join(' ')
  const isField = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  const targetOf = el => {
    if (isField(el)) {
      const label = clean(labelText(el, el.labels) || el.getAttribute('aria-label'))
      if (label) return { label }
      const placeholder = clean(el.getAttribute('placeholder'))
      if (placeholder) return { placeholder }
      // A label not linked to the field: the text right before it
      for (let n = /** @type {HTMLElement | null} */ (el); n && n !== document.body; n = n.parentElement) {
        const before = clean(n.previousElementSibling?.textContent)
        if (before) return { label: before }
      }
      if (el.id) return { css: `#${CSS.escape(el.id)}` }
      if (el.name) return { css: `[name="${el.name}"]` }
      return null
    }
    const role = el.closest('a[href]') ? 'link' : 'button'
    const host = el.closest('a[href], button, [role=button], [role=tab], [role=menuitem], input[type=submit], input[type=button], summary') ?? el
    const roleOf = host.getAttribute('role') ?? role
    const name = clean(host.getAttribute('aria-label') || host.textContent || host.getAttribute('value') || host.getAttribute('title'))
    if (name) return { role: roleOf, name }
    if (host.id) return { css: `#${CSS.escape(host.id)}` }
    return null
  }
  // Where the element is and what it is for: the narration says it ("Abre Clientes en el menú", "Para buscar…")
  const words = el => clean([el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('autocomplete'), labelText(el, el.labels), isField(el) ? '' : el.textContent].join(' ')).toLowerCase()
  const whereOf = el => {
    if (el instanceof HTMLInputElement && el.type === 'password') return 'password'
    const host = el.closest('[role=tab]')
    if (host) return 'tab'
    if (isField(el)) {
      if (el.getAttribute('autocomplete') === 'one-time-code' || /verificaci|verification|autenticaci|authenticat|one.?time|\botp\b|\b2fa\b/.test(words(el))) return 'otp'
      if (el.type === 'search' || el.getAttribute('role') === 'searchbox' || el.closest('[role=search]') || /busca|buscar|search|filtr/.test(words(el))) return 'search'
      if (/usuario|correo|e-?mail|username|user\b/.test(words(el))) return 'user'
      return 'field'
    }
    if (el.closest('nav, [role=navigation], [role=menu], [role=menubar], aside, header')) return 'menu'
    const button = el.closest('button, input[type=submit], [role=button]')
    if (button && /guardar|save|crear|create|enviar|send|confirmar|confirm|aceptar|registrar|publicar|pagar|pay|subir|upload|agregar|añadir|add/.test(words(button))) return 'save'
    if (button && (/** @type {HTMLButtonElement} */ (button).type === 'submit') && button.closest('form')) return 'submit'
    return 'other'
  }
  // The screen it happened on: its main heading, else the page title
  const screen = () => {
    const h = [...document.querySelectorAll('h1, h2')].find(e => e.getBoundingClientRect().height > 0)
    return clean(h?.textContent) || clean(document.title)
  }
  const send = event => {
    const el = event.el
    delete event.el
    window.__twRecord?.({ ...event, where: el ? whereOf(el) : undefined, screen: screen() })
  }
  // The app's own main color, for the video's accent: the first strongly colored button (plain or gradient)
  const accentOf = () => {
    for (const b of document.querySelectorAll('button, [role=button], input[type=submit], a')) {
      const box = b.getBoundingClientRect()
      if (box.width < 40 || box.height < 24) continue
      const style = getComputedStyle(b)
      for (const m of `${style.backgroundColor} ${style.backgroundImage}`.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g)) {
        if (m[4] !== undefined && Number(m[4]) < 0.6) continue
        const rgb = [Number(m[1]), Number(m[2]), Number(m[3])]
        if (Math.max(...rgb) - Math.min(...rgb) > 70 && Math.max(...rgb) > 90) return `#${rgb.map(x => x.toString(16).padStart(2, '0')).join('')}`
      }
    }
    return null
  }
  window.addEventListener('load', () => {
    const accent = accentOf()
    if (accent) window.__twRecord?.({ action: 'look', accent })
  })
  document.addEventListener('click', e => {
    const el = /** @type {Element} */ (e.target)
    if (!(el instanceof Element)) return
    // A click into a text field only focuses it: what is typed is recorded on change
    if (isField(el) && !['checkbox', 'radio', 'submit', 'button'].includes(/** @type {HTMLInputElement} */ (el).type)) return
    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) return
    // Enter in a field makes the browser click the form's button: that is the `press: Enter` already recorded
    if (/** @type {MouseEvent} */ (e).detail === 0 && isField(document.activeElement) && document.activeElement !== el) return
    const target = targetOf(el)
    if (target) send({ action: 'click', target, el })
  }, true)
  document.addEventListener('change', e => {
    const el = e.target
    if (!isField(el)) return
    const target = targetOf(el)
    if (!target) return
    if (el instanceof HTMLSelectElement) return send({ action: 'select', target, value: el.value, el })
    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) return send({ action: el.checked ? 'check' : 'uncheck', target, el })
    if (el instanceof HTMLInputElement && el.type === 'file') return send({ action: 'upload', target, files: [...(el.files ?? [])].map(f => f.name), el })
    send({ action: 'type', target, text: el.value, password: el instanceof HTMLInputElement && el.type === 'password', el })
  }, true)
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && isField(e.target) && !(e.target instanceof HTMLTextAreaElement)) {
      // The value first: Enter often submits before the field loses focus
      const el = /** @type {HTMLInputElement} */ (e.target)
      const target = targetOf(el)
      if (target) send({ action: 'type', target, text: el.value, password: el.type === 'password', el })
      send({ action: 'press', key: 'Enter' })
    }
  }, true)
}
