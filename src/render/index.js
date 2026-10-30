// One entry point for every kind of video: picks the renderer, owns the work folder, the CPU priority
// and the time limit.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { setPriority, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { loadConfig } from '../config.js'
import { loadPlugins } from '../plugins.js'
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

// `out`: a path ending in .mp4, or a folder (the video is named after the script).
export const outputBase = (out, name) => {
  if (!out) return resolve('videos', name)
  const path = resolve(out)
  return path.endsWith('.mp4') ? path.slice(0, -4) : join(path, name)
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
    return await Promise.race([
      (() => {
        const options = { ...opts, out, workDir, failureDir: opts.failureDir ?? dirname(out) }
        return loaded.kind === 'slides' ? renderSlides(loaded, options, config) : renderBrowser(loaded, options, config)
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`render took more than ${timeout / 1000} s`)), timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
    rmSync(workDir, { recursive: true, force: true })
  }
}
