// What a recording becomes: the steps with a first narration, the cards that open and close it, its look,
// the YAML script, and the secrets typed in the login.
import YAML from 'yaml'

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
    outro: t => ({ text: '¡Listo!', subtitle: `Ya sabes usar ${t}` }),
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
    outro: t => ({ text: 'All set!', subtitle: `Now you know how to use ${t}` }),
  },
}

const nameOf = t => t.name ?? t.label ?? t.placeholder ?? t.text ?? null

/**
 * The steps a recording becomes: a chapter per screen, a focus with a first narration before each action, the
 * field values typed, passwords as secrets. Typing in a field again replaces the earlier value. `studio`: the
 * camera pushes in on each field and the button that saves or sends pulses.
 * @param {{ action: string, target?: any, text?: string, password?: boolean, value?: string, key?: string, files?: string[], url?: string, where?: string, screen?: string }[]} events
 */
export const stepsFrom = (events, { language = 'es', secret = 'APP', studio = false } = {}) => {
  const words = WORDS[language === 'en' ? 'en' : 'es']
  const steps = []
  let last = null
  // The last field typed in, until something else is done
  let typed = null
  let screen = null
  const zoom = studio ? { zoom: 1.3 } : {}
  for (const e of events) {
    if (e.action === 'look') continue
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
      if (name) steps.push({ focus: { target: e.target, say: how(name), ...zoom } })
      last = { type: { target: e.target, text: value } }
      typed = last.type
      steps.push(last)
      continue
    }
    typed = null
    if (e.action === 'click') {
      const kind = e.where && e.where !== 'other' ? e.where : e.target.role === 'link' ? 'link' : 'other'
      const pulse = studio && (kind === 'save' || kind === 'submit') ? { pulse: true } : {}
      steps.push(name ? { focus: { target: e.target, say: (words.click[kind] ?? words.click.other)(name), ...pulse, click: true } } : { click: e.target })
    } else if (e.action === 'select') {
      if (name) steps.push({ focus: { target: e.target, say: words.select(name), ...zoom } })
      steps.push({ select: { target: e.target, value: e.value } })
    } else if (e.action === 'check' || e.action === 'uncheck') {
      if (name && e.action === 'check') steps.push({ focus: { target: e.target, say: words.check(name) } })
      steps.push({ [e.action]: e.target })
    } else if (e.action === 'upload') {
      if (name) steps.push({ focus: { target: e.target, say: words.upload(name), ...zoom } })
      steps.push({ upload: { target: e.target, files: e.files } })
    }
    last = null
  }
  return steps
}

/** The title card that opens a recorded video */
export const introStep = (title, language = 'es') => ({ title: { text: title, say: WORDS[language === 'en' ? 'en' : 'es'].intro(title) } })

/** The card that closes it */
export const outroStep = (title, language = 'es') => ({ title: { ...WORDS[language === 'en' ? 'en' : 'es'].outro(title), animation: 'zoom' } })

/** The studio look: the app in a window, in its own main color */
export const studioTheme = accent => ({ frame: 'window', ...(accent ? { accent } : {}), titleBackground: 'aurora' })

/** The script as YAML: one step per line, like the ones `explore` writes */
export const recordedScript = ({ title, language, url, steps, theme = undefined, audio = undefined, voice = undefined }) => {
  const flow = v => YAML.stringify(v, { collectionStyle: 'flow', lineWidth: 0 }).trim()
  const head = YAML.stringify({ title, language, voice }, { lineWidth: 0 }).trim()
  return [
    '# Recorded with `tourwright record`: each action you did, with a first narration to rewrite in your own words.',
    `# Started at ${url}. Check it fast with: tourwright render <this file> --dry-run`,
    head,
    ...(theme ? [`theme: ${flow(theme)}`] : []),
    ...(audio ? [`audio: ${flow(audio)}`] : []),
    'steps:',
    ...steps.map(s => `  - ${Object.keys(s)[0]}: ${flow(Object.values(s)[0])}`),
    '  - say: null',
    '',
  ].join('\n')
}
// What the person typed in the login is what the video types: saved as secrets, never in the script
export const secretsTyped = (events, prefix) => {
  const found = {}
  for (const e of events) {
    if (e.action !== 'type' || !e.text) continue
    if (e.password) found[`${prefix}_PASSWORD`] = e.text
    else if (e.where === 'user') found[`${prefix}_USER`] = e.text
  }
  return found
}
