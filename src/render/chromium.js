// Which browser Tourwright launches, so that nothing is downloaded when the PC already has one. In order:
//   1. the one configured (TOURWRIGHT_CHROMIUM)
//   2. Playwright's own build for this Playwright version
//   3. the one the environment names for other tools (CHROME_PATH, CHROME_BIN, PUPPETEER_EXECUTABLE_PATH)
//   4. a build another Playwright or Puppeteer version left in its cache
//   5. a Chrome, Edge or Chromium installed on the system (Windows, macOS, Linux, Raspberry Pi)
// Snap and Flatpak browsers are skipped: Playwright cannot reach their sandboxed profile folders.
import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { acquireLock } from '../lock.js'
import { findBinary, isWindows, log, sleep, UserError } from '../util.js'

const isMac = process.platform === 'darwin'

// Ubuntu's /usr/bin/chromium-browser is a small script that starts the snap
export const isSnap = path => {
  try {
    const real = realpathSync(path)
    if (real.startsWith('/snap/') || real.startsWith('/var/lib/flatpak/') || real.includes('/.local/share/flatpak/')) return true
    if (isWindows || statSync(real).size > 64 * 1024) return false
    const fd = openSync(real, 'r')
    const head = Buffer.alloc(4096)
    const n = readSync(fd, head, 0, head.length, 0)
    closeSync(fd)
    const text = head.subarray(0, n).toString('latin1')
    return text.startsWith('#!') && /\bsnap\b|\/snap\/|flatpak/.test(text)
  } catch {
    return true
  }
}

const usable = path => {
  const found = path ? findBinary(path) : null
  return found && !isSnap(found) ? found : null
}

const EXECUTABLES = new Set(['chrome', 'chrome.exe', 'Chromium', 'Google Chrome for Testing'])

// The browser inside one build folder of Playwright's or Puppeteer's cache (a full browser, not only the shell)
const browserIn = dir => {
  if (!existsSync(join(dir, 'INSTALLATION_COMPLETE')) && basename(dir).startsWith('chromium')) return null
  try {
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !EXECUTABLES.has(e.name)) continue
      const file = join(e.parentPath ?? e.path, e.name)
      // On macOS only the app's main program, not the helpers inside Frameworks
      if (isMac && !/\.app[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/.test(file)) continue
      return file
    }
  } catch {}
  return null
}

/** Folders where Playwright and Puppeteer keep their browsers */
export const browserCaches = (env = process.env, home = homedir()) => {
  // Playwright's default folder, and the shared one the environment named (only read: Tourwright installs in its own)
  const shared = env.TOURWRIGHT_SHARED_BROWSERS_PATH
  const playwright = [
    ...(shared && shared !== '0' ? [shared] : []),
    isWindows ? join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright') : isMac ? join(home, 'Library', 'Caches', 'ms-playwright') : join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'ms-playwright'),
  ].filter((d, i, all) => all.indexOf(d) === i)
  const puppeteer = [env.PUPPETEER_CACHE_DIR ?? join(home, '.cache', 'puppeteer')].map(d => join(d, 'chrome'))
  return { playwright, puppeteer }
}

/** Every complete Chromium another Playwright or Puppeteer version downloaded, newest first */
export const cachedBuilds = (caches = browserCaches()) => {
  const builds = []
  const revision = name => Number(/(\d+)(?:\.\d+)*$/.exec(name)?.[1] ?? 0)
  /** @type {[string[], string][]} */
  const sources = [[caches.playwright, 'chromium-'], [caches.puppeteer, '']]
  for (const [dirs, prefix] of sources) {
    for (const dir of dirs) {
      try {
        const names = readdirSync(dir).filter(n => n.startsWith(prefix)).sort((a, b) => revision(b) - revision(a) || b.localeCompare(a))
        for (const n of names) {
          const exe = browserIn(join(dir, n))
          if (exe) builds.push(exe)
        }
      } catch {}
    }
  }
  return builds
}

