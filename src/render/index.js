// One entry point for every kind of video: picks the renderer, owns the work folder, the CPU priority
// and the time limit.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setPriority, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { loadConfig } from '../config.js'
import { loadPlugins } from '../plugins.js'
import { UserError } from '../util.js'
import { renderBrowser } from './browser.js'
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
  const { ffmpeg } = await import('../compose.js')
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
 * @param {import('../script/load.js').Loaded} loaded  a script from script/load.js
 * @param {Record<string, any>} [opts]  { out, voice, quality, width, height, capture, dryRun, timeout (s), onProgress, sessionNamespace }
 * @returns manifest: { title, duration, files, chapters, captions, paths } (or a dry-run summary)
 */
export const render = async (loaded, opts = {}, config = loadConfig()) => {
  lowerPriority(config)
  await loadPlugins(config)
  const out = outputBase(opts.out, loaded.name)
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
        const options = { ...opts, out, workDir, failureDir: opts.failureDir ?? dirname(out) }
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
