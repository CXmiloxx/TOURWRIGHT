// `tourwright install`: what Tourwright needs to render, without root and without Docker, on Linux, macOS and
// Windows. Everything goes into TOURWRIGHT_HOME (bin/, piper/, python/, venv/, voices/) and nothing is
// installed on the system: deleting that folder removes it all. What the system already has (an ffmpeg in
// PATH, a piper, an edge-tts) is used as it is.
//
//   ffmpeg    static build: Linux (x64, arm64) and Windows (x64, arm64). macOS: Homebrew.
//   Piper     release binary: Linux (x64, arm64, armv7) and Windows. macOS: the piper-tts Python package,
//             which takes the same command line (the macOS release binaries are broken).
//   edge-tts  Python package.
//   Python    Python packages live in a virtual environment (TOURWRIGHT_HOME/venv) made by uv with a
//             Python of its own (TOURWRIGHT_HOME/python): the system's Python is never used or changed,
//             and none is needed. Without uv (no build for the platform, offline) the system's Python
//             makes the environment instead.
//   Chromium  Playwright's build.
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, platform } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { cleanDownloads, human } from './clean.js'
import { loadConfig, venvBin } from './config.js'
import { findBinary, isInside, isWindows, log, run, UserError, which } from './util.js'

export const DEFAULT_VOICES = ['es_MX-claude-high', 'en_US-lessac-medium']
const PIPER_VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'
const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2'
const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
// A fixed uv release: every install gets the same one
const UV_RELEASE = 'https://github.com/astral-sh/uv/releases/download/0.13.6'
const PYTHON_VERSION = '3.12'
const JVS = 'https://johnvansickle.com/ffmpeg/releases'

// Keyed by `${process.platform}-${process.arch}`
const FFMPEG = {
  'linux-x64': `${JVS}/ffmpeg-release-amd64-static.tar.xz`,
  'linux-arm64': `${JVS}/ffmpeg-release-arm64-static.tar.xz`,
  'win32-x64': `${BTBN}/ffmpeg-master-latest-win64-gpl.zip`,
  'win32-arm64': `${BTBN}/ffmpeg-master-latest-winarm64-gpl.zip`,
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

const exe = name => (isWindows ? `${name}.exe` : name)

// A cut download leaves a file that looks fine but is not ("Protobuf parsing failed" for a voice): check
// the size against content-length, retry, and only then put the file in place.
export const download = async (url, target, attempts = 3) => {
  const partial = `${target}.part`
  mkdirSync(dirname(target), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status === 404) throw new UserError(`not found (404): ${url}`)
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const expected = Number(response.headers.get('content-length'))
      await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(partial))
      const got = statSync(partial).size
      if (expected && got !== expected) throw new Error(`incomplete download: ${got} of ${expected} bytes`)
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

const systemPython = () => (isWindows ? ['py', 'python'] : ['python3', 'python']).map(which).find(Boolean)

// uv and everything it makes stay in TOURWRIGHT_HOME: its Pythons, its cache, no user or system config
const uvEnv = home => ({
  ...process.env,
  UV_PYTHON_INSTALL_DIR: join(home, 'python'),
  UV_PYTHON_BIN_DIR: join(home, 'python', 'bin'),
  UV_PYTHON_PREFERENCE: 'only-managed',
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
      log.info(`Python ${PYTHON_VERSION} environment in ${venv} (its own Python, nothing on the system)`)
      await run(uv, ['venv', '--quiet', '--python', PYTHON_VERSION, venv], { env: uvEnv(home), maxBuffer: 16 * 1024 * 1024 })
    }
    log.info(`installing ${pkg}`)
    await run(uv, ['pip', 'install', '--quiet', '--python', venv, ...extra, pkg], { env: uvEnv(home), maxBuffer: 16 * 1024 * 1024, timeout: 1_800_000 })
    return null
  }
  if (!findBinary(venvBin(home, 'pip'))) {
    const py = systemPython()
    if (!py) return 'there is no Python 3 and no uv for this system'
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
  const url = FFMPEG[key]
  if (!url) {
    const how = platform() === 'darwin' ? 'brew install ffmpeg' : 'install it with your package manager'
    return log.warn(`ffmpeg: no static build for ${key}; ${how}, or set TOURWRIGHT_FFMPEG`)
  }
  const bin = join(config.home, 'bin')
  mkdirSync(bin, { recursive: true })
  await inScratch(config.home, async dir => {
    await fetchAndExtract(url, dir)
    for (const name of ['ffmpeg', 'ffprobe']) {
      const found = findFile(dir, exe(name))
      if (!found) throw new Error(`${exe(name)} is not in ${url}`)
      copyFileSync(found, join(bin, exe(name)))
      chmodSync(join(bin, exe(name)), 0o755)
    }
  })
  log.info(`ffmpeg: installed in ${bin}`)
}

const installPiper = async (config, key) => {
  if (await usable(config.tts.piper.bin, config.home)) return log.info(`Piper: already there (${config.tts.piper.bin})`)
  const asset = PIPER[key]
  if (!asset) {
    const why = await pipInstall(config.home, 'piper-tts')
    if (!why) return log.info('Piper: installed (piper-tts)')
    return log.warn(`Piper: not installed, ${why}`)
  }
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

// Whisper (faster-whisper), to listen to the voices: `tourwright voices --check` finds the words they get wrong
const installWhisper = async config => {
  const why = await pipInstall(config.home, 'faster-whisper')
  if (why) return log.warn(`Whisper: not installed, ${why}`)
  log.info('Whisper: downloading the "small" model (about 500 MB, once)')
  await run(findBinary(venvBin(config.home, 'python')), ['-c', "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"], { timeout: 1_800_000, maxBuffer: 16 * 1024 * 1024 })
  log.info('Whisper: installed (tourwright voices --check)')
}

const installChromium = async config => {
  const cli = join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js')
  // As root on Linux, the system libraries Chromium needs come along
  const withDeps = platform() === 'linux' && process.getuid?.() === 0
  const env = config.browsersPath ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: config.browsersPath } : process.env
  await runVisible(process.execPath, [cli, 'install', ...(withDeps ? ['--with-deps'] : []), 'chromium'], env)
  if (platform() === 'linux' && !withDeps) log.info('If Chromium misses system libraries: sudo npx playwright install-deps chromium')
}

/**
 * @param {{ voices?: string[], edge?: boolean, chromium?: boolean, pocket?: boolean, whisper?: boolean }} [options]
 */
export const installAll = async ({ voices = DEFAULT_VOICES, edge = true, chromium = true, pocket = false, whisper = false } = {}, config = loadConfig()) => {
  const key = `${platform()}-${arch()}`
  log.info(`installing into ${config.home} (${key})`)
  await installFfmpeg(config, key)
  await installPiper(config, key)
  for (const v of voices) log.info(`voice: ${await installVoice(v, config)}`)
  if (edge) await installEdge(config)
  if (pocket) await installPocket(config)
  if (whisper) await installWhisper(config)
  if (chromium) await installChromium(config)
  if (platform() === 'linux' && !config.xvfb) log.info('Optional, for the sharpest capture: install Xvfb (apt install xvfb)')
  // The packages are installed: what was downloaded to install them is not needed any more
  const freed = cleanDownloads(config)
  if (freed) log.info(`removed ${human(freed)} of downloads (tourwright clean shows what Tourwright takes)`)
}
