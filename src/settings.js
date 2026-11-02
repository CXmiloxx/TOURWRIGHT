// `tourwright config`: each person's own defaults, without editing JSON by hand. They are written to the
// user's file (TOURWRIGHT_HOME/config.json) and apply to every project on this machine; a project's
// tourwright.config.json, the environment, the script and the command line still win, in that order upward.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CAPTURE_NAMES, loadConfig, projectConfigFile, QUALITY_NAMES, readJson, reloadConfig, userConfigFile } from './config.js'
import { UserError } from './util.js'
import { parseVoice } from './voice/index.js'

const number = (min, max) => value => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`must be a number from ${min} to ${max}`)
  return n
}
const oneOf = allowed => value => {
  if (!allowed.includes(value)) throw new UserError(`must be one of ${allowed.join(', ')}`)
  return value
}
const yesNo = value => {
  if (!['true', 'false', 'yes', 'no', '1', '0', 'on', 'off'].includes(String(value).toLowerCase())) throw new UserError('must be true or false')
  return ['true', 'yes', '1', 'on'].includes(String(value).toLowerCase())
}
const text = value => String(value)
// A voice that exists: an engine:id or a name `tourwright voices` lists
const voice = value => {
  parseVoice(String(value), loadConfig())
  return String(value)
}

/** Every setting `tourwright config set` knows: where it lives in the file, its variable, how it is checked */
export const SETTINGS = {
  quality: { path: ['render', 'quality'], env: 'TOURWRIGHT_QUALITY', parse: oneOf(QUALITY_NAMES), about: 'video size: sd 480p, hd 720p, fullhd 1080p, vertical, square' },
  fps: { path: ['render', 'fps'], env: 'TOURWRIGHT_FPS', parse: number(1, 60), about: 'frames per second' },
  capture: { path: ['render', 'capture'], env: 'TOURWRIGHT_CAPTURE', parse: oneOf(CAPTURE_NAMES), about: 'how the browser is recorded' },
  voice: { path: ['tts', 'defaultVoice'], env: 'TOURWRIGHT_VOICE', parse: voice, about: 'default voice: engine:id or a name (tourwright voices)' },
  pause: { path: ['tts', 'pause'], env: 'TOURWRIGHT_TTS_PAUSE', parse: number(0, 5), about: 'seconds of silence between sentences' },
  polish: { path: ['tts', 'polish'], env: 'TOURWRIGHT_VOICE_POLISH', parse: text, about: 'sound of the voice: default, clean, warm, radio, podcast, none' },
  preset: { path: ['preset'], env: 'TOURWRIGHT_PRESET', parse: oneOf(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']), about: 'encoding speed (faster = bigger file)' },
  threads: { path: ['threads'], env: 'TOURWRIGHT_FFMPEG_THREADS', parse: number(1, 64), about: 'threads per ffmpeg' },
  chromium: { path: ['chromium'], env: 'TOURWRIGHT_CHROMIUM', parse: text, about: 'the browser to record with (a path)' },
  systemBrowser: { path: ['systemBrowser'], env: 'TOURWRIGHT_SYSTEM_BROWSER', parse: yesNo, about: 'use a Chrome or Edge already installed' },
  ai: { path: ['ai', 'provider'], env: 'TOURWRIGHT_AI_PROVIDER', parse: oneOf(['anthropic', 'openai', 'ollama']), about: 'the AI that writes narration (tourwright narrate): anthropic, openai, ollama' },
  aiModel: { path: ['ai', 'model'], env: 'TOURWRIGHT_AI_MODEL', parse: text, about: 'its model (default: claude-opus-5-5, gpt-4o-mini, gemma3)' },
  aiUrl: { path: ['ai', 'url'], env: 'TOURWRIGHT_AI_URL', parse: text, about: 'its server, for an OpenAI-compatible one or a remote Ollama' },
  lock: { path: ['browserLock'], env: 'TOURWRIGHT_BROWSER_LOCK', parse: text, about: 'one browser at a time: a lock file' },
}

const known = key => {
  const setting = SETTINGS[key]
  if (!setting) throw new UserError(`unknown setting "${key}": use ${Object.keys(SETTINGS).join(', ')}`)
  return setting
}

const get = (obj, path) => path.reduce((o, k) => o?.[k], obj)
const put = (obj, path, value) => {
  let o = obj
  for (const k of path.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {})
  if (value === undefined) delete o[path.at(-1)]
  else o[path.at(-1)] = value
  return obj
}

const readUser = () => (existsSync(userConfigFile()) ? readJson(userConfigFile()) : {})
const writeUser = data => {
  mkdirSync(dirname(userConfigFile()), { recursive: true })
  writeFileSync(userConfigFile(), `${JSON.stringify(data, null, 2)}\n`)
}

/** Saves a setting for this user; checked before it is written, so a typo never breaks the next render */
export const setSetting = (key, raw) => {
  const setting = known(key)
  let value
  try {
    value = setting.parse(raw)
  } catch (error) {
    throw new UserError(`${key} ${error.message} (got "${raw}")`)
  }
  writeUser(put(readUser(), setting.path, value))
  // The whole configuration must still load with it
  reloadConfig()
  return value
}

export const unsetSetting = key => {
  const setting = known(key)
  writeUser(put(readUser(), setting.path, undefined))
  reloadConfig()
}

/** Each setting: its value now and where it comes from */
export const listSettings = (config = loadConfig()) => {
  const user = readUser()
  const projectFile = projectConfigFile()
  const project = projectFile ? readJson(projectFile) : {}
  const effective = {
    quality: config.render.quality, fps: config.render.fps, capture: config.render.capture, voice: config.tts.defaultVoice,
    pause: config.tts.pause, polish: config.tts.polish, preset: config.preset, threads: config.threads,
    chromium: config.chromium, systemBrowser: config.systemBrowser, lock: config.browserLock,
    ai: config.ai?.provider, aiModel: config.ai?.model, aiUrl: config.ai?.url,
  }
  return Object.entries(SETTINGS).map(([key, s]) => {
    const from = process.env[s.env] !== undefined ? s.env
      : get(project, s.path) !== undefined ? projectFile
      : get(user, s.path) !== undefined ? userConfigFile()
      : 'default'
    return { key, value: effective[key], from, about: s.about }
  })
}
