// `tourwright explore <url | script>`: what a person needs to write a script for a site, without devtools.
//
// It opens the site like the script would (logging in off camera with `setup` and the saved session; for a
// bare URL it finds the login form itself and asks for the credentials), finds the sections in the site's
// navigation and, for each page, prints its title, what the page says it is for and the targets to paste
// into a script. It saves a screenshot of each page (with the script's `blur`) and, with --draft, writes a
// first script that already goes through every section with narration taken from the pages.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import YAML from 'yaml'
import { loadConfig } from './config.js'
import { launch, urlResolver } from './render/browser.js'
import { needsPrep, prepare, sessionPath } from './render/session.js'
import { dismissing } from './render/steps.js'
import { fromData, interpolate, loadFile } from './script/load.js'
import { getSecret, promptHidden, setSecret } from './secrets.js'
import { log, UserError } from './util.js'

// Roles a script points at. Rows and cells are left out: they hold the app's data, not its interface.
const ROLES = ['heading', 'tablist', 'tab', 'radiogroup', 'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'switch', 'region', 'figure', 'list', 'navigation', 'dialog']
const CONTROLS = ['button', 'searchbox', 'textbox', 'combobox', 'radiogroup', 'tablist', 'checkbox', 'switch']

// A line of Playwright's aria snapshot: `- role "name" [level=1]:` or `- paragraph: text`
const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?(?: \[([^\]]*)\])?(?::\s*(.*))?$/

/**
 * Elements of a page, in reading order, from its aria snapshot. Everything inside a table is skipped.
 * @param {string} snapshot
 * @returns {{ role: string, name?: string, text?: string, level?: number, url?: string, within: string[] }[]}
 */
export const outline = snapshot => {
  const items = []
  const parents = []
  const lines = snapshot.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i])
    if (!m) continue
    const [, indentText, role, rawName, attrs, rest] = m
    const indent = indentText.length
    while (parents.length && parents.at(-1).indent >= indent) parents.pop()
    if (parents.some(p => p.role === 'table')) continue
    parents.push({ indent, role })
    const name = rawName?.replace(/\\(.)/g, '$1')
    const level = Number(/level=(\d)/.exec(attrs ?? '')?.[1]) || undefined
    const url = /^\s*- \/url: (.+)$/.exec(lines[i + 1] ?? '')?.[1]
    const text = rest && !rest.startsWith('-') ? rest.replace(/^"|"$/g, '') : undefined
    items.push({ role, name, text, level, url, within: parents.slice(0, -1).map(p => p.role) })
  }
  return items
}

// What a page is: its main heading, the sentence under it, and the elements worth targeting
export const describe = items => {
  const h1 = items.find(i => i.role === 'heading' && i.level === 1 && i.name)
  const after = h1 ? items.slice(items.indexOf(h1) + 1) : items
  const description = after.find(i => i.role === 'paragraph' && i.text && i.text.length > 20)?.text
  const seen = new Set()
  const targets = items
    // A long name is a record (a person, a payment) shown as a link or button, not part of the interface
    .filter(i => ROLES.includes(i.role) && i.name && i.name.length <= 60 && !i.within.includes('navigation'))
    .filter(i => {
      const key = `${i.role}|${i.name}`
      return !seen.has(key) && seen.add(key)
    })
    .map(i => ({ role: i.role, name: i.name }))
  return { heading: h1?.name, description, targets }
}

// One page under two paths, / and /index.html, is one section
const samePage = path => path.replace(/\/index\.(html?|php|aspx?)(?=$|\?)/i, '/')

// The sections of a site: the links of its navigation (and of its top bar), same origin, once each
export const sections = (items, pageUrl) => {
  const origin = new URL(pageUrl).origin
  const found = new Map()
  for (const i of items) {
    if (i.role !== 'link' || !i.name || !i.url || i.url.startsWith('#')) continue
    if (!i.within.includes('navigation') && !i.within.includes('banner')) continue
    const u = new URL(i.url, pageUrl)
    if (u.origin !== origin) continue
    const path = u.pathname + u.search
    if (![...found.values()].some(f => samePage(f.path) === samePage(path))) found.set(path, { name: i.name, path })
  }
  return [...found.values()]
}

