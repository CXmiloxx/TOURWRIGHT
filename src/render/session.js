// Off camera, before recording: log in (`setup` or a JS `setup` function), warm up pages and keep the
// session in dataDir/sessions so the next render can skip the login.
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log, UserError } from '../util.js'
import { setupNetwork } from './network.js'
import { plainHelpers, runSteps } from './steps.js'
import { safePath } from './theme.js'

// Local renders keep their sessions in `local`; each API token has its own folder
const sessionsDir = (config, namespace = 'local') => join(config.dataDir, 'sessions', namespace)

export const sessionPath = (config, name, namespace) => join(sessionsDir(config, namespace), `${name}.json`)

export const needsPrep = (script, loaded, sessionFile) => Boolean(script.setup?.length || script.warmup?.length || sessionFile || loaded.setupFn)

// Returns the storage state (cookies, local storage) the recording context starts with.
export const prepare = async ({ browser, common, script, loaded, network, resolveUrl, sessionFile }) => {
  const { dir, sandboxed } = loaded
  const saved = sessionFile && existsSync(sessionFile) ? sessionFile : undefined
  const pre = await browser.newContext({ ...common, ...(saved ? { storageState: saved } : {}) })
  await setupNetwork(pre, network)
  const page = await pre.newPage()
  page.setDefaultTimeout(30_000)
  let valid = false
  if (saved && script.sessionCheck) {
    await page.goto(resolveUrl(script.sessionCheck.goto), { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
    await page.waitForTimeout(1000)
    valid = !page.url().includes(script.sessionCheck.notUrl)
  } else if (saved) valid = true
  if (valid) log.info('session reused (setup skipped; --fresh logs in again)')
  else if (script.setup?.length) await runSteps(script.setup, plainHelpers(page, resolveUrl, network.uploads, f => safePath(f, dir, sandboxed)), page)
  if (!valid && loaded.setupFn) await loaded.setupFn({ page, context: pre })
  // The login did not get past the login page: say so now, not as a missing element halfway through
  if (!valid && script.sessionCheck) await page.waitForURL(u => !String(u).includes(script.sessionCheck.notUrl), { timeout: 20_000 }).catch(() => {})
  if (!valid && script.sessionCheck && page.url().includes(script.sessionCheck.notUrl)) {
    await pre.close()
    throw new UserError(`the login in \`setup\` did not work: the page is still ${script.sessionCheck.notUrl}. Check the secrets (tourwright secret list) and the targets of \`setup\``)
  }
  for (const path of script.warmup ?? []) {
    await page.goto(resolveUrl(path), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  }
  const state = await pre.storageState()
  if (sessionFile) saveSession(sessionFile, state)
  await pre.close()
  return state
}

// Only the owner can read it: it holds login cookies
export const saveSession = (file, state) => {
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify(state), { mode: 0o600 })
  chmodSync(file, 0o600)
}

// The sessions saved by local renders, newest first
export const listSessions = config => {
  const dir = sessionsDir(config)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => ({ name: f.slice(0, -5), savedAt: statSync(join(dir, f)).mtime.toISOString() }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export const deleteSession = (config, name) => {
  const file = sessionPath(config, name)
  if (!existsSync(file)) return false
  rmSync(file, { force: true })
  return true
}

// Every saved session, the API's too: the next render of each script logs in again
export const clearSessions = config => {
  const dir = join(config.dataDir, 'sessions')
  if (!existsSync(dir)) return 0
  const count = readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.json')).length
  rmSync(dir, { recursive: true, force: true })
  return count
}
