// Opening the browser for a script, and where its paths lead. Shared by walkthroughs, `explore` and `record`.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { UserError } from '#core/util.js'
import { CHROME_MAX } from './capture.js'
import { launchChromium } from './chromium.js'

// A local script may point baseUrl at a folder or file next to it ("./site/"): pages without a server.
// A scheme needs two letters at least, so Windows' "C:\\" is a path.
export const urlResolver = (script, dir, sandboxed) => {
  const baseUrl = script.baseUrl && !sandboxed && !/^[a-z][\w+.-]+:/i.test(script.baseUrl)
    ? pathToFileURL(resolve(dir, script.baseUrl)).href + (/[\\/]$/.test(script.baseUrl) ? '/' : '')
    : script.baseUrl
  const resolveUrl = path => {
    let u
    try {
      u = new URL(path, baseUrl)
    } catch {
      throw new UserError(`cannot open "${path}": use a full URL or set baseUrl`)
    }
    if (sandboxed && u.protocol !== 'http:' && u.protocol !== 'https:') throw new UserError(`only http(s) URLs can be opened: ${path}`)
    return u.href
  }
  const origin = baseUrl && /^https?:/.test(baseUrl) ? new URL(baseUrl).origin : undefined
  return { resolveUrl, origin }
}

export const launch = async ({ headless, display, width, height, locale }, config) => {
  return launchChromium(config, {
    headless,
    // The browser UI speaks the script's language: no "translate this page?" bubble on camera
    env: { ...process.env, ...(display ? { DISPLAY: display } : {}), LANG: `${locale.replace('-', '_')}.UTF-8`, LANGUAGE: locale.replace('-', '_') },
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run', '--mute-audio', '--hide-scrollbars',
      '--renderer-process-limit=2', '--disable-background-networking', '--disable-component-update', `--lang=${locale}`,
      '--disable-infobars', '--password-store=basic',
      ...(display ? [`--window-size=${width},${height + CHROME_MAX}`, '--window-position=0,0', '--force-device-scale-factor=1'] : [])],
  })
}