// The product tours and banners apps open on their own, by the button that closes them
const DISMISS = /^(saltar|omitir|skip)\b|^(no,? gracias|ahora no|not now|maybe later|aceptar( todas)?( las cookies)?|accept( all)?( cookies)?)$/i

const lower = s => s.charAt(0).toLowerCase() + s.slice(1)
const say = {
  es: {
    intro: site => `Este es ${site}. Veamos para qué sirve cada sección.`,
    end: site => `Eso es ${site}.`,
    subtitle: 'Recorrido',
    menu: 'En el {menú} están todas las secciones.',
    login: {
      user: ['Primero, escribe tu {usuario}.', '<b>Usuario</b>'],
      password: ['Luego, tu {contraseña}.', '<b>Contraseña</b>'],
      submit: n => [`Y presiona {${n}}.`, `<b>${n}</b>`],
    },
    controls: {
      radiogroup: n => [`{${n}}: estas opciones cambian lo que se ve.`, `<b>${n}</b>`],
      tablist: n => ['Las {pestañas} separan cada parte.', `<b>${n}</b>`],
      button: n => [`Este es el botón {${n}}.`, `<b>${n}</b>`],
      searchbox: n => ['Y aquí se {busca}.', `Buscar: <b>${lower(n)}</b>`],
      combobox: n => [`Aquí se elige {${lower(n)}}.`, `<b>${n}</b>`],
      textbox: n => [`Aquí se escribe {${lower(n)}}.`, `<b>${n}</b>`],
    },
  },
  en: {
    intro: site => `This is ${site}. Let's see what each section is for.`,
    end: site => `That's ${site}.`,
    subtitle: 'A guided tour',
    menu: 'Every section is in the {menu}.',
    login: {
      user: ['First, type your {user name}.', '<b>User</b>'],
      password: ['Then your {password}.', '<b>Password</b>'],
      submit: n => [`And press {${n}}.`, `<b>${n}</b>`],
    },
    controls: {
      radiogroup: n => [`{${n}}: these options change what you see.`, `<b>${n}</b>`],
      tablist: n => ['The {tabs} split each part.', `<b>${n}</b>`],
      button: n => [`This is the {${n}} button.`, `<b>${n}</b>`],
      searchbox: n => ['And this is where you {search}.', `Search: <b>${lower(n)}</b>`],
      combobox: n => [`Here you pick {${lower(n)}}.`, `<b>${n}</b>`],
      textbox: n => [`Here you type {${lower(n)}}.`, `<b>${n}</b>`],
    },
  },
}

// The controls worth a focus on a page: filters and tabs first, then the main buttons, then search.
// Generic ones (a calendar, "Actions", "Copy") are left for the person to add if they matter.
const GENERIC = /^(buscar|search|elegir|choose|acciones|actions|copiar|copy|cerrar|close|siguiente|next|anterior|previous|mostrar|show)\b/i
const PRIORITY = ['radiogroup', 'tablist', 'button', 'searchbox', 'combobox']
export const keyControls = (page, max = 2) =>
  page.targets
    .filter(t => PRIORITY.includes(t.role) && !GENERIC.test(t.name) && t.name.length <= 40)
    .sort((a, b) => PRIORITY.indexOf(a.role) - PRIORITY.indexOf(b.role))
    .slice(0, max)

const flow = value => YAML.stringify(value, { collectionStyle: 'flow', lineWidth: 0 }).trim()

/**
 * A first script: the header (login, blur, dismiss…) and one narrated stop per section. With `login`, the login
 * is shown on camera, field by field, instead of done off camera in `setup`.
 * @param {{ header: Record<string, any>, start: string, home: ReturnType<typeof describe>, pages: { name: string, path: string, page: ReturnType<typeof describe> }[], site: string, menu?: string, login?: { path: string, user: any, password: any, submit: any, names: string[] } }} draft
 */
