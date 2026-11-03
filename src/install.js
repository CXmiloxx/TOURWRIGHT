// `tourwright install`: what Tourwright needs to render, without root and without Docker, on Linux, macOS and
// Windows. Everything goes into TOURWRIGHT_HOME (bin/, piper/, python/, venv/, voices/) and nothing is
// installed on the system: deleting that folder removes it all. What the system already has (an ffmpeg in
// PATH, a piper, an edge-tts) is used as it is.
//
//   ffmpeg    static build: Linux (x64, arm64) and Windows (x64, arm64). macOS: Homebrew.
//   Piper     the piper-tts Python package (OHF-Voice/piper1-gpl, PIPER_TTS), kept loaded during a render.
//             Where it has no build (32-bit ARM, Windows on ARM) or Python cannot be set up: the last
//             standalone release of rhasspy/piper (archived; the same voices).
//   edge-tts  Python package.
//   Python    Python packages live in a virtual environment (TOURWRIGHT_HOME/venv) made by uv. It uses the
//             system's Python when it is 3.10–3.13 (never changing it) and downloads 3.12 into
//             TOURWRIGHT_HOME/python only when there is none. Without uv (no build for the platform,
//             offline) the system's Python makes the environment instead.
//   Chromium  a Chrome, Edge or Chromium already on the system; Playwright's build only when there is none.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, platform } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { cleanDownloads, human } from './clean.js'
import { loadConfig, venvBin } from './config.js'
import { findChromium } from './render/chromium.js'
import { findPiperVoice } from './voice/piper-voices.js'
import { findBinary, isInside, isWindows, log, run, UserError, which } from './util.js'

export const DEFAULT_VOICES = ['es_MX-claude-high', 'en_US-lessac-medium']
const PIPER_VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'
// Pinned: a new piper-tts is tried (speed, sound) before it is used
const PIPER_TTS = 'piper-tts==1.8.0'
// Platforms with a piper-tts build
const PIPER_WHEELS = new Set(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'])
const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2'
const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
// A release series, not the development branch: "-latest" brings its bug fixes, never a new major version
const FFMPEG_SERIES = '9.0'
const btbn = target => `${BTBN}/ffmpeg-n${FFMPEG_SERIES}-latest-${target}-gpl-${FFMPEG_SERIES}.${target.startsWith('win') ? 'zip' : 'tar.xz'}`
// A fixed uv release: every install gets the same one
const UV_RELEASE = 'https://github.com/astral-sh/uv/releases/download/0.13.6'
// Any of these the system has is used; without one, uv downloads PYTHON_VERSION (every package has wheels for it)
const PYTHONS = '>=3.10,<3.14'
const PYTHON_VERSION = '3.12'

// Keyed by `${process.platform}-${process.arch}`
const FFMPEG = {
  // Static builds: they run on any distribution (no 32-bit ARM build: apt install ffmpeg on a Raspberry Pi)
  'linux-x64': btbn('linux64'),
  'linux-arm64': btbn('linuxarm64'),
  'win32-x64': btbn('win64'),
  'win32-arm64': btbn('winarm64'),
}
const PIPER = {
  'linux-x64': 'piper_linux_x86_64.tar.gz',
  'linux-arm64': 'piper_linux_aarch64.tar.gz',
  'linux-arm': 'piper_linux_armv7l.tar.gz',
  'win32-x64': 'piper_windows_amd64.zip',
  // Windows on ARM runs the x64 build under emulation
  'win32-arm64': 'piper_windows_amd64.zip',
}

const UV = {
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'linux-arm': 'uv-armv7-unknown-linux-gnueabihf.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
}

// SHA-256 of every archive from a fixed release: a file that changed upstream (a replaced or tampered asset)
// is refused instead of run. uv: its release's sha256.sum. Piper publishes none: hashed from the release
// assets when PIPER_RELEASE was pinned. A new release pinned above needs its hashes here too.
export const SHA256 = {
  [`${PIPER_RELEASE}/piper_linux_x86_64.tar.gz`]: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992',
  [`${PIPER_RELEASE}/piper_linux_aarch64.tar.gz`]: 'fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb',
  [`${PIPER_RELEASE}/piper_linux_armv7l.tar.gz`]: 'c6946fcd57c705ed1d4666ea880f80ba0bbbd14de62ecbdd13460baf3bac8e37',
  [`${PIPER_RELEASE}/piper_windows_amd64.zip`]: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  [`${UV_RELEASE}/uv-x86_64-unknown-linux-gnu.tar.gz`]: 'f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645',
  [`${UV_RELEASE}/uv-aarch64-unknown-linux-gnu.tar.gz`]: '229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d',
  [`${UV_RELEASE}/uv-armv7-unknown-linux-gnueabihf.tar.gz`]: 'd00cd4949c4524c934afcfee1aedfa9d337cf4e43be4d6b692ad8d74d0a65562',
  [`${UV_RELEASE}/uv-x86_64-apple-darwin.tar.gz`]: '63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02',
  [`${UV_RELEASE}/uv-aarch64-apple-darwin.tar.gz`]: '60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472',
  [`${UV_RELEASE}/uv-x86_64-pc-windows-msvc.zip`]: 'a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f',
  [`${UV_RELEASE}/uv-aarch64-pc-windows-msvc.zip`]: 'c2426c0c8e28b53d8c440e47a18d96ad4db51e159866c0e81435b196d7f0081c',
}

const exe = name => (isWindows ? `${name}.exe` : name)

// A cut download leaves a file that looks fine but is not ("Protobuf parsing failed" for a voice): check
// the size against content-length, retry, and only then put the file in place. `sha256`: the file must have
// that hash (a mismatch is not retried: the same server would send the same file).
export const download = async (url, target, attempts = 3, sha256 = SHA256[url]) => {
  const partial = `${target}.part`
  mkdirSync(dirname(target), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status === 404) throw new UserError(`not found (404): ${url}`)
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      // A site that moved or blocks the download answers with a web page and 200: not the file
      if (/^text\/html/i.test(response.headers.get('content-type') ?? '')) throw new UserError(`${url} answered with a web page instead of the file`)
      const expected = Number(response.headers.get('content-length'))
      const hash = createHash('sha256')
      const body = Readable.fromWeb(/** @type {any} */ (response.body))
      body.on('data', chunk => hash.update(chunk))
      await pipeline(body, createWriteStream(partial))
      const got = statSync(partial).size
      if (expected && got !== expected) throw new Error(`incomplete download: ${got} of ${expected} bytes`)
      const digest = hash.digest('hex')
      if (sha256 && digest !== sha256) throw new UserError(`checksum mismatch (sha256 ${digest}, expected ${sha256}): the file was not installed`)
      renameSync(partial, target)
      return
    } catch (error) {
      rmSync(partial, { force: true })
      if (error instanceof UserError || attempt >= attempts) throw new UserError(`could not download ${url}: ${error.message}`)
      log.warn(`${url}: ${error.message} — retrying`)
    }
  }
}

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

