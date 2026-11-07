// The studio: the browser opened the way the plan says, logged in off camera, the page dressed (overlay, theme,
// blur, mask, network guard) and the recording started.
import { join } from 'node:path'
import { log } from '#core/util.js'
import { openDisplay, recordScreen, recordScreencast } from '#render/browser/capture.js'
import { launch } from '#render/browser/launch.js'
import { maskInPage } from '#render/page/mask.js'
import { setupNetwork } from '#render/browser/network.js'
import { startGuardProxy } from '#render/browser/guard-proxy.js'
import { OVERLAY } from '#render/page/overlay.js'
import { needsPrep, prepare, saveSession } from '#render/browser/session.js'
import { setStepTimeout } from '#render/steps/index.js'
import { themeCss } from '#render/page/theme.js'

// A dry run is for finding mistakes: a missing element is reported in seconds, and the run goes on
const DRY_RUN_TIMEOUT = 5000
const STEP_TIMEOUT = 30_000

/**
 * @param {{
 *   plan: import('./plan.js').Plan, script: Record<string, any>, loaded: any, opts: Record<string, any>, config: Record<string, any>,
 *   network: { hosts?: any, guard: any, uploads: Map<string, string>, origin: string | undefined }, resolveUrl: (path: string) => string, sessionFile: string | null, progress: (p: any) => void,
 * }} p
 */
export const openStudio = async ({ plan, script, loaded, opts, config, network, resolveUrl, sessionFile, progress }) => {
  const { mode, width, height, fps, pageSize, browserOf, safe, dryRun, theme } = plan
  let browser = null
  let display = null
  let recorder = null
  let proxy = null
  const close = async () => {
    recorder?.kill()
    await browser?.close().catch(() => {})
    display?.close()
    proxy?.close()
  }
  try {
    // A strict sandbox: every connection of the browser goes through a proxy that checks it (each hop of a
    // redirect and WebSockets too), loopback included
    if (network.guard?.strict) proxy = await startGuardProxy(network.guard)
    if (mode === 'screen') display = await openDisplay(width, height, config)
    browser = await launch({ headless: mode !== 'screen', display: display?.display, width, height, locale: plan.locale }, config)
    const common = {
      ...(mode === 'screen' ? { viewport: null } : { viewport: { width: pageSize.width, height: pageSize.height }, deviceScaleFactor: pageSize.scale }),
      ...(browserOf ? { userAgent: browserOf.userAgent, hasTouch: true, ...(mode === 'screen' ? {} : { isMobile: browserOf.isMobile }) } : {}),
      locale: plan.locale,
      timezoneId: opts.timezone ?? process.env.TZ ?? 'UTC',
      serviceWorkers: /** @type {'block'} */ ('block'),
      ...(proxy ? { proxy: { server: proxy.server, bypass: '<-loopback>' } } : {}),
    }

    // ── Off camera: log in, warm up pages, reuse a saved session
    let state
    if (needsPrep(script, loaded, sessionFile)) {
      if (safe) log.warn('safe dry run: the off-camera `setup` runs for real (it logs in); a saved `session` avoids it')
      progress({ stage: 'setup' })
      state = await prepare({ browser, common, script, loaded, network, resolveUrl, sessionFile })
    }

    // ── On camera
    const rawFile = join(opts.workDir, mode === 'playwright' ? 'raw' : 'raw.mkv')
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
    setStepTimeout(page, dryRun ? DRY_RUN_TIMEOUT : STEP_TIMEOUT)
    page.on('pageerror', e => log.debug(`page error: ${e.message}`))

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

    return {
      browser,
      context,
      page,
      startedAt: recorder?.startedAt ?? Date.now(),
      close,
      /** Stops the recording, keeps the newest session and closes the page; the raw video file */
      stop: async () => {
        if (recorder) {
          await recorder.stop()
          recorder = null
        }
        closeStreams()
        // The newest session (apps rotate refresh tokens): the one that works next time
        if (sessionFile) saveSession(sessionFile, await context.storageState())
        const video = page.video()
        await context.close()
        return mode === 'playwright' ? await video.path() : rawFile
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}

/** @typedef {Awaited<ReturnType<typeof openStudio>>} Studio */
