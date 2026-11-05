// The login of a bare URL: its form found on the page, and the credentials asked once and saved as secrets.
import { getSecret, promptHidden, setSecret } from '#core/secrets.js'
import { log } from '#core/util.js'

// A login form on the page: the targets that fill it, from its labels
export const findLogin = async page => {
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
export const askCredentials = async (config, names) => {
  const missing = names.filter(n => getSecret(config, n) === undefined)
  if (!missing.length) return true
  if (!process.stdin.isTTY) return false
  log.info('this site needs a login: the credentials are saved for the next renders (tourwright secret list)')
  for (const n of missing) setSecret(config, n, await promptHidden(`${n.endsWith('PASSWORD') ? 'password' : 'user'} (${n}): `))
  return true
}
