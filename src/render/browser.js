// Browser walkthroughs: a real Chromium follows the script while it is filmed; the narration, captions,
// chapters and cuts are assembled afterwards by compose().
import { existsSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { compose, QUALITIES } from '../compose.js'
import { loadConfig } from '../config.js'
import { interpolate, secretsShown } from '../script/load.js'
import { hash, holdsSecret, log, plainText, UserError } from '../util.js'
import { builtInSound, typingSound } from '../voice/effects.js'
import { durationOf, markedLine, narrate, parseVoice, stripMarks, withProsody } from '../voice/index.js'
import { CHROME_MAX, openDisplay, pickCapture, recordScreen, recordScreencast } from './capture.js'
import { centerOf, createCursor } from './cursor.js'
import { createGuard, setupNetwork } from './network.js'
import { OVERLAY } from './overlay.js'
import { needsPrep, prepare, saveSession, sessionPath } from './session.js'
import { dismissing, hideTyped, locate, runSteps } from './steps.js'
import { resolveTheme, safePath, themeCss } from './theme.js'
import { callout, camera, focusOff, focusOn, frame, hideTitle, setCaption, showTitle, spotlight } from './visuals.js'

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
  if (config.browsersPath) process.env.PLAYWRIGHT_BROWSERS_PATH ??= config.browsersPath
  return chromium.launch({
    headless,
    ...(config.chromium ? { executablePath: config.chromium } : {}),
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
  const quality = QUALITIES[opts.quality ?? script.quality ?? 'hd']
  const width = opts.width ?? script.width ?? quality.width
  const height = opts.height ?? script.height ?? quality.height
  const fps = script.fps ?? 30
  const dryRun = Boolean(opts.dryRun)
  const voiceSpec = opts.voice ?? script.voice ?? config.tts.defaultVoice
  const voice = dryRun || voiceSpec === 'none' ? null : voiceSpec
  const mode = dryRun ? 'dry' : pickCapture(opts.capture, config)
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

  let browser
  let display = null
  let recorder = null
  const cleanup = async () => {
    recorder?.kill()
    await browser?.close().catch(() => {})
    display?.close()
  }

  try {
    if (mode === 'screen') display = await openDisplay(width, height, config)
    const locale = script.language === 'en' ? 'en-US' : script.language ?? 'es-CO'
    browser = await launch({ headless: mode !== 'screen', display: display?.display, width, height, locale }, config)
    const common = {
      ...(mode === 'screen' ? { viewport: null } : { viewport: { width, height }, deviceScaleFactor: 1 }),
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
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.on('pageerror', e => log.debug(`page error: ${e.message}`))
    const blocker = await dismissing(page, script.dismiss)

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

    const cursor = createCursor(page, { width, height, dryRun })
    const moveTo = cursor.moveTo
    const center = locator => centerOf(page, locator, dryRun)

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
    const settle = async () => {
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
      await cursor.restore()
    }

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
      title: async (text, subtitle = '', ms = 3500, speak, prosody) => {
        await waitVoice()
        await showTitle(page, text, subtitle)
        await page.waitForTimeout(150)
        markStart()
        marks.push({ start: now(), title: text })
        if (speak) {
          await speakNow(speak, prosody)
          await waitVoice()
        }
        await wait(ms)
        await hideTitle(page)
        await wait(600)
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
        await locator.click(options)
        await wait(400)
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
        await v.click(locator)
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
        locator = locator.first()
        await locator.scrollIntoViewIfNeeded()
        const b = await locator.boundingBox()
        if (!b) return
        // The element fits whole, and never less than a noticeable zoom
        const e = Math.max(1.15, Math.min(scale, (width * 0.85) / b.width, (height * 0.7) / b.height))
        await camera(locator, e)
        await wait(900 + ms)
        await camera(locator, 1)
        await wait(900)
      },
      focus: async (locator, options = {}) => {
        const { text, say, caption, step, zoom, pulse, click, ms = 1200, position, ...prosody } = options
        locator = locator.first()
        await waitVoice()
        // "{Pay}" marks the word the focus lands on. Its time is the length of what is said before it
        // (synthesized on its own; cached like any sentence), a little early as the eye needs it.
        const { spoken, before } = markedLine(say)
        const narration = spoken ? await synth(plainText(spoken), prosody) : null
        const lead = narration && /[\p{L}\p{N}]/u.test(before ?? '') ? await synth(plainText(before), prosody) : null
        const at = lead ? Math.max(0, lead.duration - 0.25) : 0
        // The cursor glides there while nothing else moves
        const { x, y } = await center(locator)
        await moveTo(x, y)
        const shown = caption ?? (spoken || null)
        if (shown) {
          const html = stripMarks(shown)
          await setCaption(page, html)
          closeCaption()
          markStart()
          captions.push({ start: now(), text: plainText(html) })
        } else markStart()
        if (narration) play(narration)
        if (at) await wait(at * 1000)
        if (zoom && zoom > 1) {
          // The focus lands once the camera has done most of its move: a layer chasing a fast element lags
          await camera(locator, zoom)
          await wait(550)
        }
        await focusOn(locator, { html: text, step, pulse, position, zoom })
        if (zoom && zoom > 1) {
          // The element moved under the camera: the cursor follows it
          await wait(350)
          const box = await locator.boundingBox()
          if (box) await moveTo(box.x + box.width / 2, box.y + box.height / 2)
        }
        await waitVoice()
        await wait(ms)
        // The focus fades out first, then the camera pulls back
        await focusOff(page)
        await wait(500)
        if (zoom && zoom > 1) {
          await camera(locator, 1)
          await wait(900)
        }
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
      upload: async (locator, files) => {
        const paths = files.map(f => safePath(f, dir, sandboxed))
        for (const p of paths) uploads.set(basename(p), p)
        await locator.setInputFiles(paths)
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
      voiceUntil = now() + n.duration + 0.4
    }
    const speakNow = async (text, prosody) => {
      const n = await synth(text, prosody)
      if (n) play(n)
    }
    // Spanish names for the helpers of JavaScript scripts
    Object.assign(v, { ir: v.goto, titulo: v.title, leyenda: (h, o) => v.say(h, o && typeof o === 'object' && 'dice' in o ? { ...o, speak: o.dice } : o),
      clic: v.click, escribir: v.type, resaltar: v.highlight, acercar: v.zoom, ocultar: v.blur, bajarHasta: v.scrollTo, fueraDeCamara: v.offCamera, subir: v.upload })

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

    try {
      if (loaded.run) await loaded.run({ page, context, v })
      else await runSteps(script.steps, v, page)
    } catch (error) {
      const shot = join(opts.failureDir ?? work, `failure-${name}.png`)
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
      return { dryRun: true, title: script.title ?? name, seconds: Number(end.toFixed(1)), chapters: marks.length, captions: captions.length }
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
    return await compose({
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
      title: script.title ?? name,
      language: script.language ?? (voice ? voiceLanguage(voice) : undefined),
      quality,
      workDir: work,
      voice,
    }, config)
  } finally {
    await cleanup()
  }
}

const voiceLanguage = spec => /(?:^|[:_-])(es|en|pt|fr|de|it)[_-]/i.exec(spec)?.[1]?.toLowerCase()

export const sessionNamespaceFor = token => (token ? `api-${hash(token, 12)}` : 'local')