const installed = () => {
  const env = process.env
  if (isWindows) {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.LOCALAPPDATA].filter(Boolean)
    const under = (...parts) => roots.map(r => join(r, ...parts))
    return [
      ...under('Google', 'Chrome', 'Application', 'chrome.exe'),
      ...under('Chromium', 'Application', 'chrome.exe'),
      ...under('Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
  }
  if (isMac) {
    return ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      .flatMap(app => [join('/Applications', app), join(homedir(), 'Applications', app)])
  }
  return [
    'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge-stable', 'microsoft-edge',
    // Where packages put the real program when the name in PATH is missing or a wrapper
    '/opt/google/chrome/chrome', '/usr/lib/chromium/chromium', '/usr/lib/chromium-browser/chromium-browser',
    '/usr/lib64/chromium-browser/chromium-browser', '/opt/microsoft/msedge/msedge',
  ]
}

/** A Chrome, Edge or Chromium already on the PC (steps 3–5 above), or null */
export const systemChromium = () => {
  const env = process.env
  for (const c of [env.CHROME_PATH, env.CHROME_BIN, env.PUPPETEER_EXECUTABLE_PATH, ...cachedBuilds(), ...installed()]) {
    const found = usable(c)
    if (found) return found
  }
  return null
}

/**
 * @returns {Promise<{ path: string | undefined, source: 'configured' | 'playwright' | 'system' | 'missing' }>}
 *   `path` is what to pass as `executablePath`: undefined lets Playwright pick its own build.
 */
export const findChromium = async config => {
  if (config.chromium) return { path: config.chromium, source: 'configured' }
  const { chromium } = await import('playwright')
  if (existsSync(chromium.executablePath())) return { path: undefined, source: 'playwright' }
  const system = config.systemBrowser ? systemChromium() : null
  if (system) return { path: system, source: 'system' }
  return { path: undefined, source: 'missing' }
}

// How many times a browser that does not start is started again, and the pause before each try (a machine
// with a full disk or a busy CPU often starts it fine a little later)
const LAUNCH_ATTEMPTS = 3
const LAUNCH_BACKOFF_MS = [10_000, 30_000]

/**
 * chromium.launch with the browser findChromium picks: started again when it does not start in time, under
 * the machine's browser lock when there is one (config.browserLock), and with a fix the user can apply when
 * it never starts.
 */
export const launchChromium = async (config, options) => {
  const { chromium } = await import('playwright')
  const found = await findChromium(config)
  if (found.source === 'missing') {
    throw new UserError('no browser to record with: run `tourwright install`, install Chrome or Edge, or set TOURWRIGHT_CHROMIUM')
  }
  const release = config.browserLock ? await acquireLock(config.browserLock) : () => {}
  let lastError
  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt++) {
    try {
      const browser = await chromium.launch({ ...options, ...(found.path ? { executablePath: found.path } : {}) })
      browser.on('disconnected', release)
      return browser
    } catch (error) {
      lastError = error
      const first = String(error.message).split('\n')[0]
      // A browser that cannot run at all (missing libraries, wrong file) will not start on a second try
      if (!/timeout|timed out|Target.*closed|crashed|ECONNRESET|EAGAIN|ENOSPC|EMFILE/i.test(error.message)) break
      if (attempt === LAUNCH_ATTEMPTS) break
      const pause = LAUNCH_BACKOFF_MS[attempt - 1] ?? 30_000
      log.warn(`the browser did not start (${first}); trying again in ${pause / 1000} s (${attempt + 1}/${LAUNCH_ATTEMPTS})`)
      await sleep(pause)
    }
  }
  release()
  const first = String(lastError?.message).split('\n')[0]
  if (found.source === 'system') {
    throw new UserError(`the browser ${found.path} did not start (${first}). ` +
      "Use another one with TOURWRIGHT_CHROMIUM, or Playwright's own: TOURWRIGHT_SYSTEM_BROWSER=0 tourwright install")
  }
  throw lastError
}
