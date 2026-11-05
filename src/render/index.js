// One entry point for every kind of video: picks the renderer, owns the work folder, the CPU priority
// and the time limit.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setPriority, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig } from '#core/config.js'
import { loadPlugins } from '#plugins/index.js'
import { UserError } from '#core/util.js'
import { renderBrowser } from './walkthrough/index.js'
import { renderSlides } from './slides.js'

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

// What a render delivers besides the subtitles, the poster and the manifest, which always come:
//   video   the narrated video (.mp4)
//   audio   only the sound: narration, music and effects (.mp3)
//   silent  the video without sound (-silent.mp4), to put another voice or music over it
export const EXPORTS = ['video', 'audio', 'silent']

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
  result.files = Object.fromEntries(Object.entries(result.paths).map(([k, f]) => [k, basename(f)]))
  const { manifest, ...rest } = result.paths
  if (manifest) writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), files: result.files }, null, 2))
  return { ...result, paths: { ...rest, manifest } }
}

/**
 * @param {import('#script/load.js').Loaded} loaded  a script from script/load.js
 * @param {Record<string, any>} [opts]  { out, voice, quality, width, height, capture, dryRun, timeout (s), onProgress, sessionNamespace }
 * @returns manifest: { title, duration, files, chapters, captions, paths } (or a dry-run summary)
 */
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

export const render = async (loaded, opts = {}, config = loadConfig()) => {
  lowerPriority(config)
  await loadPlugins(config)
  // A preview of some steps never overwrites the whole video: it gets its own name
  const steps = parseSteps(opts.steps)
  if (steps && loaded.run) throw new UserError('--step works with YAML and JSON scripts, not JavaScript ones')
  const out = outputBase(opts.out, steps ? `${loaded.name}-step${steps[0]}${steps[1] !== steps[0] ? `-${steps[1]}` : ''}` : loaded.name)
  if (steps) opts = { ...opts, steps }
  // A guide runs the script like a dry run: fast, no voice, no video
  if (opts.guide) {
    if (loaded.kind !== 'browser') throw new UserError('a guide is made from a browser walkthrough (slides are already a guide)')
    opts = { ...opts, dryRun: true }
  }
  mkdirSync(dirname(out), { recursive: true })
  const base = config.tmpDir ?? tmpdir()
  mkdirSync(base, { recursive: true })
  const workDir = mkdtempSync(join(base, 'tourwright-'))
  let timer
  try {
    const timeout = (opts.timeout ?? config.queue.jobTimeout) * 1000
    const wanted = opts.export ?? loaded.script.export ?? ['video']
    const unknown = wanted.filter(e => !EXPORTS.includes(e))
    if (unknown.length) throw new UserError(`export: ${unknown.join(', ')}? Use ${EXPORTS.join(', ')}`)
    if (!wanted.length) throw new UserError(`export: choose at least one of ${EXPORTS.join(', ')}`)
    const result = await Promise.race([
      (() => {
        // The subtitle files are not named after the video: players load a .srt with the video's name by themselves
        // and draw it over the captions already on the video
        const sidecar = join(dirname(out), steps ? `captions-step${steps[0]}${steps[1] !== steps[0] ? `-${steps[1]}` : ''}` : 'captions')
        const options = { ...opts, out, sidecar, workDir, failureDir: opts.failureDir ?? dirname(out) }
        return loaded.kind === 'slides' ? renderSlides(loaded, options, config) : renderBrowser(loaded, options, config)
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`render took more than ${timeout / 1000} s`)), timeout)
      }),
    ])
    return result.dryRun || (wanted.length === 1 && wanted[0] === 'video') ? result : await exportExtras(result, wanted, config)
  } finally {
    clearTimeout(timer)
    rmSync(workDir, { recursive: true, force: true })
  }
}
