// Browser walkthroughs: a real Chromium follows the script while it is filmed; the narration, captions,
// chapters and cuts are assembled afterwards by compose(). This module runs the stages in order; each one lives
// next to it (`tourwright guide` collects its pictures with render/guide/):
//
//   plan.js      what the video will be (size, device, voice, capture), checked before anything opens
//   studio.js    the browser, the off-camera login, the dressed page and the recording
//   clock.js     the recording's clock: captions, chapters, cuts, narration, effects
//   stage.js     what every filmed step shares: the way to an element, the cursor, the voice, the sounds
//   helpers/     the helpers `v` the steps run on (navigation, narration, pointer, camera)
//   deliver.js   the finished video, its review and, with --keep, its source
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '#core/config.js'
import { interpolate, secretsShown } from '#script/load.js'
import { hash, log, mapLimit, UserError } from '#core/util.js'
import { narrate, withProsody } from '#voice/index.js'
import { writeGuide } from '#render/guide/write.js'
import { urlResolver } from '#render/browser/launch.js'
import { createGuard } from '#render/browser/network.js'
import { watchPage } from '#render/page/review.js'
import { reportFindings } from '#video/review.js'
import { sessionPath } from '#render/browser/session.js'
import { plainHelpers } from '#render/steps/quick.js'
import { dismissing, runSteps, spokenLines } from '#render/steps/index.js'
import { markOffered } from '#render/steps/targets.js'
import { safePath } from '#render/page/theme.js'
import { createClock } from './clock.js'
import { deliver } from './deliver.js'
import { collectGuide } from '#render/guide/collect.js'
import { createHelpers } from './helpers/index.js'
import { planWalkthrough } from './plan.js'
import { createStage } from './stage.js'
import { openStudio } from './studio.js'

export { launch, urlResolver } from '#render/browser/launch.js'
export { DEVICES } from './plan.js'

/**
 * Every line the script says is made ahead, a few at once, while the browser starts and logs in: on camera each
 * one is ready, or already on its way. A line that fails here fails again where it is said, with its step.
 * @returns {() => void} stops it
 */
const warmVoices = (script, plan, opts, config) => {
  let warming = true
  const filmed = opts.steps ? script.steps.slice(opts.steps[0] - 1, opts.steps[1]) : script.steps
  mapLimit(spokenLines(filmed), config.tts.parallel, async ([text, prosody]) => {
    if (!warming) return
    await narrate(text, withProsody(prosody.voice ?? plan.voice, prosody), config, plan.speech).catch(e => log.debug(`voice ahead: ${e.message}`))
  })
  return () => {
    warming = false
  }
}

/** The steps of the script on the helpers: all of them, a preview of some (--step), or a JavaScript script */
const runScript = async ({ loaded, script, v, page, opts, resolveUrl, uploads }) => {
  if (loaded.run) return loaded.run({ page, context: v.context, v })
  if (!opts.steps) return runSteps(script.steps, v, page)
  // A preview of some steps: the ones before run fast and off camera (like `setup`), then these are filmed
  const [from, to] = opts.steps
  if (from > script.steps.length) throw new UserError(`--step ${from}: the script has ${script.steps.length} steps`)
  const quick = plainHelpers(page, resolveUrl, uploads, f => safePath(f, loaded.dir, loaded.sandboxed))
  await v.offCamera(() => runSteps(script.steps.slice(0, from - 1), quick, page, false))
  await runSteps(script.steps.slice(from - 1, to), v, page, true, from - 1)
}

/**
 * @param {import('#script/load.js').Loaded & { kind: 'browser' }} loaded
 * @param {Record<string, any>} opts     { out, voice, quality, capture, dryRun, safe, keep, timeout, onProgress, sessionNamespace, workDir }
 */
