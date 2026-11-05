// What every filmed step shares: the cursor, the way to an element (waiting for it off the video), the voice, the
// sounds, and the eye on the page that feeds the review (a caption in the way, a page too small, a date shown).
import { existsSync } from 'node:fs'
import { UserError } from '#core/util.js'
import { builtInSound } from '#voice/effects.js'
import { narrate, withProsody } from '#voice/index.js'
import { centerOf, createCursor } from '#render/page/cursor.js'
import { checkLayout } from '#render/page/review.js'
import { setStepTimeout } from '#render/steps/index.js'
import { safePath } from '#render/page/theme.js'
import { captionClear } from '#render/page/visuals.js'

/**
 * @param {{
 *   page: import('playwright').Page, context: import('playwright').BrowserContext, loaded: { dir: string, sandboxed: boolean },
 *   script: Record<string, any>, plan: import('./plan.js').Plan, clock: import('./clock.js').Clock,
 *   watcher: { add: (finding: any) => void }, resolveUrl: (path: string) => string, uploads: Map<string, string>,
 *   config: Record<string, any>
 * }} p
 */
export const createStage = async ({ page, context, loaded, script, plan, clock, watcher, resolveUrl, uploads, config }) => {
  const { dryRun, safe, pageSize } = plan
  const { now } = clock
  const cursor = createCursor(page, { width: pageSize.width, height: pageSize.height, dryRun })

  // A caption that cannot get out of the way (an element as tall as the screen) is said once per element
  const clearCaption = async (at, locator) => {
    if (await captionClear(page, at)) watcher.add({ kind: 'caption', message: `the caption covers ${locator} even at the top of the screen (focus a smaller element, or a shorter caption)` })
  }

  // A filled date field on camera (a birth date, the issue date of an ID) helps prove who someone is: said once each
  const datesSeen = new Set()
  const masksDates = (script.mask ?? []).includes('date')
  const lookForDates = async () => {
    if (masksDates) return
    const fields = await page.evaluate(() => {
      const blurred = el => {
        for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).filter.includes('blur')) return true
        return false
      }
      return [...document.querySelectorAll('input[type=date], input[type=datetime-local], input[type=month]')]
        .filter(el => /** @type {HTMLInputElement} */ (el).value && el.getClientRects().length && !blurred(el))
        .map(el => (/** @type {HTMLInputElement} */ (el).labels?.[0]?.textContent ?? '').trim().slice(0, 40) || el.getAttribute('name') || el.id || 'a date field')
        .slice(0, 5)
    }).catch(() => [])
    for (const field of fields) {
      if (datesSeen.has(field)) continue
      datesSeen.add(field)
      watcher.add({ kind: 'privacy', message: `the date field "${field}" is filled and seen in the video: add \`mask: [date]\` or \`blur\` it (a birth or issue date helps prove who someone is)` })
    }
  }

  // Each address is looked at once: text too small to read, content wider than the video
  const laidOut = new Set()
  const lookAtLayout = async () => {
    const address = page.url().split('#')[0]
    if (dryRun || laidOut.has(address)) return
    laidOut.add(address)
    for (const message of await checkLayout(page, { density: plan.density, height: plan.height })) watcher.add({ kind: 'layout', message: `${address}: ${message}` })
  }

  // Where the cursor goes; the caption gets out of its way first. Waiting for the element to show up (the result
  // of a search, a list still loading) is cut from the video once the voice has stopped: no dead air.
  // `act`: the step will press it, so it also waits until it can (not moving, enabled, nothing on top of it)
  const center = async (locator, act = false) => {
    const from = now()
    await lookForDates()
    await locator.waitFor({ state: 'visible' })
    if (act) await locator.click({ trial: true })
    const quiet = Math.max(from, clock.voiceEnd)
    if (!dryRun && now() - quiet > 0.3) clock.cut(quiet)
    const at = await centerOf(page, locator, dryRun)
    if (!dryRun) await clearCaption(at, locator)
    await lookAtLayout()
    return at
  }

  // A page still loading is cut from the video, except while the voice speaks (the cut would shorten what
  // follows it and the next line would overlap). An app that never goes quiet (polling, live events) waits 10 s.
  const settle = async () => {
    const idle = () => page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await (now() < clock.voiceEnd ? idle() : clock.offClock(idle))
    await cursor.restore()
    await lookAtLayout()
  }

  // Sounds: a built-in one or a file next to the script
  const soundFile = async file => {
    const built = await clock.offClock(() => builtInSound(file, config))
    if (built) return built
    const path = safePath(file, loaded.dir, loaded.sandboxed)
    if (!existsSync(path)) throw new UserError(`sound not found: ${file} (built-in: click, pop, ding, whoosh)`)
    return path
  }
  const { audio } = plan
  const clickSound = audio.clicks && !dryRun ? await soundFile(audio.clicks === true ? 'click' : audio.clicks) : null
  const effect = (file, volume = 1, kind = 'sound') => clock.effect(file, volume * (audio.effects ?? 1), kind)
  // The sound of a click, when the script asks for it
  const clickNoise = () => {
    if (clickSound) effect(clickSound, 1, 'click')
  }

  // A line may name its own voice (from the cast) and how to say it. A failed narration fails the job (like
  // slides) instead of finishing a silent video as done.
  const synth = async (text, prosody = {}) => {
    const base = prosody.voice ?? plan.voice
    if (dryRun || !text || !base || base === 'none') return null
    const spec = withProsody(base, prosody)
    const n = await clock.offClock(() => narrate(text, spec, config, plan.speech))
    return { ...n, text, spec }
  }

  return {
    page,
    context,
    config,
    script,
    plan,
    clock,
    watcher,
    loaded,
    resolveUrl,
    uploads,
    dryRun,
    safe,
    cursor,
    moveTo: cursor.moveTo,
    center,
    clearCaption,
    lookForDates,
    settle,
    soundFile,
    effect,
    clickNoise,
    synth,
    // A safe dry run skipped an action: what would show up after it may never come, so later steps look briefly
    onSkip: () => setStepTimeout(page, 1500),
    // What changes as the steps go: the camera held close after a zoomed focus, the cursor hidden by a step
    state: { cameraHeld: false, cursorHidden: false },
  }
}

/** @typedef {Awaited<ReturnType<typeof createStage>>} Stage */
