// One entry point for every kind of video: picks the renderer, owns the work folder, the CPU priority
// and the time limit.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setPriority, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig } from '#core/config.js'
import { loadPlugins } from '#plugins/index.js'
import { sleep, UserError } from '#core/util.js'
import { DOCUMENTS, EXPORTS, MEDIA } from '#script/schema.js'
import { renderBrowser } from './walkthrough/index.js'
import { renderSlides } from './slides.js'
import { printGuide } from './guide/pdf.js'

let prioritySet = false
const lowerPriority = config => {
  if (prioritySet || !config.nice) return
  prioritySet = true
  try {
    setPriority(Math.min(19, config.nice))
  } catch {
    // Not allowed: normal priority.
  }
  try {
    execFileSync('ionice', ['-c', '3', '-p', String(process.pid)], { stdio: 'ignore' })
  } catch {
    // No ionice on this system.
  }
}

// `out`: a path ending in .mp4, or a folder (the video is named after the script). By default each video
// gets its own folder, videos/<name>/, with everything that belongs to it.
export const outputBase = (out, name) => {
  if (!out) return resolve('videos', name, name)
  const path = resolve(out)
  return path.endsWith('.mp4') ? path.slice(0, -4) : join(path, name)
}

// What a render delivers besides the subtitles, the poster and the manifest, which always come. Only what is
// asked for is made, one thing after another (never two browsers at once):
//   video   the narrated video (.mp4)
//   audio   only the sound: narration, music and effects (.mp3)
//   silent  the video without sound (-silent.mp4), to put another voice or music over it
//   guide   a step-by-step guide with a picture per step (.guide.html, one file, and .guide.md)
//   pdf     that guide printed as a PDF, with the script's brand (.guide.pdf)
//   docx    that guide as a Word file (.guide.docx)
export { DOCUMENTS, EXPORTS, MEDIA }

// The manifest lists every file the render delivered
const recordFiles = result => {
  result.files = Object.fromEntries(Object.entries(result.paths).filter(([, f]) => f).map(([k, f]) => [k, basename(f)]))
  const { manifest } = result.paths
  if (manifest) writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), files: result.files }, null, 2))
  return result
}

