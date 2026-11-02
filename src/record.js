// `tourwright record <url>`: write a script by doing the tour by hand. A browser window opens; every click,
// every field filled and every choice made is written down as a step with a stable target (role and name,
// label, placeholder — the same ones `explore` lists), with a first narration to rewrite. Closing the window
// (or Ctrl+C) writes the script. A password is never written: it becomes ${secret:…}.
import { writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { secretPrefix } from './explore.js'
import { launch } from './render/browser.js'
import { asTarget } from './render/targets.js'
import { log } from './util.js'

// Runs in the page: what a person did, with the target that finds the element again
export const LISTEN = () => {
  if (window.__twRecording) return
  window.__twRecording = true
  const clean = s => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  // A label's own words, without the field it wraps (a <select> inside its <label> would add every option)
  const labelText = (el, labels) => [...(labels ?? [])].map(l => [...l.childNodes].filter(n => n !== el && !(n.contains && n.contains(el))).map(n => n.textContent).join(' ')).join(' ')
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

// A first narration from what the element is and where it is: the name goes in {braces}, so the focus lands
// as it is said. Plain, correct and short: the draft a person rewrites, or `tourwright narrate` improves.
// "Tu usuario" stays "tu usuario", not "tu tu usuario".
const own = name => name.replace(/^(tu|su|your)\s+/i, '')
const WORDS = {
  es: {
    click: {
      menu: n => `Abre {${n}} en el menú.`,
      tab: n => `Cambia a la pestaña {${n}}.`,
      save: n => `Cuando todo esté listo, pulsa {${n}}.`,
      submit: n => `Pulsa {${n}} para continuar.`,
      link: n => `Abre {${n}}.`,
      other: n => `Pulsa {${n}}.`,
    },
    type: {
      password: n => `Escribe tu {${own(n).toLowerCase()}}.`,
      user: n => `Escribe tu {${own(n).toLowerCase()}}.`,
      search: n => `Para buscar, escribe en {${n.toLowerCase()}}.`,
      otp: () => 'Escribe el {código} de tu aplicación de autenticación.',
      field: n => `Escribe {${n.toLowerCase()}}.`,
    },
    select: n => `Elige {${n.toLowerCase()}}.`,
    check: n => `Marca {${n.toLowerCase()}}.`,
    upload: n => `Sube el archivo en {${n.toLowerCase()}}.`,
    screen: s => `Esta es la pantalla de ${s}.`,
    intro: t => `Así se usa ${t}.`,
  },
  en: {
    click: {
      menu: n => `Open {${n}} in the menu.`,
      tab: n => `Switch to the {${n}} tab.`,
      save: n => `When everything is ready, press {${n}}.`,
      submit: n => `Press {${n}} to go on.`,
      link: n => `Open {${n}}.`,
      other: n => `Press {${n}}.`,
    },
    type: {
      password: n => `Type your {${own(n).toLowerCase()}}.`,
      user: n => `Type your {${own(n).toLowerCase()}}.`,
      search: n => `To search, type in {${n.toLowerCase()}}.`,
      otp: () => 'Type the {code} from your authenticator app.',
      field: n => `Type {${n.toLowerCase()}}.`,
    },
    select: n => `Choose {${n.toLowerCase()}}.`,
    check: n => `Tick {${n.toLowerCase()}}.`,
    upload: n => `Upload the file in {${n.toLowerCase()}}.`,
    screen: s => `This is the ${s} screen.`,
    intro: t => `This is how ${t} works.`,
  },
}

const nameOf = t => t.name ?? t.label ?? t.placeholder ?? t.text ?? null

/**
 * The steps a recording becomes: a chapter per screen, a focus with a first narration before each action, the
 * field values typed, passwords as secrets. Typing in a field again replaces the earlier value.
 * @param {{ action: string, target?: any, text?: string, password?: boolean, value?: string, key?: string, files?: string[], url?: string, where?: string, screen?: string }[]} events
 */
export const stepsFrom = (events, { language = 'es', secret = 'APP' } = {}) => {
  const words = WORDS[language === 'en' ? 'en' : 'es']
  const steps = []
  let last = null
  // The last field typed in, until something else is done
  let typed = null
  let screen = null
  for (const e of events) {
    if (e.action === 'goto') {
      steps.push({ goto: e.url })
      last = null
      continue
    }
    // A new screen: a chapter of the video (and a section of the guide), said once
    if (e.screen && e.screen !== screen) {
      screen = e.screen
      steps.push({ chapter: screen })
    }
    if (e.action === 'press') {
      steps.push({ press: e.key })
      last = null
      continue
    }
    const name = e.target && nameOf(e.target)
    // A password is a secret; a one-time code changes every 30 s, so the script makes it when it types it
    // The user of a login is a secret too: the script works for whoever has it saved, and nobody's account is in it
    const value = e.password ? `\${secret:${secret}_PASSWORD}`
      : e.where === 'otp' ? `\${totp:${secret}_TOTP}`
      : e.where === 'user' ? `\${secret:${secret}_USER}`
      : e.text
    const sameField = t => t && JSON.stringify(t.target) === JSON.stringify(e.target)
    // The same field typed again (change, then Enter): one step with the final value
    if (e.action === 'type' && last?.type && sameField(last.type)) {
      last.type.text = value
      continue
    }
    // …also when Enter came in between: the field loses focus as the page changes, and says it again
    if (e.action === 'type' && sameField(typed) && typed.text === value) continue
    if (e.action === 'type') {
      const how = words.type[e.password ? 'password' : e.where] ?? words.type.field
      if (name) steps.push({ focus: { target: e.target, say: how(name) } })
      last = { type: { target: e.target, text: value } }
      typed = last.type
      steps.push(last)
      continue
    }
    typed = null
    if (e.action === 'click') {
      const kind = e.where && e.where !== 'other' ? e.where : e.target.role === 'link' ? 'link' : 'other'
      steps.push(name ? { focus: { target: e.target, say: (words.click[kind] ?? words.click.other)(name), click: true } } : { click: e.target })
    } else if (e.action === 'select') {
      if (name) steps.push({ focus: { target: e.target, say: words.select(name) } })
      steps.push({ select: { target: e.target, value: e.value } })
    } else if (e.action === 'check' || e.action === 'uncheck') {
      if (name && e.action === 'check') steps.push({ focus: { target: e.target, say: words.check(name) } })
      steps.push({ [e.action]: e.target })
    } else if (e.action === 'upload') {
      if (name) steps.push({ focus: { target: e.target, say: words.upload(name) } })
      steps.push({ upload: { target: e.target, files: e.files } })
    }
    last = null
  }
  return steps
}

/** The title card that opens a recorded video */
export const introStep = (title, language = 'es') => ({ title: { text: title, say: WORDS[language === 'en' ? 'en' : 'es'].intro(title) } })

/** The script as YAML: one step per line, like the ones `explore` writes */
export const recordedScript = ({ title, language, url, steps }) => {
  const flow = v => YAML.stringify(v, { collectionStyle: 'flow', lineWidth: 0 }).trim()
  const head = YAML.stringify({ title, language, voice: undefined }, { lineWidth: 0 }).trim()
  return [
    '# Recorded with `tourwright record`: each action you did, with a first narration to rewrite in your own words.',
    `# Started at ${url}. Check it fast with: tourwright render <this file> --dry-run`,
    head,
    'steps:',
    ...steps.map(s => `  - ${Object.keys(s)[0]}: ${flow(Object.values(s)[0])}`),
    '  - say: null',
    '',
  ].join('\n')
}

/**
 * Opens the browser and records until its window is closed.
 * @param {string} url
 * @param {{ out: string, language?: string, width?: number, height?: number }} options
 */
export const record = async (url, { out, language = 'es', width = 1280, height = 720 }, config) => {
  const browser = await launch({ headless: false, display: null, width, height, locale: language === 'en' ? 'en-US' : 'es-CO' }, config)
  const context = await browser.newContext({ viewport: { width, height } })
  const events = [{ action: 'goto', url }]
  await context.exposeBinding('__twRecord', (_, event) => {
    events.push(event)
    const what = event.target ? asTarget(event.target) : (event.key ?? '')
    log.info(`recorded: ${event.action} ${what}${event.action === 'type' && !event.password ? ` "${event.text}"` : ''}`)
  })
  await context.addInitScript(LISTEN)
  const page = await context.newPage()
  // A page opened by typing an address (not by a click) is a goto in the script
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return
    const last = events.at(-1)
    if (last?.action !== 'click' && last?.action !== 'press' && last?.url !== frame.url()) events.push({ action: 'goto', url: frame.url() })
  })
  await page.goto(url)
  // The name of the app, from its own page: "Acme" from "Ingresar · Acme"
  const pageTitle = (await page.title().catch(() => '')).split(/\s[·|–—-]\s/).at(-1)?.trim()
  log.info('recording: do the tour in the browser window, then close it (or press Ctrl+C here)')
  await new Promise(resolve => {
    browser.on('disconnected', resolve)
    page.on('close', resolve)
    process.once('SIGINT', resolve)
  })
  await browser.close().catch(() => {})
  const host = new URL(url).hostname
  const title = pageTitle || host
  const recorded = stepsFrom(events, { language, secret: secretPrefix(host) })
  // The title card goes right after the first page opens
  const steps = [recorded[0], introStep(title, language), ...recorded.slice(1)]
  writeFileSync(out, recordedScript({ title, language, url, steps }))
  log.info(`${out}: ${steps.length} steps. Rewrite the narration, then: tourwright render ${out} --dry-run`)
  return { out, steps: steps.length }
}
