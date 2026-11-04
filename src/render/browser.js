// Browser walkthroughs: a real Chromium follows the script while it is filmed; the narration, captions,
// chapters and cuts are assembled afterwards by compose().
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compose, qualityOf } from '../compose.js'
import { loadConfig } from '../config.js'
import { interpolate, secretsShown } from '../script/load.js'
import { hash, holdsSecret, log, mapLimit, plainText, UserError } from '../util.js'
import { builtInSound, typingSound } from '../voice/effects.js'
import { autoVoice, durationOf, markedLine, narrate, parseVoice, stripMarks, withProsody } from '../voice/index.js'
import { launchChromium } from './chromium.js'
import { CHROME_MAX, openDisplay, pickCapture, recordScreen, recordScreencast } from './capture.js'
import { centerOf, createCursor } from './cursor.js'
import { createGuard, setupNetwork } from './network.js'
import { OVERLAY } from './overlay.js'
import { needsPrep, prepare, saveSession, sessionPath } from './session.js'
import { dismissing, hideTyped, locate, plainHelpers, runSteps, setStepTimeout, spokenLines } from './steps.js'
import { maskInPage } from './mask.js'
import { clickWithEffect, reportFindings, reviewVideo, watchPage } from './review.js'
import { markOffered, resolveTarget } from './targets.js'
import { guideEntry, writeGuide } from '../guide.js'
import { drawFrame } from './frame.js'
import { resolveTheme, safePath, themeCss, titleHtml } from './theme.js'
import { callout, camera, cameraOut, captionClear, filePicker, focusOff, focusOn, frame, hideTitle, setCaption, showTitle, spotlight, tap } from './visuals.js'

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

const DRY_RUN_TIMEOUT = 5000

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

/**
 * @param {import('../script/load.js').Loaded & { kind: 'browser' }} loaded
 * @param {Record<string, any>} opts     { out, voice, quality, capture, dryRun, timeout, onProgress, sessionNamespace, workDir }
 */