export const draftScript = ({ header, start, home, pages, site, menu, login }) => {
  const words = say[header.language === 'en' ? 'en' : 'es']
  // Each section points at its key controls, like a product tour: a bubble, a numbered badge, a gentle zoom
  const focuses = (page, badge) =>
    keyControls(page).map((t, i) => {
      const [line, bubble] = words.controls[t.role](t.name)
      return step('focus', { target: t, say: line, text: bubble, ...(i === 0 ? { step: badge, zoom: 1.25 } : {}) })
    })
  const step = (action, value) => `  - ${action}: ${flow(value)}`
  const others = page => page.targets.filter(t => CONTROLS.includes(t.role)).slice(0, 8)
    .map(t => `  #   ${flow(t)}`)
  // On camera the video starts logged out: no saved session, no login off camera
  const { session, sessionCheck, setup, ...loggedOut } = header
  const head = login ? loggedOut : header
  const lines = [
    '# Draft written by `tourwright explore`: every section, with what each page says about itself.',
    '# Rewrite the narration in your own words, then point at what matters with focus, using the targets',
    '# listed under each section. Check it fast with: tourwright render <this file> --dry-run',
    YAML.stringify(head, { lineWidth: 0 }).trim(),
    'steps:',
    step('goto', login ? login.path : start),
    step('title', { text: head.title ?? site, subtitle: words.subtitle, say: words.intro(site) }),
  ]
  if (login) {
    const [user, password] = login.names.map(n => `\${secret:${n}}`)
    const [submitLine, submitBubble] = words.login.submit(login.submit.name ?? 'Enter')
    lines.push(
      '  # The login, on camera. The password shows as dots and a secret typed anywhere else is blurred.',
      `  # To show a demo user instead, write it in place of "${user}".`,
    )
    if (login.user) lines.push(step('focus', { target: login.user, say: words.login.user[0], text: words.login.user[1] }), step('type', { target: login.user, text: user }))
    lines.push(
      step('focus', { target: login.password, say: words.login.password[0], text: words.login.password[1] }),
      step('type', { target: login.password, text: password }),
      step('focus', { target: login.submit, say: submitLine, text: submitBubble, click: true }),
      step('wait', { target: login.password, state: 'hidden' }),
      step('goto', start),
    )
  }
  if (menu) lines.push(step('focus', { target: { role: 'navigation', name: menu }, say: words.menu, text: `<b>${menu}</b>` }))
  if (home.description) lines.push(step('say', home.heading ? `${home.heading}. ${home.description}` : home.description))
  if (others(home).length) lines.push('  # Targets on this page:', ...others(home))
  for (const [index, { name, path, page }] of pages.entries()) {
    lines.push('', `  # ── ${name} (${path})`, step('say', null), step('click', { role: 'link', name }))
    lines.push(step('wait', page.heading ? { target: { role: 'heading', name: page.heading } } : { url: path }))
    lines.push(step('say', page.description ? `${page.heading ?? name}. ${page.description}` : `${page.heading ?? name}.`))
    lines.push(...focuses(page, `${index + 1}/${pages.length}`))
    if (others(page).length) lines.push('  # Other targets on this page:', ...others(page))
  }
  lines.push('', step('say', words.end(site)), step('say', null))
  return `${lines.join('\n')}\n`
}

// A login form on the page: the targets that fill it, from its labels
const findLogin = async page => {
  const password = page.locator('input[type=password]').first()
  if (!(await password.isVisible().catch(() => false))) return null
  return password.evaluate(p => {
    const scope = p.form ?? document
    const label = el => el.labels?.[0]?.textContent.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim() || el.getAttribute('aria-label') || null
    const target = el => (label(el) ? { label: label(el), exact: true } : el.placeholder ? { placeholder: el.placeholder } : { css: `input[name="${el.name}"]` })
    const user = [...scope.querySelectorAll('input')].find(i => i !== p && ['text', 'email'].includes(i.type) && i.offsetParent !== null)
    const submit = scope.querySelector('button[type=submit], input[type=submit]') ?? [...scope.querySelectorAll('button')].at(-1)
    const name = (submit?.textContent || submit?.getAttribute('value') || '').trim()
    return {
      user: user ? target(user) : null,
      password: target(p),
      submit: name ? { role: 'button', name } : { css: 'button[type=submit]' },
    }
  })
}

// The secrets' names for a site, from its host: app.example.com → APP; a name must start with a letter, so an
// IP (127.0.0.1) or a host like 3d.example becomes SITE_127, SITE_3D
export const secretPrefix = host => {
  const name = host.split('.')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return /^[A-Z]/.test(name) ? name : `SITE_${name}`
}