// A scratch folder inside TOURWRIGHT_HOME: same disk as the destination, so moving out of it is a rename.
const inScratch = async (home, fn) => {
  mkdirSync(home, { recursive: true })
  const dir = mkdtempSync(join(home, 'download-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// `tar` opens .tar.gz and .tar.xz everywhere, and .zip with Windows' own tar (bsdtar, Windows 10+). The
// GNU tar that Git for Windows puts in PATH cannot open a .zip, so Windows uses its own by full path.
const tar = () => {
  const own = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return isWindows && existsSync(own) ? own : 'tar'
}

const fetchAndExtract = async (url, dir) => {
  const archive = join(dir, basename(new URL(url).pathname))
  log.info(`downloading ${url}`)
  await download(url, archive)
  await run(tar(), ['-xf', archive, '-C', dir], { maxBuffer: 16 * 1024 * 1024 })
}

const findFile = (dir, name) => {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) return join(entry.parentPath ?? entry.path, entry.name)
  }
  return null
}

// Runs a program with its output on the terminal (downloads show their progress)
const runVisible = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve(undefined) : reject(new Error(`${basename(command)} exited with ${code}`))))
  })


// uv and everything it makes stay in TOURWRIGHT_HOME: its Pythons, its cache, no user or system config
const uvEnv = (home, preference = 'only-managed') => ({
  ...process.env,
  UV_PYTHON_INSTALL_DIR: join(home, 'python'),
  UV_PYTHON_BIN_DIR: join(home, 'python', 'bin'),
  UV_PYTHON_PREFERENCE: preference,
  UV_CACHE_DIR: join(home, 'cache', 'uv'),
  UV_NO_CONFIG: '1',
  VIRTUAL_ENV: '',
})

// Tourwright's own uv in TOURWRIGHT_HOME/bin, downloaded once. Null where there is no build.
const ensureUv = async home => {
  const target = join(home, 'bin', exe('uv'))
  if (existsSync(target)) return target
  const asset = UV[`${platform()}-${arch()}`]
  if (!asset) return null
  mkdirSync(join(home, 'bin'), { recursive: true })
  await inScratch(home, async dir => {
    await fetchAndExtract(`${UV_RELEASE}/${asset}`, dir)
    const found = findFile(dir, exe('uv'))
    if (!found) throw new Error(`${exe('uv')} is not in ${asset}`)
    copyFileSync(found, target)
    chmodSync(target, 0o755)
  })
  return target
}

// A virtual environment holds absolute paths: after TOURWRIGHT_HOME moves, its Python no longer starts
const venvWorks = home =>
  run(findBinary(venvBin(home, 'python')) ?? venvBin(home, 'python'), ['-c', 'pass']).then(() => true, () => false)

// A program found in TOURWRIGHT_HOME/venv counts only while that environment still works
const usable = async (bin, home) => Boolean(bin) && (!isInside(bin, join(home, 'venv')) || (await venvWorks(home)))