export const renderBrowser = async (loaded, opts, config = loadConfig()) => {
  const { name, dir, sandboxed } = loaded
  const shown = secretsShown(loaded.script.steps)
  if (shown.length) log.warn(`${shown.join(', ')}: a secret outside \`type\`/\`fill\` in \`steps\` (a narration, a caption…) can be seen or heard in the video`)
  const script = interpolate(loaded.script, { allowed: !sandboxed || config.api.allowSecrets, config })
  const progress = opts.onProgress ?? (() => {})
  // The command, then the script, then the person's own default (tourwright config set quality …)
  const quality = qualityOf(opts.quality ?? script.quality ?? config.render.quality)
  const width = opts.width ?? script.width ?? quality.width
  const height = opts.height ?? script.height ?? quality.height
  const fps = script.fps ?? config.render.fps
  const dryRun = Boolean(opts.dryRun)
  // Nobody chose one: the most natural voice this machine has for the script's language
  const voiceSpec = opts.voice ?? script.voice ?? (dryRun ? config.tts.defaultVoice : await autoVoice(script.language, config))
  const voice = dryRun || voiceSpec === 'none' ? null : voiceSpec
  // How big the page is drawn: a vertical video is filmed the way a phone shows the app, half as wide in CSS pixels at
  // twice the density, so the app uses its own mobile layout, filling the screen, big and sharp; `scale` chooses
  // another size. The frames still come out at width x height. The virtual display of capture "screen" draws at
  // 1x: `auto` films any other density as a screencast.
  const wanted = script.scale ?? (height > width ? 2 : 1)
  const mode = dryRun ? 'dry' : pickCapture(opts.capture ?? config.render.capture, config, { portrait: wanted !== 1 })
  if (mode === 'screen' && wanted !== 1) log.warn(`scale ${wanted}: capture "screen" draws the page at 1x; use --capture screencast for a bigger page`)
  const density = mode === 'screen' ? 1 : wanted
  const pageSize = { width: Math.round(width / density), height: Math.round(height / density), scale: density }
  const work = opts.workDir
  const theme = resolveTheme(script.theme, config.theme, dir, { sandboxed })
  const audio = script.audio ?? {}
  const effectsVolume = audio.effects ?? 1
  const speech = { aliases: script.voices, pause: audio.pause, pronounce: script.pronounce, language: script.language }
  // Unknown voices fail now, not halfway through the recording
  if (!dryRun) for (const spec of [voice, ...Object.values(script.voices ?? {})]) if (spec && spec !== 'none') parseVoice(spec, config, script.voices)
  if (sandboxed && script.hosts && Object.keys(script.hosts).length) throw new UserError('`hosts` is not available for API jobs')
  if (!dryRun && !config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')

  const { resolveUrl, origin } = urlResolver(script, dir, sandboxed)
  const guard = sandboxed ? createGuard(config.network) : null
  const uploads = new Map()
  const sessionFile = script.session ? sessionPath(config, script.session, opts.sessionNamespace) : null
  // --fresh: log in again instead of reusing the saved session
  if (opts.fresh && sessionFile) rmSync(sessionFile, { force: true })

  // Every line the script says is made ahead, a few at once, while the browser starts and logs in: on camera
  // each one is ready, or already on its way. A line that fails here fails again where it is said, with its step.
  let warming = !!voice && !loaded.run
  if (warming) {
    const filmed = opts.steps ? script.steps.slice(opts.steps[0] - 1, opts.steps[1]) : script.steps
    mapLimit(spokenLines(filmed), config.tts.parallel, async ([text, prosody]) => {
      if (!warming) return
      await narrate(text, withProsody(prosody.voice ?? voice, prosody), config, speech).catch(e => log.debug(`voice ahead: ${e.message}`))
    })
  }

  let browser
  let display = null
  let recorder = null
  const cleanup = async () => {
    warming = false
    recorder?.kill()
    await browser?.close().catch(() => {})
    display?.close()
  }

  try {
    if (mode === 'screen') display = await openDisplay(width, height, config)
    const locale = script.language === 'en' ? 'en-US' : script.language ?? 'es-CO'
    browser = await launch({ headless: mode !== 'screen', display: display?.display, width, height, locale }, config)
    const common = {
      ...(mode === 'screen' ? { viewport: null } : { viewport: { width: pageSize.width, height: pageSize.height }, deviceScaleFactor: pageSize.scale }),
      locale,
      timezoneId: opts.timezone ?? process.env.TZ ?? 'UTC',
      serviceWorkers: /** @type {'block'} */ ('block'),
    }

    // ── Off camera: log in, warm up pages, reuse a saved session ──────────────────────
    const network = { hosts: script.hosts, guard, uploads, origin }
    let state
    if (needsPrep(script, loaded, sessionFile)) {
      progress({ stage: 'setup' })
      state = await prepare({ browser, common, script, loaded, network, resolveUrl, sessionFile })
    }

    // ── On camera ─────────────────────────────────────────────────────────────────────
    const rawFile = join(work, mode === 'playwright' ? 'raw' : 'raw.mkv')
    const context = await browser.newContext({
      ...common,
      ...(state ? { storageState: state } : {}),
      ...(mode === 'playwright' ? { recordVideo: { dir: rawFile, size: { width, height } } } : {}),
    })
    const closeStreams = await setupNetwork(context, network)
    const blurCss = (script.blur ?? []).filter(t => typeof t === 'string').map(sel => `${sel} { filter: blur(8px) !important; }`).join('\n')
    await context.addInitScript(OVERLAY, [themeCss(theme), blurCss, theme.logo])
    // Real data on screen becomes invented data, on every page (and frame) of the video
    if (script.mask?.length) await context.addInitScript(maskInPage, script.mask)
    const page = await context.newPage()
    // A dry run is for finding mistakes: a missing element is reported in seconds, and the run goes on
    setStepTimeout(page, dryRun ? DRY_RUN_TIMEOUT : 30_000)
    page.on('pageerror', e => log.debug(`page error: ${e.message}`))
    const blocker = await dismissing(page, script.dismiss)
    // What goes wrong on the page while it is filmed, for the review at the end
    const watcher = watchPage(page, () => v.step)

    if (mode === 'screen') {
      // The window, sized so the content is exactly the video size with the browser bar above it
      const cdp = await context.newCDPSession(page)
      const { windowId } = await cdp.send('Browser.getWindowForTarget')
      const measure = () => page.evaluate(() => [window.outerHeight - window.innerHeight, window.innerWidth, window.innerHeight])
      const [bar] = await measure()
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width, height: height + bar } })
      await page.waitForTimeout(400)
      const [offsetY, w, h] = await measure()
      if (w !== width || h !== height) log.warn(`content is ${w}x${h} instead of ${width}x${height}`)
      recorder = await recordScreen({ display: display.display, width, height, offsetY, fps, file: rawFile }, config)
    } else if (mode === 'screencast') {
      await page.goto('about:blank')
      recorder = await recordScreencast({ page, context, width, height, fps, file: rawFile }, config)
    }
    const t0 = recorder?.startedAt ?? Date.now()
    const now = () => (Date.now() - t0) / 1000
    progress({ stage: 'recording' })

    // Timeline (recording seconds)
    const captions = []
    const marks = []
    const cuts = []
    const narrations = []
    const effects = []
    let cursorHidden = false
    let startS = 0
    let voiceUntil = 0
    // When the voice really stops; voiceUntil adds the breath before the next sentence
    let voiceEnd = 0
    const markStart = () => {
      if (!startS) startS = now()
    }
    const closeCaption = () => {
      const last = captions.at(-1)
      if (last && last.end === undefined) last.end = now()
    }
    const wait = ms => page.waitForTimeout(dryRun ? Math.min(ms, 20) : ms)
    // A new caption, a title card or a cut wait for the previous narration to finish
    const waitVoice = async () => {
      const left = voiceUntil - now()
      if (left > 0 && !dryRun) await page.waitForTimeout(left * 1000)
    }
    // An action that follows what was said starts as the voice stops, not a breath later
    const waitSpeech = async () => {
      const left = voiceEnd - now()
      if (left > 0 && !dryRun) await page.waitForTimeout(left * 1000)
    }

    const cursor = createCursor(page, { width: pageSize.width, height: pageSize.height, dryRun })
    const moveTo = cursor.moveTo
    // Where the cursor goes; the caption gets out of its way first. Waiting for the element to show up (the result
    // of a search, a list still loading) is cut from the video once the voice has stopped: no dead air.
    const center = async locator => {
      const from = now()
      await locator.waitFor({ state: 'visible' })
      const quiet = Math.max(from, voiceEnd)
      if (!dryRun && now() - quiet > 0.3) cuts.push([quiet, now()])
      const at = await centerOf(page, locator, dryRun)
      if (!dryRun) await captionClear(page, at)
      return at
    }

    // Slow preparation (a voice or a sound made for the first time) is cut from the video
    const offClock = async fn => {
      const from = now()
      try {
        return await fn()
      } finally {
        if (now() - from > 0.3) cuts.push([from, now()])
      }
    }
    const soundFile = async file => {
      const built = await offClock(() => builtInSound(file, config))
      if (built) return built
      const path = safePath(file, dir, sandboxed)
      if (!existsSync(path)) throw new UserError(`sound not found: ${file} (built-in: click, pop, ding, whoosh)`)
      return path
    }
    const clickSound = audio.clicks && !dryRun ? await soundFile(audio.clicks === true ? 'click' : audio.clicks) : null
    const effect = (file, volume = 1) => effects.push({ at: now(), file, volume: volume * effectsVolume })
    // A page still loading is cut from the video, except while the voice speaks (the cut would shorten what
    // follows it and the next line would overlap). An app that never goes quiet (polling, live events) waits 10 s.
    const settle = async () => {
      const idle = () => page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
      await (now() < voiceEnd ? idle() : offClock(idle))
      await cursor.restore()
    }

    // The camera stays close after a zoomed focus, until a step that needs the whole page (steps.js)
    let cameraHeld = false
    const v = {
      page,
      context,
      dryRun,
      goto: async path => {
        await page.goto(resolveUrl(path), { waitUntil: 'domcontentloaded' }).catch(error => {
          if (/ERR_BLOCKED_BY_CLIENT/.test(error.message)) throw new UserError(`${path}: blocked by the network policy of this server (TOURWRIGHT_ALLOWED_HOSTS / TOURWRIGHT_BLOCK_PRIVATE)`)
          throw error
        })
        await settle()
      },
      back: async () => {
        await page.goBack({ waitUntil: 'domcontentloaded' })
        await settle()
      },
      reload: async () => {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await settle()
      },
      // look: { kicker, animation, background }; the theme's titleAnimation and titleBackground are the defaults
      // With a voice the card only holds a beat after it: the viewer has just heard what it says
      title: async (text, subtitle = '', ms = undefined, speak = undefined, prosody = undefined, look = {}) => {
        ms ??= speak ? 700 : 2500
        await waitVoice()
        await showTitle(page, titleHtml({ text, subtitle, kicker: look.kicker, animation: look.animation ?? theme.titleAnimation, background: look.background ?? theme.titleBackground, logo: theme.logo }))
        await page.waitForTimeout(150)
        markStart()
        marks.push({ start: now(), title: text })
        if (speak) {
          await speakNow(speak, prosody)
          await waitVoice()
        }
        await wait(ms)
        await hideTitle(page)
        await wait(450)
      },
      // A chapter of the video starting here, with nothing on screen
      chapter: async name => {
        markStart()
        marks.push({ start: now(), title: name })
      },
      say: async (html, options = {}) => {
        const { speak, ms = 0, silent = false, ...prosody } = typeof options === 'number' ? { ms: options } : options
        await waitVoice()
        // Text and voice start together: the voice is synthesized before the caption shows (instant when
        // cached). The time it takes is cut from the video: the screen is still meanwhile.
        const narration = html && !silent ? await synth(speak ?? plainText(html), prosody) : null
        if (html) html = stripMarks(html)
        await setCaption(page, html)
        closeCaption()
        markStart()
        if (html) captions.push({ start: now(), text: plainText(html) })
        if (narration) play(narration)
        if (ms) await wait(ms)
      },
      click: async (locator, options = {}) => {
        locator = locator.first()
        const { x, y } = await center(locator)
        await moveTo(x, y)
        await wait(250)
        if (clickSound) effect(clickSound)
        const changed = await clickWithEffect(page, locator, async () => {
          await locator.click(options)
          await wait(400)
        })
        if (changed === false) watcher.add({ kind: 'no-effect', message: `the click on ${locator} changed nothing on the page (wrong element, or it needs a wait?)` })
      },
      check: async (locator, on = true) => {
        locator = locator.first()
        const { x, y } = await center(locator)
        await moveTo(x, y)
        await wait(250)
        if (clickSound) effect(clickSound)
        await locator.setChecked(on)
        await wait(400)
      },
      drag: async (from, to) => {
        const a = await center(from.first())
        const box = await to.first().boundingBox()
        if (!box) throw new UserError('drop target is not visible')
        await moveTo(a.x, a.y)
        await wait(200)
        await page.mouse.down()
        await moveTo(box.x + box.width / 2, box.y + box.height / 2)
        await wait(200)
        await page.mouse.up()
        await wait(500)
      },
      hover: async locator => {
        const { x, y } = await center(locator.first())
        await moveTo(x, y)
        await wait(400)
      },
      type: async (locator, text, delay = 70) => {
        locator = locator.first()
        if (holdsSecret(text)) await hideTyped(locator)
        // Into the field and typing at once: a click that only focuses needs no pause after it
        const { x, y } = await center(locator)
        await moveTo(x, y)
        await wait(150)
        if (clickSound) effect(clickSound)
        await locator.click()
        await wait(120)
        if (audio.typing && !dryRun && text) effect(await offClock(() => typingSound(text.length, delay, config)), 0.8)
        await locator.pressSequentially(text, { delay: dryRun ? 0 : delay })
        await wait(300)
      },
      highlight: async (locator, ms = 2500) => {
        locator = locator.first()
        await locator.scrollIntoViewIfNeeded()
        const box = await locator.boundingBox()
        if (!box) return
        await frame(page, box, ms)
        await wait(ms)
      },
      spotlight: async (locator, ms = 2500) => {
        locator = locator.first()
        await locator.scrollIntoViewIfNeeded()
        const box = await locator.boundingBox()
        if (!box) return
        await spotlight(page, box, ms)
        await wait(ms + 400)
      },
      callout: async (locator, html, { ms = 3000, position = 'auto' } = {}) => {
        locator = locator.first()
        await locator.scrollIntoViewIfNeeded()
        const box = await locator.boundingBox()
        if (!box) return
        await callout(page, box, html, ms, position)
        await wait(ms + 300)
      },
      cursor: async visible => {
        cursorHidden = !visible
        await page.evaluate(hidden => document.documentElement.classList.toggle('tw-no-cursor', hidden), cursorHidden)
      },
      sound: async ({ file, volume = 1, wait: hold = false }) => {
        if (dryRun) return
        const path = await soundFile(file)
        effect(path, volume)
        if (hold) await wait((await durationOf(path, config)) * 1000)
      },
      zoom: async (locator, ms = 2500, scale = 1.6) => {
        await v.releaseCamera()
        locator = locator.first()
        await locator.scrollIntoViewIfNeeded()
        const b = await locator.boundingBox()
        if (!b) return
        // The element fits whole, and never less than a noticeable zoom
        const e = Math.max(1.15, Math.min(scale, (pageSize.width * 0.85) / b.width, (pageSize.height * 0.7) / b.height))
        await camera(locator, e)
        await wait(900 + ms)
        await camera(locator, 1)
        await wait(900)
      },
      focus: async (locator, options = {}) => {
        // The hold after the voice is short: a long silence before the next action loses the viewer
        const { text, say, caption, step, zoom: asked, pulse, click, ms = click ? 150 : 600, position, ...prosody } = options
        locator = locator.first()
        // Never closer than the element fits whole, with a margin: a wide field on a phone is not cut by the camera
        const size = asked && asked > 1 ? await locator.evaluate(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height } }).catch(() => null) : null
        const fits = size ? Math.min((pageSize.width * 0.9) / Math.max(1, size.w), (pageSize.height * 0.6) / Math.max(1, size.h)) : 1
        const zoom = asked && asked > 1 ? Math.min(asked, fits) : asked
        // Under a gentle 8 %, a push in is not worth the movement
        const zoomed = Boolean(zoom && zoom >= 1.08)
        await waitVoice()
        // "{Pay}" marks the word the focus lands on. Its time is the length of what is said before it
        // (synthesized on its own; cached like any sentence), a little early as the eye needs it.
        const { spoken, before } = markedLine(say)
        const narration = spoken ? await synth(plainText(spoken), prosody) : null
        const lead = narration && /[\p{L}\p{N}]/u.test(before ?? '') ? await synth(plainText(before), prosody) : null
        const at = lead ? Math.max(0, lead.duration - 0.25) : 0
        // Held close from the focus before: a zoomed focus glides there, any other goes back to the whole page first
        if (cameraHeld && zoomed) {
          await camera(locator, zoom)
          await wait(dryRun ? 0 : 700)
        } else await v.releaseCamera()
        // The voice starts and the cursor glides there meanwhile: no silence while it travels
        const target = await center(locator)
        const { x, y } = target
        const shown = caption ?? (spoken || null)
        if (shown) {
          const html = stripMarks(shown)
          await setCaption(page, html)
          if (!dryRun) await captionClear(page, target)
          closeCaption()
          markStart()
          captions.push({ start: now(), text: plainText(html) })
        } else markStart()
        if (narration) play(narration)
        const started = now()
        await moveTo(x, y)
        const left = at - (now() - started)
        if (left > 0) await wait(left * 1000)
        if (zoomed && !cameraHeld) {
          // The focus lands once the camera has done most of its move: a layer chasing a fast element lags
          await camera(locator, zoom)
          await wait(450)
        }
        await focusOn(locator, { html: text, step, pulse, position, zoom: zoomed ? zoom : 1 })
        if (zoomed) {
          // The element moved under the camera: the cursor follows it
          await wait(250)
          const box = await locator.boundingBox()
          if (box) await moveTo(box.x + box.width / 2, box.y + box.height / 2)
        }
        await waitSpeech()
        await wait(ms)
        // The focus fades out and the camera stays close: what comes next (typing in the field, the click) is seen
        // up close, and the next zoomed focus glides from here. Other steps take it back (releaseCamera).
        await focusOff(page)
        cameraHeld = Boolean(zoomed)
        if (click) await v.click(locator)
      },
      scrollTo: async locator => {
        await locator.first().evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
        await wait(900)
      },
      scroll: async dy => {
        await page.evaluate(dy => window.scrollBy({ top: dy, behavior: 'smooth' }), dy)
        await wait(900)
      },
      pause: ms => wait(ms),
      // What happens inside `fn` is cut from the video: wait minutes without boring anyone
      offCamera: async fn => {
        await waitVoice()
        const from = now()
        try {
          return await fn()
        } finally {
          cuts.push([from, now()])
        }
      },
      blur: locator => locator.evaluateAll(els => els.forEach(el => el.classList.add('tw-blur'))),
      // The real chooser of the system never shows in a recording: the cursor clicks where the file goes, a drawn
      // chooser picks the files, and they are put in the field
      upload: async (locator, files) => {
        const paths = files.map(f => safePath(f, dir, sandboxed))
        for (const p of paths) uploads.set(basename(p), p)
        locator = locator.first()
        if (!dryRun) {
          // A file field is often hidden behind its label (a drop zone): the cursor goes to what is seen
          const box = await locator.evaluate(el => {
            const seen = e => e && e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 12
            const host = [el, /** @type {HTMLInputElement} */ (el).labels?.[0], el.closest('label'), el.parentElement].find(seen)
            if (!host) return null
            host.scrollIntoView({ block: 'center', behavior: 'smooth' })
            return true
          })
          if (box) {
            await wait(300)
            const r = await locator.evaluate(el => {
              const seen = e => e && e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 12
              const host = [el, /** @type {HTMLInputElement} */ (el).labels?.[0], el.closest('label'), el.parentElement].find(seen)
              const b = host.getBoundingClientRect()
              return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
            })
            await moveTo(r.x, r.y)
            await wait(200)
            if (clickSound) effect(clickSound)
            await tap(page, r.x, r.y)
            await wait(250)
          }
          const en = (script.language ?? 'es').startsWith('en')
          await filePicker(page, paths.map(p => basename(p)), en ? { title: 'Open file', open: 'Open', folder: 'Documents' } : { title: 'Abrir archivo', open: 'Abrir', folder: 'Documentos' })
          if (clickSound) effect(clickSound)
        }
        await locator.setInputFiles(paths)
        await wait(450)
      },
      releaseCamera: async () => {
        if (!cameraHeld) return
        cameraHeld = false
        if (await cameraOut(page).catch(() => false)) await wait(dryRun ? 0 : 750)
      },
      // The cursor goes to the list and clicks before the choice changes
      select: async (locator, value) => {
        locator = locator.first()
        const { x, y } = await center(locator)
        await moveTo(x, y)
        await wait(200)
        if (clickSound) effect(clickSound)
        if (!dryRun) await tap(page, x, y)
        await wait(250)
        await locator.selectOption(value)
        await wait(450)
      },
    }
    // A line may name its own voice (from the cast) and how to say it
    const synth = async (text, prosody = {}) => {
      const base = prosody.voice ?? voice
      if (dryRun || !text || !base || base === 'none') return null
      // A failed narration fails the job (like slides) instead of finishing a silent video as done.
      return offClock(() => narrate(text, withProsody(base, prosody), config, speech))
    }
    const play = n => {
      narrations.push({ at: now(), file: n.file })
      voiceEnd = now() + n.duration
      voiceUntil = voiceEnd + 0.4
    }
    const speakNow = async (text, prosody) => {
      const n = await synth(text, prosody)
      if (n) play(n)
    }
    // Which step is being filmed, for the CLI and the job's progress
    const total = opts.steps ? opts.steps[1] : script.steps.length
    v.progress = step => progress({ stage: 'recording', step, steps: total })
    // Spanish names for the helpers of JavaScript scripts
    Object.assign(v, { ir: v.goto, titulo: v.title, leyenda: (h, o) => v.say(h, o && typeof o === 'object' && 'dice' in o ? { ...o, speak: o.dice } : o),
      clic: v.click, escribir: v.type, resaltar: v.highlight, acercar: v.zoom, ocultar: v.blur, bajarHasta: v.scrollTo, fueraDeCamara: v.offCamera, subir: v.upload, elegir: v.select })

    // Before each step: whatever `dismiss` names is closed off camera, so the viewer never sees it
    // On a page it has not seen yet it also waits a moment, cut from the video: tours open just after the page.
    if (script.dismiss?.length) {
      let seen = ''
      v.beforeStep = async () => {
        let open = await blocker.pending()
        if (!open && page.url() !== seen) {
          seen = page.url()
          open = await v.offCamera(() => blocker.pending(1500))
        }
        if (open) await v.offCamera(async () => {
          await open.click().catch(() => {})
          await page.waitForTimeout(400)
        })
      }
    }

    for (const t of (script.blur ?? []).filter(t => typeof t !== 'string')) {
      page.on('load', () => v.blur(locate(page, t)).catch(() => {}))
    }
    page.on('domcontentloaded', () => {
      if (cursorHidden) page.evaluate(() => document.documentElement.classList.add('tw-no-cursor')).catch(() => {})
    })

    // `tourwright guide`: before each step, its element marked and the page captured; the text from the narration
    const guide = opts.guide ? [] : null
    if (guide) {
      v.onStep = async step => {
        const entry = guideEntry(step, script.language)
        if (!entry) return
        // Which step of the script it is (`tourwright narrate` writes back to it)
        entry.step = v.step
        const previous = guide.at(-1)
        // A focus on a field, then typing in it: one step of the guide, with what to type
        if ((step.type || step.fill) && previous?.merge && JSON.stringify(previous.target) === JSON.stringify(entry.target)) {
          previous.detail = entry.example
          previous.merge = false
          return
        }
        // Something only shown (a highlight, a zoom): its picture goes with the paragraph before, or alone
        if (entry.kind === 'look') {
          if (previous?.kind === 'text' && !previous.image) {
            previous.image = await shoot(entry.target)
            return
          }
          guide.push({ kind: 'text', text: entry.text, image: await shoot(entry.target) })
          return
        }
        if (entry.kind === 'step') entry.image = await shoot(entry.target)
        guide.push(entry)
      }
      // The page now, with the element marked, without Tourwright's own caption and cursor
      const shoot = async target => {
        const locator = target === undefined ? null : await resolveTarget(page, target, 5000).catch(() => null)
        const box = locator && (await locator.first().scrollIntoViewIfNeeded().then(() => locator.first().boundingBox()).catch(() => null))
        await page.evaluate(box => {
          // Tourwright's own layers (caption, cursor, title card, focus…) stay out of the picture
          const style = document.createElement('style')
          style.id = 'tw-guide-style'
          style.textContent = '#tw-caption, #tw-cursor, #tw-ripple, #tw-title, .tw-frame, .tw-spot, .tw-callout, .tw-focus, .tw-ring, .tw-step { display: none !important }'
          document.documentElement.append(style)
          if (!box) return
          const mark = document.createElement('div')
          mark.id = 'tw-guide-mark'
          mark.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${box.x - 6}px;top:${box.y - 6}px;width:${box.width + 12}px;height:${box.height + 12}px;border:3px solid #e11d48;border-radius:10px;box-shadow:0 0 0 4000px rgba(0,0,0,.12)`
          document.documentElement.append(mark)
        }, box).catch(() => {})
        const image = await page.screenshot({ type: 'jpeg', quality: 80 }).catch(() => undefined)
        await page.evaluate(() => {
          document.getElementById('tw-guide-mark')?.remove()
          document.getElementById('tw-guide-style')?.remove()
        }).catch(() => {})
        return image
      }
    }

    try {
      if (loaded.run) await loaded.run({ page, context, v })
      else if (opts.steps) {
        // A preview of some steps: the ones before run fast and off camera (like `setup`), then these are filmed
        const [from, to] = opts.steps
        if (from > script.steps.length) throw new UserError(`--step ${from}: the script has ${script.steps.length} steps`)
        const quick = plainHelpers(page, resolveUrl, uploads, f => safePath(f, dir, sandboxed))
        await v.offCamera(() => runSteps(script.steps.slice(0, from - 1), quick, page, false))
        await runSteps(script.steps.slice(from - 1, to), v, page, true, from - 1)
      } else await runSteps(script.steps, v, page)
    } catch (error) {
      const shot = join(opts.failureDir ?? work, `failure-${name}.png`)
      // A missing element: the screenshot marks what the page offers instead, with the target of each
      if (['element_not_found', 'steps_failed'].includes(error.code)) await markOffered(page)
      await page.screenshot({ path: shot }).catch(() => {})
      error.screenshot = shot
      throw error
    }
    await waitVoice()
    await wait(800)
    closeCaption()
    const end = now()

    if (dryRun) {
      closeStreams()
      if (sessionFile) saveSession(sessionFile, await context.storageState())
      await context.close()
      reportFindings(watcher.findings)
      // `collect`: the steps and their pictures, for `tourwright narrate`; else the guide's files
      if (guide && opts.guide === 'collect') return { entries: guide, title: script.title ?? name, language: script.language }
      if (guide) return { guide: writeGuide({ title: script.title ?? name, language: script.language, entries: guide, out: opts.out }), title: script.title ?? name }
      return { dryRun: true, title: script.title ?? name, seconds: Number(end.toFixed(1)), chapters: marks.length, captions: captions.length, review: watcher.findings }
    }

    let source = rawFile
    if (recorder) {
      await recorder.stop()
      recorder = null
    }
    closeStreams()
    // The newest session (apps rotate refresh tokens): the one that works next time
    if (sessionFile) saveSession(sessionFile, await context.storageState())
    const video = page.video()
    await context.close()
    if (mode === 'playwright') source = await video.path()

    progress({ stage: 'encoding' })
    const music = typeof script.music === 'string' ? { file: script.music } : script.music
    const studioFrame = theme.frame === 'window' ? await drawFrame(browser, { width, height, theme, title: script.title ?? name, workDir: work }) : null
    const result = await compose({
      video: source,
      fps,
      end,
      cuts: [[0, startS], ...cuts],
      narrations,
      effects,
      captions,
      marks,
      music: music ? { ...music, file: safePath(music.file, dir, sandboxed) } : null,
      polish: audio.polish,
      out: opts.out,
      sidecar: opts.sidecar,
      title: script.title ?? name,
      language: script.language ?? (voice ? voiceLanguage(voice) : undefined),
      quality,
      workDir: work,
      voice,
      frame: studioFrame,
    }, config)
    // The finished video is looked at too; the findings go into its manifest
    const review = [...watcher.findings, ...(await reviewVideo(result.paths.video, config))]
    reportFindings(review)
    writeFileSync(result.paths.manifest, JSON.stringify({ ...JSON.parse(readFileSync(result.paths.manifest, 'utf8')), review }, null, 2))
    return { ...result, review }
  } finally {
    await cleanup()
  }
}

const voiceLanguage = spec => /(?:^|[:_-])(es|en|pt|fr|de|it)[_-]/i.exec(spec)?.[1]?.toLowerCase()

export const sessionNamespaceFor = token => (token ? `api-${hash(token, 12)}` : 'local')