export const renderBrowser = async (loaded, opts, config = loadConfig()) => {
  const { name, dir, sandboxed } = loaded
  const shown = secretsShown(loaded.script.steps)
  if (shown.length) log.warn(`${shown.join(', ')}: a secret outside \`type\`/\`fill\` in \`steps\` (a narration, a caption…) can be seen or heard in the video`)
  const script = interpolate(loaded.script, { allowed: !sandboxed || config.api.allowSecrets, config })
  const progress = opts.onProgress ?? (() => {})
  const plan = await planWalkthrough(loaded, script, opts, config)
  const { dryRun, safe } = plan

  const { resolveUrl, origin } = urlResolver(script, dir, sandboxed)
  const uploads = new Map()
  const network = { hosts: script.hosts, guard: sandboxed ? createGuard(config.network) : null, uploads, origin }
  const sessionFile = script.session ? sessionPath(config, script.session, opts.sessionNamespace) : null
  // --fresh: log in again instead of reusing the saved session
  if (opts.fresh && sessionFile) rmSync(sessionFile, { force: true })

  const stopWarming = plan.voice && !loaded.run ? warmVoices(script, plan, opts, config) : () => {}
  /** @type {import('./studio.js').Studio | null} */
  let studio = null
  try {
    studio = await openStudio({ plan, script, loaded, opts, config, network, resolveUrl, sessionFile, progress })
    // Past the time limit the browser and the recording close, and the steps waiting on them fail and stop
    const opened = studio
    opts.signal?.addEventListener('abort', () => void opened.close(), { once: true })
    const { page, context } = studio
    const blocker = await dismissing(page, script.dismiss)
    const clock = createClock(page, { dryRun, startedAt: studio.startedAt })
    progress({ stage: 'recording' })
    // What goes wrong on the page while it is filmed, for the review at the end
    /** @type {Record<string, any>} */
    let v = {}
    const watcher = watchPage(page, () => v.step)
    const stage = await createStage({ page, context, loaded, script, plan, clock, watcher, resolveUrl, uploads, config })
    v = createHelpers(stage, { blocker, progress, total: opts.steps ? opts.steps[1] : script.steps.length })
    const guide = opts.guide ? collectGuide(page, v, script.language) : null

    try {
      await runScript({ loaded, script, v, page, opts, resolveUrl, uploads })
    } catch (error) {
      const shot = join(opts.failureDir ?? opts.workDir, `failure-${name}.png`)
      // A missing element: the screenshot marks what the page offers instead, with the target of each
      if (['element_not_found', 'steps_failed'].includes(error.code)) await markOffered(page)
      await page.screenshot({ path: shot }).catch(() => {})
      error.screenshot = shot
      throw error
    }
    await clock.waitVoice()
    await clock.wait(800)
    clock.closeCaption()
    await stage.lookForDates()
    const end = clock.now()
    const source = await studio.stop()

    if (dryRun) {
      reportFindings(watcher.findings)
      // `collect`: the steps and their pictures, for `tourwright narrate`; else the guide's files
      if (guide && opts.guide === 'collect') return { entries: guide, title: plan.title, language: script.language }
      if (guide) return { guide: writeGuide({ title: plan.title, language: script.language, entries: guide, out: opts.out }), title: plan.title }
      if (safe && v.skipped.length) {
        log.info(`safe dry run: ${v.skipped.length} action${v.skipped.length > 1 ? 's' : ''} found but not performed${v.unchecked ? `; ${v.unchecked} step${v.unchecked > 1 ? 's' : ''} after them could not be checked` : ''}`)
      }
      return { dryRun: true, ...(safe ? { safe: true, skipped: v.skipped, unchecked: v.unchecked ?? 0 } : {}), title: plan.title,
        seconds: Number(end.toFixed(1)), chapters: clock.marks.length, captions: clock.captions.length, review: watcher.findings }
    }

    progress({ stage: 'encoding' })
    return await deliver({ source, end, clock, plan, script, loaded, browser: studio.browser, findings: watcher.findings, opts, config })
  } finally {
    stopWarming()
    await studio?.close()
  }
}

export const sessionNamespaceFor = token => (token ? `api-${hash(token, 12)}` : 'local')