// Installs a Python package in TOURWRIGHT_HOME/venv. Returns why it could not, or null when it did.
// `extra`: more pip arguments (another package index).
const pipInstall = async (home, pkg, extra = []) => {
  const venv = join(home, 'venv')
  if (existsSync(venv) && !(await venvWorks(home))) {
    log.info('the Python environment no longer works (was the folder moved?): making it again')
    rmSync(venv, { recursive: true, force: true })
  }
  const uv = await ensureUv(home).catch(error => {
    log.warn(`uv: ${error.message}; trying the system's Python`)
    return null
  })
  if (uv) {
    if (!existsSync(join(venv, 'pyvenv.cfg'))) {
      // The system's Python when it has a usable one (it is not changed); else one downloaded into TOURWRIGHT_HOME/python
      try {
        await run(uv, ['venv', '--quiet', '--python', PYTHONS, venv], { env: uvEnv(home, 'only-system'), maxBuffer: 16 * 1024 * 1024 })
        log.info(`Python environment in ${venv}, with the system's Python`)
      } catch {
        rmSync(venv, { recursive: true, force: true })
        log.info(`Python environment in ${venv}, with its own Python ${PYTHON_VERSION} (the system has no Python 3.10–3.13)`)
        await run(uv, ['venv', '--quiet', '--python', PYTHON_VERSION, venv], { env: uvEnv(home), maxBuffer: 16 * 1024 * 1024 })
      }
    }
    log.info(`installing ${pkg}`)
    // 'system': the environment may be built on the system's Python, which only-managed would refuse
    await run(uv, ['pip', 'install', '--quiet', '--python', venv, ...extra, pkg], { env: uvEnv(home, 'system'), maxBuffer: 16 * 1024 * 1024, timeout: 1_800_000 })
    return null
  }
  if (!findBinary(venvBin(home, 'pip'))) {
    const py = await usablePython()
    if (!py) return 'there is no Python 3.10 or newer and no uv for this system'
    try {
      await run(py, ['-m', 'venv', venv])
    } catch {
      rmSync(venv, { recursive: true, force: true })
      return platform() === 'linux' ? 'Python cannot create environments (apt install python3-venv)' : 'Python cannot create environments'
    }
  }
  log.info(`pip install ${pkg}`)
  await run(findBinary(venvBin(home, 'pip')), ['install', '--quiet', '--disable-pip-version-check', '--no-cache-dir', ...extra, pkg], { maxBuffer: 16 * 1024 * 1024, timeout: 1_800_000 })
  return null
}

const installFfmpeg = async (config, key) => {
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

const installPiper = async (config, key) => {
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

const installEdge = async config => {
  if (await usable(config.tts.edge.bin, config.home)) return log.info(`edge-tts: already there (${config.tts.edge.bin})`)
  const why = await pipInstall(config.home, 'edge-tts')
  if (!why) return log.info('edge-tts: installed')
  log.warn(`edge-tts: skipped, ${why} (only the Microsoft voices need it; Piper voices work without it)`)
}

// Pocket TTS: the natural voices (Spanish `pocket:lola`). PyTorch comes with it; on Linux the CPU-only build,
// not the 2 GB one for NVIDIA cards. The Spanish model is downloaded now, not during the first render.
const installPocket = async config => {
  const why = await pipInstall(config.home, 'pocket-tts', platform() === 'linux' ? ['--extra-index-url', 'https://download.pytorch.org/whl/cpu'] : [])
  if (why) return log.warn(`Pocket TTS: not installed, ${why}`)
  const python = findBinary(venvBin(config.home, 'python'))
  log.info('Pocket TTS: downloading the Spanish model (a few hundred MB, once)')
  await run(python, ['-c', "from pocket_tts import TTSModel; TTSModel.load_model(language='spanish_24l')"], { timeout: 1_800_000, maxBuffer: 16 * 1024 * 1024 })
  log.info('Pocket TTS: installed. It is now the default voice (pocket:lola); TOURWRIGHT_VOICE changes it')
}

const installChromium = async config => {
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

// A Python the virtual environment can be built on, without downloading one (the same range uv is asked for).
// On Windows `python` may be the stub that opens the Microsoft Store: it is run, not just found.
const usablePython = async () => {
  for (const py of [...new Set((isWindows ? ['py', 'python3', 'python'] : ['python3', 'python']).map(which).filter(Boolean))]) {
    const ok = await run(py, ['-c', 'import sys, venv; assert (3, 10) <= sys.version_info[:2] < (3, 14)'], { timeout: 30_000 }).then(() => true, () => false)
    if (ok) return py
  }
  return null
}

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
  // The packages are installed: what was downloaded to install them is not needed any more
  const freed = cleanDownloads(config)
  if (freed) log.info(`removed ${human(freed)} of downloads (tourwright clean shows what Tourwright takes)`)
}
