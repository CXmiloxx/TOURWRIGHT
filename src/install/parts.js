// Each part on its own: ffmpeg, Piper and its voices, edge-tts, Pocket TTS, Chromium. Each one uses what the PC
// already has first.
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'
import { loadConfig, venvBin } from '#core/config.js'
import { findChromium } from '#render/browser/chromium.js'
import { findPiperVoice } from '#voice/piper-voices.js'
import { findBinary, isInside, log, run, UserError } from '#core/util.js'
import { download, fetchAndExtract, findFile, inScratch, runVisible } from './download.js'
import { pipInstall, usable } from './python.js'
import { FFMPEG, PIPER, PIPER_RELEASE, PIPER_TTS, PIPER_VOICES, PIPER_WHEELS, exe } from './sources.js'

export const installVoice = async (voice, config = loadConfig()) => {
  const m = /^([a-z]{2,3})_([A-Z]{2})-([\w]+)-(x_low|low|medium|high)$/.exec(voice)
  if (!m) throw new UserError(`"${voice}" is not a Piper voice name (language_REGION-name-quality, e.g. es_MX-claude-high)`)
  const [, lang, region, speaker, q] = m
  const found = findPiperVoice(config, voice)
  if (found) return found
  mkdirSync(config.tts.piper.voicesDir, { recursive: true })
  for (const ext of ['onnx', 'onnx.json']) {
    const url = `${PIPER_VOICES}/${lang}/${lang}_${region}/${speaker}/${q}/${voice}.${ext}`
    const target = join(config.tts.piper.voicesDir, `${voice}.${ext}`)
    if (existsSync(target)) continue
    log.info(`downloading ${url}`)
    await download(url, target)
  }
  return join(config.tts.piper.voicesDir, `${voice}.onnx`)
}
export const installFfmpeg = async (config, key) => {
  if (config.ffmpeg && config.ffprobe) return log.info(`ffmpeg: already there (${config.ffmpeg})`)
  // Only what is missing is put in place: an ffmpeg the system has stays the one used
  const missing = ['ffmpeg', 'ffprobe'].filter(name => !config[name])
  const url = FFMPEG[key]
  if (!url) {
    const how = platform() === 'darwin' ? 'brew install ffmpeg' : 'install it with your package manager'
    return log.warn(`ffmpeg: no static build for ${key}; ${how}, or set TOURWRIGHT_FFMPEG`)
  }
  const bin = join(config.home, 'bin')
  mkdirSync(bin, { recursive: true })
  await inScratch(config.home, async dir => {
    await fetchAndExtract(url, dir)
    for (const name of missing) {
      const found = findFile(dir, exe(name))
      if (!found) throw new Error(`${exe(name)} is not in ${url}`)
      copyFileSync(found, join(bin, exe(name)))
      chmodSync(join(bin, exe(name)), 0o755)
    }
  })
  log.info(`${missing.join(' and ')}: installed in ${bin}`)
}

export const installPiper = async (config, key) => {
  const { python, bin } = config.tts.piper
  if (python && (await usable(python, config.home))) return log.info(`Piper: already there (piper-tts, ${python})`)
  const ownBinary = Boolean(bin) && isInside(bin, join(config.home, 'piper'))
  // A piper the system has is used as it is
  if (bin && !ownBinary && (await usable(bin, config.home))) return log.info(`Piper: already there (${bin})`)
  if (PIPER_WHEELS.has(key)) {
    const why = await pipInstall(config.home, PIPER_TTS)
    if (!why) {
      // The standalone build Tourwright put here before is replaced by the faster one
      if (ownBinary) rmSync(join(config.home, 'piper'), { recursive: true, force: true })
      return log.info(`Piper: installed (${PIPER_TTS}, kept loaded during a render)`)
    }
    if (ownBinary) return log.warn(`Piper: keeping ${bin}; ${PIPER_TTS} not installed, ${why}`)
    log.warn(`${PIPER_TTS}: not installed, ${why}; using Piper's standalone build`)
  }
  if (ownBinary) return log.info(`Piper: already there (${bin})`)
  const asset = PIPER[key]
  if (!asset) return log.warn(`Piper: no build for ${key}; set TOURWRIGHT_PIPER_BIN to a piper you have`)
  await inScratch(config.home, async dir => {
    await fetchAndExtract(`${PIPER_RELEASE}/${asset}`, dir)
    const found = findFile(dir, exe('piper'))
    if (!found) throw new Error(`${exe('piper')} is not in ${asset}`)
    // The binary needs the libraries and espeak-ng-data next to it: the whole folder moves
    rmSync(join(config.home, 'piper'), { recursive: true, force: true })
    renameSync(dirname(found), join(config.home, 'piper'))
  })
  log.info(`Piper: installed in ${join(config.home, 'piper')}`)
}

export const installEdge = async config => {
  if (await usable(config.tts.edge.bin, config.home)) return log.info(`edge-tts: already there (${config.tts.edge.bin})`)
  const why = await pipInstall(config.home, 'edge-tts')
  if (!why) return log.info('edge-tts: installed')
  log.warn(`edge-tts: skipped, ${why} (only the Microsoft voices need it; Piper voices work without it)`)
}

// Pocket TTS: the natural voices (Spanish `pocket:lola`). PyTorch comes with it; on Linux the CPU-only build,
// not the 2 GB one for NVIDIA cards. The Spanish model is downloaded now, not during the first render.
export const installPocket = async config => {
  const why = await pipInstall(config.home, 'pocket-tts', platform() === 'linux' ? ['--extra-index-url', 'https://download.pytorch.org/whl/cpu'] : [])
  if (why) return log.warn(`Pocket TTS: not installed, ${why}`)
  const python = findBinary(venvBin(config.home, 'python'))
  log.info('Pocket TTS: downloading the Spanish model (a few hundred MB, once)')
  await run(python, ['-c', "from pocket_tts import TTSModel; TTSModel.load_model(language='spanish_24l')"], { timeout: 1_800_000, maxBuffer: 16 * 1024 * 1024 })
  log.info('Pocket TTS: installed. It is now the default voice (pocket:lola); TOURWRIGHT_VOICE changes it')
}

export const installChromium = async config => {
  const found = await findChromium(config)
  if (found.source === 'configured' || found.source === 'system') return log.info(`Chromium: using ${found.path}, nothing to download`)
  if (found.source === 'playwright') return log.info(`Chromium: already there (${config.browsersPath})`)
  log.info(`Chromium: none on this PC, downloading Playwright's into ${config.browsersPath}`)
  const cli = join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js')
  // As root on Linux, the system libraries Chromium needs come along
  const withDeps = platform() === 'linux' && process.getuid?.() === 0
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: config.browsersPath }
  await runVisible(process.execPath, [cli, 'install', ...(withDeps ? ['--with-deps'] : []), 'chromium'], env)
  if (platform() === 'linux' && !withDeps) log.info('If Chromium misses system libraries: sudo npx playwright install-deps chromium')
}
