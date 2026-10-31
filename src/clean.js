// `tourwright clean`: what Tourwright takes on disk, part by part, and removing what is not needed.
//
// Safe to remove at any time: the download cache (packages already installed) and leftover temporary
// files. On request: the voice cache (sentences already synthesized: the next render makes them again),
// Pocket TTS and Whisper with their models. Chromium lives in Playwright's shared folder, which other
// projects may use: it is only reported (Playwright removes old versions itself when it installs new ones).
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { venvBin } from './config.js'
import { findBinary, log, run } from './util.js'

/** Bytes in a file or folder; links are not followed. @param {string} path */
export const sizeOf = path => {
  if (!existsSync(path)) return 0
  const stat = lstatSync(path)
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const entry of readdirSync(path)) total += sizeOf(join(path, entry))
  return total
}

export const human = bytes =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`

const browsersDir = config =>
  config.browsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH ??
  (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'))

// The models Tourwright downloaded, from the shared Hugging Face cache: only these are ever touched
const MODELS = { pocket: /^kyutai\/pocket-tts/, whisper: /^Systran\/faster-whisper-/ }

const python = config => findBinary(venvBin(config.home, 'python'))

// Asks huggingface_hub itself: its cache shares files between models, so sizes and deletions go through it
const hubModels = async config => {
  const py = python(config)
  if (!py) return []
  const code = 'import json\nfrom huggingface_hub import scan_cache_dir\n' +
    'print(json.dumps([{"repo": r.repo_id, "bytes": r.size_on_disk, "revisions": [v.commit_hash for v in r.revisions]} for r in scan_cache_dir().repos]))'
  try {
    const { stdout } = await run(py, ['-c', code], { maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout).filter(m => Object.values(MODELS).some(re => re.test(m.repo)))
  } catch {
    return []
  }
}

/**
 * What each part takes. `remove`: the flag of `tourwright clean` that removes it (none: needed, or not ours).
 * @returns {Promise<{ name: string, path?: string, bytes: number, remove?: string, note?: string }[]>}
 */
export const diskUsage = async config => {
  const home = config.home
  const models = await hubModels(config)
  const modelBytes = kind => models.filter(m => MODELS[kind].test(m.repo)).reduce((a, m) => a + m.bytes, 0)
  const parts = [
    { name: 'programs (ffmpeg, uv, Piper, Python)', bytes: ['bin', 'piper', 'python'].reduce((a, d) => a + sizeOf(join(home, d)), 0), note: 'needed' },
    { name: 'Python packages (edge-tts, Pocket TTS, Whisper)', path: join(home, 'venv'), bytes: sizeOf(join(home, 'venv')), note: 'needed' },
    { name: 'Piper voices', path: config.tts.piper.voicesDir, bytes: sizeOf(config.tts.piper.voicesDir), note: 'needed' },
    { name: 'Pocket TTS models', bytes: modelBytes('pocket'), remove: '--pocket', note: 'the natural voices (lola, alba…)' },
    { name: 'Whisper models', bytes: modelBytes('whisper'), remove: '--whisper', note: 'only for voices --check' },
    { name: 'download cache', path: join(home, 'cache', 'uv'), bytes: sizeOf(join(home, 'cache', 'uv')), remove: 'always', note: 'packages already installed' },
    { name: 'voice cache', path: join(config.cacheDir, 'voice'), bytes: sizeOf(join(config.cacheDir, 'voice')), remove: '--voice-cache', note: 'sentences already said: renders reuse them' },
    { name: 'rendered jobs (API)', path: join(config.dataDir, 'jobs'), bytes: sizeOf(join(config.dataDir, 'jobs')), note: `kept ${config.queue.retentionHours} h` },
    { name: 'saved sessions', path: join(config.dataDir, 'sessions'), bytes: sizeOf(join(config.dataDir, 'sessions')), note: 'tourwright forget' },
    { name: 'Chromium (shared with other Playwright projects)', path: browsersDir(config), bytes: sizeOf(browsersDir(config)), note: 'not touched' },
  ]
  return parts.filter(p => p.bytes > 0)
}

// Uninstalls Python packages from Tourwright's environment
const pipUninstall = async (config, packages) => {
  const uv = findBinary(join(config.home, 'bin', 'uv'))
  const venv = join(config.home, 'venv')
  if (uv) await run(uv, ['pip', 'uninstall', '--quiet', '--python', venv, ...packages], { env: { ...process.env, UV_NO_CONFIG: '1' } }).catch(() => {})
  else if (findBinary(venvBin(config.home, 'pip'))) await run(findBinary(venvBin(config.home, 'pip')), ['uninstall', '-y', ...packages]).catch(() => {})
}

const deleteModels = async (config, kind) => {
  const models = (await hubModels(config)).filter(m => MODELS[kind].test(m.repo))
  if (!models.length) return 0
  const hashes = models.flatMap(m => m.revisions)
  const code = `from huggingface_hub import scan_cache_dir\nscan_cache_dir().delete_revisions(*${JSON.stringify(hashes)}).execute()`
  await run(python(config), ['-c', code])
  return models.reduce((a, m) => a + m.bytes, 0)
}

// The download cache: removed after every install too
export const cleanDownloads = config => {
  const dir = join(config.home, 'cache', 'uv')
  const bytes = sizeOf(dir)
  rmSync(dir, { recursive: true, force: true })
  return bytes
}

/**
 * @param {any} config
 * @param {{ voiceCache?: boolean, pocket?: boolean, whisper?: boolean }} [what]
 * @returns {Promise<{ name: string, bytes: number }[]>} what was removed
 */
export const clean = async (config, { voiceCache = false, pocket = false, whisper = false } = {}) => {
  const removed = [{ name: 'download cache', bytes: cleanDownloads(config) }]
  // Half-written files left by a render that was killed
  const voiceDir = join(config.cacheDir, 'voice')
  if (existsSync(voiceDir)) {
    let leftovers = 0
    for (const dir of [voiceDir, join(voiceDir, 'sentences')].filter(existsSync)) {
      for (const f of readdirSync(dir).filter(f => /\.(tmp\.wav|raw|txt)$/.test(f))) {
        leftovers += sizeOf(join(dir, f))
        rmSync(join(dir, f), { force: true })
      }
    }
    removed.push({ name: 'temporary files', bytes: leftovers })
  }
  if (voiceCache) {
    removed.push({ name: 'voice cache', bytes: sizeOf(voiceDir) })
    rmSync(voiceDir, { recursive: true, force: true })
  }
  if (whisper) {
    removed.push({ name: 'Whisper models', bytes: await deleteModels(config, 'whisper') })
    await pipUninstall(config, ['faster-whisper', 'ctranslate2'])
    log.info('Whisper uninstalled (tourwright install --whisper brings it back)')
  }
  if (pocket) {
    removed.push({ name: 'Pocket TTS models', bytes: await deleteModels(config, 'pocket') })
    await pipUninstall(config, ['pocket-tts', 'torch'])
    log.info('Pocket TTS uninstalled: the default voice is Piper again (tourwright install --pocket brings it back)')
  }
  return removed.filter(r => r.bytes > 0)
}
