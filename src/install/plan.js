// What `tourwright install` does: the plan first (what is used from the PC, what is downloaded), then all of it.
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { cleanDownloads, human } from './clean.js'
import { loadConfig } from '#core/config.js'
import { findChromium } from '#render/browser/chromium.js'
import { findPiperVoice } from '#voice/piper-voices.js'
import { isInside, log } from '#core/util.js'
import { download } from './download.js'
import { installChromium, installEdge, installFfmpeg, installPiper, installPocket, installVoice } from './parts.js'
import { usable, usablePython, venvWorks } from './python.js'
import { DEFAULT_VOICES, FFMPEG, FFMPEG_SERIES, PIPER_TTS, PIPER_WHEELS, PYTHON_VERSION } from './sources.js'

/**
 * What `install` would use from the PC and what it would download, without changing anything.
 * @param {{ voices?: string[], edge?: boolean, chromium?: boolean, pocket?: boolean }} [options]
 * @returns {Promise<{ name: string, use?: string, download?: string, mb?: number }[]>}
 */
export const planInstall = async ({ voices = DEFAULT_VOICES, edge = true, chromium = true, pocket = false } = {}, config = loadConfig()) => {
  const key = `${platform()}-${arch()}`
  const plan = []
  const venvReady = existsSync(join(config.home, 'venv', 'pyvenv.cfg')) && (await venvWorks(config.home))
  let needsVenv = false
  if (config.ffmpeg && config.ffprobe) plan.push({ name: 'ffmpeg', use: config.ffmpeg })
  else if (FFMPEG[key]) plan.push({ name: 'ffmpeg', download: `ffmpeg ${FFMPEG_SERIES}`, mb: 90 })
  else plan.push({ name: 'ffmpeg', download: platform() === 'darwin' ? 'none: brew install ffmpeg' : 'none: install it with your package manager' })
  const { python, bin } = config.tts.piper
  if (python && (await usable(python, config.home))) plan.push({ name: 'Piper', use: python })
  else if (bin && !isInside(bin, join(config.home, 'piper'))) plan.push({ name: 'Piper', use: bin })
  else if (PIPER_WHEELS.has(key)) {
    needsVenv = true
    plan.push({ name: 'Piper', download: PIPER_TTS, mb: 120 })
  } else if (bin) plan.push({ name: 'Piper', use: bin })
  else plan.push({ name: 'Piper', download: 'Piper (standalone)', mb: 25 })
  for (const v of voices) {
    const found = findPiperVoice(config, v)
    plan.push(found ? { name: `voice ${v}`, use: found } : { name: `voice ${v}`, download: v, mb: v.endsWith('-high') ? 115 : 65 })
  }
  if (edge) {
    if (await usable(config.tts.edge.bin, config.home)) plan.push({ name: 'edge-tts', use: config.tts.edge.bin })
    else {
      needsVenv = true
      plan.push({ name: 'edge-tts', download: 'edge-tts', mb: 5 })
    }
  }
  if (pocket) {
    needsVenv = true
    plan.push({ name: 'Pocket TTS', download: 'pocket-tts, PyTorch and the Spanish model', mb: 1000 })
  }
  if (needsVenv && !venvReady) {
    const py = await usablePython()
    plan.push(py ? { name: 'Python', use: py } : { name: 'Python', download: `Python ${PYTHON_VERSION} (and uv)`, mb: 60 })
  }
  if (chromium) {
    const found = await findChromium(config)
    if (found.source === 'missing') plan.push({ name: 'Chromium', download: `Playwright's Chromium into ${config.browsersPath}`, mb: 250 })
    else plan.push({ name: 'Chromium', use: found.path ?? config.browsersPath })
  }
  return plan
}

/**
 * @param {{ voices?: string[], edge?: boolean, chromium?: boolean, pocket?: boolean }} [options]
 */
export const installAll = async ({ voices = DEFAULT_VOICES, edge = true, chromium = true, pocket = false } = {}, config = loadConfig()) => {
  const key = `${platform()}-${arch()}`
  log.info(`installing into ${config.home} (${key})`)
  await installFfmpeg(config, key)
  await installPiper(config, key)
  for (const v of voices) log.info(`voice: ${await installVoice(v, config)}`)
  if (edge) await installEdge(config)
  if (pocket) await installPocket(config)
  if (chromium) await installChromium(config)
  if (platform() === 'linux' && !config.xvfb) log.info('Optional, for the sharpest capture: install Xvfb (apt install xvfb)')
  // Without Pocket the natural voices need internet (Microsoft's): say how to have them offline too
  if (!pocket && !config.tts.pocket?.python) {
    log.info('Voices: with internet each video uses a natural neural voice; offline it falls back to Piper, more synthetic.')
    log.info('  For natural voices offline too: tourwright install --pocket (about 1 GB, once)')
  }
  // The packages are installed: what was downloaded to install them is not needed any more
  const freed = cleanDownloads(config)
  if (freed) log.info(`removed ${human(freed)} of downloads (tourwright clean shows what Tourwright takes)`)
}