const exportExtras = async (result, wanted, config) => {
  const { ffmpeg } = await import('#video/ffmpeg.js')
  const video = result.paths.video
  const base = video.slice(0, -4)
  if (wanted.includes('audio')) {
    result.paths.audio = `${base}.mp3`
    await ffmpeg(['-y', '-i', video, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', result.paths.audio], config)
  }
  if (wanted.includes('silent')) {
    result.paths.silent = `${base}-silent.mp4`
    await ffmpeg(['-y', '-i', video, '-map', '0:v', '-c', 'copy', '-movflags', '+faststart', result.paths.silent], config)
  }
  if (!wanted.includes('video')) {
    rmSync(video, { force: true })
    delete result.paths.video
  }
  return recordFiles(result)
}

/** "5" or "3-6" → [5, 5] or [3, 6] (1-based, inclusive); nothing → null */
export const parseSteps = spec => {
  if (spec === undefined || spec === null || spec === '') return null
  if (Array.isArray(spec)) return spec
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(spec).trim())
  if (!m) throw new UserError(`--step ${spec}: use a step number (5) or a range (3-6)`)
  const from = Number(m[1])
  const to = Number(m[2] ?? m[1])
  if (from < 1 || to < from) throw new UserError(`--step ${spec}: steps count from 1, and the range goes up`)
  return [from, to]
}

/**
 * @param {import('#script/load.js').Loaded} loaded  a script from script/load.js
 * @param {Record<string, any>} [opts]  { out, voice, quality, width, height, capture, dryRun, timeout (s), onProgress, sessionNamespace, export,
 *   guide (only the documents), pdf, docx }
 * @returns manifest: { title, duration, files, chapters, captions, paths } (or a dry-run summary)
 */
export const render = async (loaded, opts = {}, config = loadConfig()) => {
  lowerPriority(config)
  await loadPlugins(config)
  // A preview of some steps never overwrites the whole video: it gets its own name
  const steps = parseSteps(opts.steps)
  if (steps && loaded.run) throw new UserError('--step works with YAML and JSON scripts, not JavaScript ones')
  const out = outputBase(opts.out, steps ? `${loaded.name}-step${steps[0]}${steps[1] !== steps[0] ? `-${steps[1]}` : ''}` : loaded.name)
  if (steps) opts = { ...opts, steps }
  const wanted = opts.export ?? loaded.script.export ?? ['video']
  const unknown = wanted.filter(e => !EXPORTS.includes(e))
  if (unknown.length) throw new UserError(`export: ${unknown.join(', ')}? Use ${EXPORTS.join(', ')}`)
  if (!wanted.length) throw new UserError(`export: choose at least one of ${EXPORTS.join(', ')}`)
  let media = wanted.filter(e => MEDIA.includes(e))
  // A PDF or a Word file is made from the guide: asking for one makes it
  let documents = wanted.filter(e => DOCUMENTS.includes(e))
  // `tourwright guide`: the guide, and the PDF or Word file its flags or the script ask for; no video
  if (opts.guide) {
    documents = ['guide', ...documents.filter(d => d !== 'guide'), ...(opts.pdf ? ['pdf'] : []), ...(opts.docx ? ['docx'] : [])]
    media = []
  }
  if (documents.length && loaded.kind !== 'browser') throw new UserError('a guide, a PDF or a Word file is made from a browser walkthrough (slides are already a guide)')
  // The documents run the script like a dry run: fast, no voice, no video
  const asGuide = { guide: opts.guide === 'collect' ? 'collect' : true, dryRun: true, docx: documents.includes('docx') }
  const guideOnly = documents.length > 0 && !media.length
  if (guideOnly) opts = { ...opts, ...asGuide }
  mkdirSync(dirname(out), { recursive: true })
  const base = config.tmpDir ?? tmpdir()
  mkdirSync(base, { recursive: true })
  const workDir = mkdtempSync(join(base, 'tourwright-'))
  let timer
  /** @type {Promise<any> | null} */
  let running = null
  const stop = new AbortController()
  try {
    const timeout = (opts.timeout ?? config.queue.jobTimeout) * 1000
    // The subtitle files are not named after the video: players load a .srt with the video's name by themselves
    // and draw it over the captions already on the video
    const sidecar = join(dirname(out), steps ? `captions-step${steps[0]}${steps[1] !== steps[0] ? `-${steps[1]}` : ''}` : 'captions')
    const options = { ...opts, out, sidecar, workDir, failureDir: opts.failureDir ?? dirname(out), signal: stop.signal }
    // The guide as a PDF, printed once the other browsers are closed (one browser at a time with --lock), inside
    // the time limit like the rest: a page that never finishes printing stops with the job
    const print = async result => {
      if (!documents.includes('pdf') || !result.guide || stop.signal.aborted) return result
      opts.onProgress?.({ stage: 'pdf' })
      result.guide.pdf = await printGuide({ html: result.guide.html, out: `${out}.guide.pdf`, title: result.title, accent: result.guide.accent,
        paper: /** @type {any} */ (loaded.script).document?.paper, footer: result.guide.footer, header: result.guide.header, signal: stop.signal }, config)
      result.guide.review = result.guide.pdf.review
      return result
    }
    running = (async () => {
      /** @type {any} */
      const first = await (loaded.kind === 'slides' ? renderSlides(loaded, options, config) : renderBrowser(loaded, options, config))
      if (!documents.length || guideOnly || opts.dryRun) return print(first)
      // With a video too: the guide comes from a quick second pass over the same script once the recording's
      // browser has closed. Taking its pictures while filming would show on camera and shift the voice.
      opts.onProgress?.({ stage: 'guide' })
      /** @type {any} */
      const second = await renderBrowser(/** @type {any} */ (loaded), { ...options, ...asGuide }, config)
      return print({ ...first, guide: second.guide })
    })()
    const result = await Promise.race([
      running,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          // The render stops (its browser closes) instead of going on unseen while its folder is deleted
          stop.abort()
          reject(new Error(`render took more than ${timeout / 1000} s`))
        }, timeout)
      }),
    ])
    // Only documents: what they are called, for the API's links
    if (result.guide && !result.paths) {
      const g = result.guide
      result.files = Object.fromEntries(Object.entries({ guide: g.html, guideMarkdown: g.markdown, pdf: g.pdf?.path, docx: g.docx }).filter(([, f]) => f).map(([k, f]) => [k, basename(f)]))
      return result
    }
    // A dry run or what `narrate` collects has no video to export from
    if (opts.dryRun || result.dryRun || !result.paths) return result
    const done = media.length === 1 && media[0] === 'video' ? result : await exportExtras(result, media, config)
    if (!result.guide) return done
    const g = result.guide
    Object.assign(done.paths, { guide: g.html, guideMarkdown: g.markdown, pdf: g.pdf?.path, docx: g.docx })
    return recordFiles(done)
  } finally {
    clearTimeout(timer)
    // Stopped at the time limit: what it was writing in the work folder ends first (or 30 s pass)
    if (stop.signal.aborted && running) await Promise.race([running.catch(() => {}), sleep(30_000)])
    rmSync(workDir, { recursive: true, force: true })
  }
}
