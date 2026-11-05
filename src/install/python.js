// Python packages (piper-tts, edge-tts, Pocket TTS) in a virtual environment made by uv, on the system's Python
// when it fits or a downloaded one, never changing the system.
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { venvBin } from '#core/config.js'
import { findBinary, isInside, isWindows, log, run, which } from '#core/util.js'
import { fetchAndExtract, findFile, inScratch } from './download.js'
import { PYTHONS, PYTHON_VERSION, UV, UV_RELEASE, exe } from './sources.js'

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
export const venvWorks = home =>
  run(findBinary(venvBin(home, 'python')) ?? venvBin(home, 'python'), ['-c', 'pass']).then(() => true, () => false)

// A program found in TOURWRIGHT_HOME/venv counts only while that environment still works
export const usable = async (bin, home) => Boolean(bin) && (!isInside(bin, join(home, 'venv')) || (await venvWorks(home)))

// Installs a Python package in TOURWRIGHT_HOME/venv. Returns why it could not, or null when it did.
// `extra`: more pip arguments (another package index).
export const pipInstall = async (home, pkg, extra = []) => {
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
// A Python the virtual environment can be built on, without downloading one (the same range uv is asked for).
// On Windows `python` may be the stub that opens the Microsoft Store: it is run, not just found.
export const usablePython = async () => {
  for (const py of [...new Set((isWindows ? ['py', 'python3', 'python'] : ['python3', 'python']).map(which).filter(Boolean))]) {
    const ok = await run(py, ['-c', 'import sys, venv; assert (3, 10) <= sys.version_info[:2] < (3, 14)'], { timeout: 30_000 }).then(() => true, () => false)
    if (ok) return py
  }
  return null
}