// The credentials of a login: saved ones are used; missing ones are asked for when someone is at the keyboard
const askCredentials = async (config, names) => {
  const missing = names.filter(n => getSecret(config, n) === undefined)
  if (!missing.length) return true
  if (!process.stdin.isTTY) return false
  log.info('this site needs a login: the credentials are saved for the next renders (tourwright secret list)')
  for (const n of missing) setSecret(config, n, await promptHidden(`${n.endsWith('PASSWORD') ? 'password' : 'user'} (${n}): `))
  return true
}

/**
 * @param {string} input   a URL, or a script file
 * @param {{ pages?: string[], draft?: string, fresh?: boolean, max?: number, login?: 'setup' | 'camera' }} [options]
 *   login: where the draft logs in, off camera in `setup` (default) or on camera, field by field
 */
export const explore = async (input, { pages: only, draft, fresh = false, max = 20, login: loginOn = 'setup' } = {}, config = loadConfig()) => {
  if (draft && existsSync(draft)) throw new UserError(`${draft} already exists: pick another name for the draft`)
  if (!['setup', 'camera'].includes(loginOn)) throw new UserError(`--login ${loginOn}: use setup (off camera) or camera`)
  const isUrl = /^https?:\/\//i.test(input)
  let loaded
  if (isUrl) {
    const u = new URL(input)
    loaded = fromData({ title: u.hostname, baseUrl: u.origin, steps: [{ goto: u.pathname + u.search }] }, { name: u.hostname })
  } else {
    loaded = await loadFile(input, { allowJs: false })
    if (loaded.kind !== 'browser') throw new UserError('explore works on browser scripts (slides have no site to explore)')
  }
  const header = Object.fromEntries(Object.entries(loaded.script).filter(([k]) => !['steps', 'blocks', 'vars', 'type'].includes(k)))
  const firstGoto = loaded.script.steps.find(s => 'goto' in s)?.goto ?? '/'
  const { resolveUrl } = urlResolver(loaded.script, loaded.dir, false)
  const host = new URL(resolveUrl(firstGoto)).hostname
  // Next to the video it is for: videos/<name>/explore/ (the draft's name, else the script's or the site's)
  const videoName = draft ? basename(draft).replace(/\.(ya?ml|json)$/i, '') : loaded.name
  const outDir = resolve('videos', videoName, 'explore')
  mkdirSync(outDir, { recursive: true })

  const locale = header.language === 'en' ? 'en-US' : header.language ?? 'es-CO'
  const browser = await launch({ headless: true, display: null, width: 1280, height: 720, locale }, config)
  try {
    const common = { viewport: { width: 1280, height: 720 }, locale }
    const network = { uploads: new Map() }
    let start = firstGoto
    let complete = true
    let onCamera

    // A bare URL on a login page: the setup that logs in is written from the form itself
    if (isUrl) {
      const probe = await browser.newPage(common)
      await probe.goto(resolveUrl(firstGoto), { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
      header.title = (await probe.title()).split(/[·|–-]/)[0].trim() || host
      header.language = (await probe.evaluate(() => document.documentElement.lang)).slice(0, 2) || undefined
      const login = await findLogin(probe)
      const loginPath = new URL(probe.url()).pathname
      await probe.close()
      if (login) {
        const prefix = secretPrefix(host)
        const names = [`${prefix}_USER`, `${prefix}_PASSWORD`]
        Object.assign(header, {
          session: host,
          sessionCheck: { goto: '/', notUrl: loginPath },
          setup: [
            { goto: loginPath },
            ...(login.user ? [{ fill: { target: login.user, text: `\${secret:${names[0]}}` } }] : []),
            { fill: { target: login.password, text: `\${secret:${names[1]}}` } },
            { click: login.submit },
          ],
        })
        start = '/'
        if (loginOn === 'camera') onCamera = { path: loginPath, ...login, names }
        complete = await askCredentials(config, names)
        if (!complete) log.warn(`a login is needed. Save the credentials, then explore again:\n    tourwright secret set ${names[0]}\n    tourwright secret set ${names[1]}`)
      }
    }
    if (loginOn === 'camera' && !onCamera) log.warn('--login camera: no login form found on that URL, the draft logs in as the script does')

    const script = interpolate({ ...loaded.script, ...header, steps: loaded.script.steps }, { config })
    const sessionFile = script.session ? sessionPath(config, script.session) : null
    let state
    if (complete && needsPrep(script, loaded, sessionFile)) {
      log.info('logging in off camera…')
      state = await prepare({ browser, common, script: { ...script, warmup: [] }, loaded, network, resolveUrl, sessionFile: fresh ? null : sessionFile })
    }
    const context = await browser.newContext({ ...common, ...(state ? { storageState: state } : {}) })
    const blurCss = (script.blur ?? []).filter(t => typeof t === 'string').map(sel => `${sel} { filter: blur(8px) !important; }`).join('\n')
    if (blurCss) {
      await context.addInitScript(css => {
        const add = () => document.head.append(Object.assign(document.createElement('style'), { textContent: css }))
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add)
        else add()
      }, blurCss)
    }
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    const blocker = await dismissing(page, script.dismiss)
    const found = new Map((script.dismiss ?? []).map(t => [JSON.stringify(t), t]))

    const visit = async (path, n) => {
      await page.goto(resolveUrl(path), { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
      await page.waitForTimeout(1200)
      // Close what the app opened on its own, and remember it for the draft's `dismiss`
      // Tours open a moment after the page: give them that moment
      const tour = page.getByRole('button', { name: DISMISS }).first()
      if (await tour.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) {
        // Its accessible name ("Saltar la guía"), which may differ from its text ("Saltar")
        const name = outline(await tour.ariaSnapshot())[0]?.name ?? (await tour.textContent() ?? '').trim()
        found.set(JSON.stringify({ role: 'button', name }), { role: 'button', name })
        await tour.click().catch(() => {})
        await page.waitForTimeout(500)
      }
      const open = await blocker.pending()
      if (open) await open.click().catch(() => {})
      const root = (await page.locator('main').count()) ? page.locator('main').first() : page.locator('body')
      const items = outline(await root.ariaSnapshot())
      const shot = join(outDir, `${String(n).padStart(2, '0')}-${path.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'inicio'}.png`)
      await page.screenshot({ path: shot })
      return { items, shot, url: page.url() }
    }

    const home = await visit(start, 0)
    const bodyItems = outline(await page.locator('body').ariaSnapshot())
    const homePath = new URL(home.url).pathname
    const list = (only?.length ? only.map(p => ({ name: p, path: p })) : sections(bodyItems, home.url))
      .filter(s => samePage(s.path) !== samePage(homePath)).slice(0, max)
    const pages = []
    for (const [i, s] of list.entries()) {
      log.info(`${s.name}…`)
      const r = await visit(s.path, i + 1)
      pages.push({ ...s, page: describe(r.items), shot: r.shot })
    }
    const homeInfo = describe(home.items)
    if (found.size) header.dismiss = [...found.values()]
    header.blur ??= ['main tbody']

    const report = { site: host, start, home: { ...homeInfo, shot: home.shot }, pages, screenshots: outDir, loggedIn: Boolean(state), needsLogin: !complete }
    if (draft) {
      const text = draftScript({ header: { title: header.title, language: header.language, voice: header.voice, quality: header.quality ?? 'hd', ...header }, start, home: homeInfo, pages, site: header.title ?? host, menu: bodyItems.find(i => i.role === 'navigation' && i.name)?.name, login: onCamera })
      fromData(YAML.parse(text), { name: 'draft' })
      writeFileSync(draft, text)
      report.draft = resolve(draft)
    }
    await context.close()
    return report
  } finally {
    await browser.close().catch(() => {})
  }
}

// The report for a person: one block per page, targets ready to paste
export const printReport = (r, write = s => process.stdout.write(s)) => {
  const block = (title, path, info, shot) => {
    write(`\n── ${title}  ${path}\n`)
    if (info.description) write(`   ${info.description}\n`)
    for (const t of info.targets.slice(0, 14)) write(`   ${flow(t)}\n`)
    write(`   screenshot: ${shot}\n`)
  }
  block(r.home.heading ?? r.site, r.start, r.home, r.home.shot)
  for (const p of r.pages) block(p.name, p.path, p.page, p.shot)
  write(`\n${r.pages.length} sections · screenshots in ${r.screenshots}\n`)
  if (r.draft) write(`draft: ${r.draft}\n  try it:  tourwright render "${r.draft}" --dry-run\n  then:    tourwright render "${r.draft}" --open\n`)
}

