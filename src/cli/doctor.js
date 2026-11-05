// `tourwright doctor`: what this machine has to render, each with what to do when it is missing.
import { existsSync } from 'node:fs'
import { loadConfig } from '#core/config.js'
import { findChromium } from '#render/browser/chromium.js'
import { listVoices } from '#voice/index.js'

export const doctor = async (config = loadConfig()) => {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
  add('ffmpeg', config.ffmpeg, config.ffmpeg ?? 'missing: tourwright install, or TOURWRIGHT_FFMPEG')
  add('ffprobe', config.ffprobe, config.ffprobe ?? 'missing: comes with ffmpeg, or TOURWRIGHT_FFPROBE')
  add('Xvfb (best capture)', config.xvfb, config.xvfb ?? (process.platform === 'linux' ? 'optional: apt install xvfb — without it, screencast capture is used' : 'Linux only — screencast capture is used'))
  try {
    const found = await findChromium(config)
    const { chromium } = await import('playwright')
    const path = found.path ?? chromium.executablePath()
    const ok = found.source !== 'missing' && existsSync(path)
    add('Chromium', ok, ok ? `${path}${found.source === 'system' ? ' (from the system)' : ''}` : 'missing: tourwright install, a Chrome or Edge on the system, or TOURWRIGHT_CHROMIUM')
  } catch (error) {
    add('Chromium', false, error.message)
  }
  const voices = await listVoices(config)
  for (const [engine, state] of Object.entries(voices.engines)) add(`TTS ${engine}`, state.ok, state.ok ? JSON.stringify(state) : state.reason)
  const usable = voices.voices.filter(v => v.available)
  add('voices', usable.length, usable.length ? `${usable.length} usable · default ${voices.default}` : 'none: tourwright install-voice es_MX-claude-high')
  add('data dir', true, config.dataDir)
  return checks
}
