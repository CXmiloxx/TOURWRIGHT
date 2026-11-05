// The recording itself: a browser window until the person closes it, then the script and the narrated video.
import { writeFileSync } from 'node:fs'
import { secretPrefix } from '#authoring/explore/index.js'
import { launch } from '#render/browser/launch.js'
import { asTarget } from '#render/steps/targets.js'
import { log } from '#core/util.js'
import { LISTEN } from './listen.js'
import { introStep, outroStep, recordedScript, secretsTyped, stepsFrom, studioTheme } from './steps.js'

/**
 * Opens the browser and records until its window is closed, then writes the script and, unless `video` is
 * false, makes the narrated video at once: what was typed in the login is saved as secrets (encrypted on this
 * machine), the narration is rewritten by the AI when one is set up, and the video gets the studio look.
 * @param {string} url
 * @param {{ out: string, language?: string, width?: number, height?: number, video?: boolean, studio?: boolean }} options
 */
export const record = async (url, { out, language = 'es', width = 1280, height = 720, video = true, studio = true }, config) => {
  const browser = await launch({ headless: false, display: null, width, height, locale: language === 'en' ? 'en-US' : 'es-CO' }, config)
  const context = await browser.newContext({ viewport: { width, height } })
  const events = [{ action: 'goto', url }]
  let accent = null
  await context.exposeBinding('__twRecord', (_, event) => {
    if (event.action === 'look') {
      accent ??= event.accent
      return
    }
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
  const prefix = secretPrefix(host)
  const recorded = stepsFrom(events, { language, secret: prefix, studio })
  // The title card goes right after the first page opens; with the studio look a closing card ends it
  const steps = [recorded[0], introStep(title, language), ...recorded.slice(1), ...(studio ? [outroStep(title, language)] : [])]
  // No voice in the script: each render picks the most natural one where it runs (autoVoice)
  writeFileSync(out, recordedScript({ title, language, url, steps, theme: studio ? studioTheme(accent) : undefined, audio: studio ? { clicks: true } : undefined }))
  log.info(`${out}: ${steps.length} steps`)
  if (!video) {
    log.info(`rewrite the narration if you like, then: tourwright render ${out}`)
    return { out, steps: steps.length }
  }
  return { out, steps: steps.length, ...(await finish(out, { events, prefix }, config)) }
}
const finish = async (out, { events, prefix }, config) => {
  const { getSecret, setSecret } = await import('#core/secrets.js')
  for (const [name, value] of Object.entries(secretsTyped(events, prefix))) {
    setSecret(config, name, value)
    log.info(`saved ${name} (encrypted on this machine): the video logs in with it`)
  }
  // A one-time code cannot be typed again: the video needs the key the authenticator app was set up with
  if (events.some(e => e.where === 'otp') && !getSecret(config, `${prefix}_TOTP`)) {
    log.warn(`the login asks for a 2FA code: save the key of your authenticator app once with
    tourwright secret set ${prefix}_TOTP
  and then make the video with: tourwright render ${out}`)
    return { video: null }
  }
  const { loadFile } = await import('#script/load.js')
  if (config.ai?.provider) {
    try {
      const { proposeNarration, writeNarration } = await import('#ai/narrate.js')
      log.info(`the AI (${config.ai.provider}) is rewriting the narration from what each screen shows…`)
      const changed = writeNarration(out, await proposeNarration(await loadFile(out), config))
      log.info(`narration: ${changed?.applied ?? 0} lines rewritten in ${out}`)
    } catch (error) {
      log.warn(`narration kept as recorded: ${error.message}`)
    }
  } else log.info('tip: tourwright config set ai anthropic|openai|ollama, and the AI writes the narration next time')
  const { outputBase, render } = await import('#render/index.js')
  const loaded = await loadFile(out)
  log.info('making the video…')
  const result = await render(loaded, { out: outputBase(undefined, loaded.name) }, config)
  log.info(`video: ${result.paths?.video ?? '(see the output folder)'}`)
  return { video: result.paths?.video ?? null }
}
