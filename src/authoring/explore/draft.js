// The first script `explore --draft` writes: the header (login, blur, dismiss) and one narrated stop per section.
import YAML from 'yaml'
import { CONTROLS, describe, keyControls } from './page.js'

// The product tours and banners apps open on their own, by the button that closes them
export const DISMISS = /^(saltar|omitir|skip)\b|^(no,? gracias|ahora no|not now|maybe later|aceptar( todas)?( las cookies)?|accept( all)?( cookies)?)$/i

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
export const flow = value => YAML.stringify(value, { collectionStyle: 'flow', lineWidth: 0 }).trim()

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
