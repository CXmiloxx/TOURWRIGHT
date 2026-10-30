// Off camera, before recording: log in (`setup` or a JS `setup` function), warm up pages and keep the
// session in dataDir/sessions so the next render can skip the login.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../util.js'
import { setupNetwork } from './network.js'
import { plainHelpers, runSteps } from './steps.js'
import { safePath } from './theme.js'

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
  if (valid) log.info('session reused (setup skipped)')
  else if (script.setup?.length) await runSteps(script.setup, plainHelpers(page, resolveUrl, network.uploads, f => safePath(f, dir, sandboxed)), page)
  if (!valid && loaded.setupFn) await loaded.setupFn({ page, context: pre })
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
