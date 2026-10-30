// Text-to-speech with pluggable engines and a disk cache.
//
// A voice is a string `engine:id[?option=value&…]`, or an alias (built-in, from the config or from the
// script's `voices`), optionally with more options: `salome?rate=+10%` is Salome, a bit faster.
//   piper:es_MX-claude-high                 offline, open source (default)
//   edge:es-CO-SalomeNeural?rate=-4%        Microsoft Edge neural voices (needs internet, unofficial)
//   openai:alloy?model=tts-1-hd             any OpenAI-compatible /v1/audio/speech server
//   command:my-voice                        TOURWRIGHT_TTS_COMMAND, for any other engine
//
// Every voice understands rate, pitch and volume: engines that cannot do one natively get it from ffmpeg.
//
// How a phrase is built: it is split only between sentences (after . ? !). Each sentence is synthesized
// whole, so commas are breathed by the voice itself; the silence around each one is trimmed and a short,
// even pause is placed between them. Every sentence and phrase is cached by engine, voice and text:
// rendering the same script twice never asks the engine again.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { concatEntry, hash, run, UserError } from '../util.js'
import { ENGINES } from './engines.js'

// Built-in aliases: tested voices that sound good. Config `tts.aliases` adds or overrides.
export const ALIASES = {
  // Spanish · Colombia
  gonzalo: 'edge:es-CO-GonzaloNeural?rate=-10%',
  salome: 'edge:es-CO-SalomeNeural?rate=-4%',
  // Spanish · Mexico, US
  jorge: 'edge:es-MX-JorgeNeural?rate=-6%',
  dalia: 'edge:es-MX-DaliaNeural?rate=-4%',
  alonso: 'edge:es-US-AlonsoNeural?rate=-6%',
  paloma: 'edge:es-US-PalomaNeural?rate=-4%',
  // Multilingual (speak most languages without a strong accent)
  andrew: 'edge:en-US-AndrewMultilingualNeural?rate=-6%',
  ava: 'edge:en-US-AvaMultilingualNeural?rate=-4%',
  emma: 'edge:en-US-EmmaMultilingualNeural?rate=-4%',
  brian: 'edge:en-US-BrianMultilingualNeural?rate=-6%',
  // Offline (Piper)
  claude: 'piper:es_MX-claude-high',
  davefx: 'piper:es_ES-davefx-medium',
  lessac: 'piper:en_US-lessac-medium',
}

// Warmth in the lows, a bit of presence, gentle compression, a small room and loudness normalized to
// -16 LUFS (web/podcast standard): removes the dry edge of synthetic speech.
export const POLISH_DEFAULT =
  'highpass=f=80,equalizer=f=180:t=q:w=1:g=2,equalizer=f=4000:t=q:w=1.5:g=1.5,' +
  'acompressor=threshold=-20dB:ratio=2.5:attack=10:release=150,' +
  'aecho=0.85:0.6:35|60:0.12|0.07,loudnorm=I=-16:TP=-1.5:LRA=11'

// Named sounds for the narration. Scripts pick one by name; only the server config takes a raw filter.
export const POLISH_PRESETS = {
  default: POLISH_DEFAULT,
  // Just even loudness: the voice as the engine made it
  clean: 'highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=11',
  // Closer and rounder, no room
  warm: 'highpass=f=70,equalizer=f=150:t=q:w=1:g=3.5,equalizer=f=3000:t=q:w=2:g=-1,equalizer=f=8000:t=q:w=2:g=-2,' +
    'acompressor=threshold=-22dB:ratio=3:attack=10:release=200,loudnorm=I=-16:TP=-1.5:LRA=9',
  // Telephone / walkie-talkie band
  radio: 'highpass=f=300,lowpass=f=3400,equalizer=f=1800:t=q:w=1:g=4,acompressor=threshold=-25dB:ratio=6:attack=5:release=100,' +
    'loudnorm=I=-16:TP=-1.5:LRA=7',
  // Dense and upfront, like a podcast host
  podcast: 'highpass=f=80,equalizer=f=200:t=q:w=1:g=2,equalizer=f=5000:t=q:w=1.5:g=2.5,' +
    'acompressor=threshold=-24dB:ratio=4:attack=5:release=120:makeup=2,aecho=0.9:0.7:20:0.05,loudnorm=I=-16:TP=-1.5:LRA=7',
  none: null,
}

// The script's preset wins over the server's; the server may also set a raw ffmpeg filter.
export const polishFilter = (config = loadConfig(), preset) => {
  const p = preset ?? config.tts.polish
  if (!p || p === 'none') return null
  return Object.hasOwn(POLISH_PRESETS, p) ? POLISH_PRESETS[p] : p
}

const TRIM =
  'silenceremove=start_periods=1:start_threshold=-45dB,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-45dB,areverse'

// `a=1&b=-4%`: values are taken literally (`+10%` stays `+10%`, unlike URL decoding)
const parseOptions = query =>
  Object.fromEntries((query ?? '').split('&').filter(Boolean).map(pair => {
    const i = pair.indexOf('=')
    return i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)]
  }))

const withOptions = (base, options) => {
  const query = Object.entries(options).map(([k, v]) => `${k}=${v}`).join('&')
  return query ? `${base}?${query}` : base
}

// `aliases`: extra names, like the script's cast of voices. Options written after an alias add to (or
// replace) the alias' own.
export const parseVoice = (spec, config = loadConfig(), aliases = {}) => {
  const names = { ...ALIASES, ...config.tts.aliases, ...aliases }
  let [value, query] = String(spec ?? config.tts.defaultVoice).trim().split(/\?(.*)/s)
  let options = parseOptions(query)
  for (let i = 0; i < 8 && Object.hasOwn(names, value); i++) {
    const [base, own] = String(names[value]).trim().split(/\?(.*)/s)
    value = base
    options = { ...parseOptions(own), ...options }
  }
  const m = /^([a-z][a-z0-9]*):(.+)$/.exec(value)
  if (!m) throw new UserError(`unknown voice "${spec}": use engine:id (${Object.keys(ENGINES).map(e => `${e}:…`).join(', ')}) or a name (${Object.keys(names).join(', ')})`)
  const [, engine, id] = m
  if (!ENGINES[engine]) throw new UserError(`unknown TTS engine "${engine}" (${Object.keys(ENGINES).join(', ')})`)
  // The id ends up in file paths (piper) and in a shell line (command): letters, digits, . _ - only
  if (!/^[A-Za-z0-9_.-]+$/.test(id) || id.includes('..')) throw new UserError(`invalid voice id "${id}"`)
  return { engine, id, options, spec: withOptions(`${engine}:${id}`, options) }
}

// A voice with some options changed: `withProsody('ana', { rate: '+10%' })` → 'ana?rate=+10%'.
/** @param {string} spec @param {{ rate?: string, pitch?: string, volume?: string, style?: string }} [prosody] */
export const withProsody = (spec, { rate, pitch, volume, style } = {}) => {
  const extra = Object.fromEntries(Object.entries({ rate, pitch, volume, instructions: style }).filter(([, v]) => v !== undefined))
  if (!Object.keys(extra).length) return spec
  const [base, query] = String(spec).split(/\?(.*)/s)
  return withOptions(base, { ...parseOptions(query), ...extra })
}

const number = (value, unit) => {
  const m = new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)${unit}$`).exec(String(value).trim())
  return m ? Number(m[1]) : null
}

// ffmpeg filters for the rate, pitch and volume an engine does not handle itself.
export const prosodyFilter = (options, native = []) => {
  const filters = []
  const has = k => options[k] !== undefined && options[k] !== '' && !native.includes(k)
  if (has('pitch')) {
    const st = number(options.pitch, 'st')
    const pct = number(options.pitch, '%')
    const factor = st !== null ? 2 ** (st / 12) : pct !== null ? 1 + pct / 100 : null
    if (factor === null) throw new UserError(`pitch "${options.pitch}": use semitones (+2st) or percent (-5%) with this voice`)
    if (factor !== 1) {
      const f = Math.min(2, Math.max(0.5, factor))
      filters.push(`asetrate=24000*${f.toFixed(4)},aresample=24000,atempo=${(1 / f).toFixed(4)}`)
    }
  }
  if (has('rate')) {
    const pct = number(options.rate, '%')
    if (pct === null) throw new UserError(`rate "${options.rate}": use a percent (+10%, -15%)`)
    if (pct) filters.push(`atempo=${Math.min(2, Math.max(0.5, 1 + pct / 100)).toFixed(4)}`)
  }
  if (has('volume')) {
    const db = number(options.volume, 'dB')
    const pct = number(options.volume, '%')
    if (db === null && pct === null) throw new UserError(`volume "${options.volume}": use dB (+3dB) or percent (-20%)`)
    filters.push(db !== null ? `volume=${db}dB` : `volume=${Math.max(0, 1 + pct / 100).toFixed(3)}`)
  }
  return filters.join(',')
}

// Exact pauses inside a narration: "First this. [[1.5s]] Then that." or [[800ms]].
const PAUSE = /\[\[\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*\]\]/g

// The text of a narration as it is shown (captions): without pause marks.
export const stripMarks = text => String(text ?? '').replace(PAUSE, ' ').replace(/[ \t]{2,}/g, ' ').trim()

// "Then press {Pay}." → what is said ("Then press Pay.") and what comes before the first marked word
// ("Then press "), whose length tells when that word is heard.
export const markedLine = line => {
  const text = String(line ?? '')
  const mark = /\{([^{}]+)\}/.exec(text)
  const unmark = s => s.replace(/\{([^{}]+)\}/g, '$1')
  return { spoken: unmark(text), before: mark ? unmark(text.slice(0, mark.index)) : null }
}

// Words said differently from how they are written. Whole words only; captions keep the original.
export const applyPronunciation = (text, words = {}) => {
  const keys = Object.keys(words).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!keys.length) return text
  const literal = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map(literal).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  return String(text).replace(re, w => words[w])
}

// Splits a narration into sentences. "|" (pause mark) reads as a comma; *emphasis* marks are dropped.
export const splitSentences = text =>
  String(text)
    .replace(/\*/g, '')
    .replace(/,?\s*\|\s*/g, ', ')
    .split(/(?<=[.?!…])\s+/)
    .map(s => s.trim())
    .filter(s => s && !/^[.,;:?!…]+$/.test(s))

// Pieces of a narration: sentences, and the exact silences written between them.
export const splitNarration = text => {
  const parts = []
  let last = 0
  for (const m of String(text).matchAll(PAUSE)) {
    for (const s of splitSentences(text.slice(last, m.index))) parts.push({ text: s })
    parts.push({ silence: Math.min(10, Number(m[1]) / (m[2] === 'ms' ? 1000 : 1)) })
    last = m.index + m[0].length
  }
  for (const s of splitSentences(String(text).slice(last))) parts.push({ text: s })
  return parts
}

export const durationOf = async (file, config = loadConfig()) => {
  if (!config.ffprobe) throw new Error('ffprobe not found (install ffmpeg or set TOURWRIGHT_FFPROBE)')
  const { stdout } = await run(config.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Number(stdout.trim())
}

const requireFfmpeg = config => {
  if (!config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')
  return config.ffmpeg
}

// Writes atomically: a crash or a parallel worker never leaves a half-written file in the cache.
const atomic = async (target, produce) => {
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp.wav`
  try {
    await produce(tmp)
    renameSync(tmp, target)
  } finally {
    rmSync(tmp, { force: true })
  }
}

const sentence = async (text, voice, config) => {
  const dir = join(config.cacheDir, 'voice', 'sentences')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${hash(`${voice.spec}:${text}`)}.wav`)
  if (existsSync(file)) return file
  const raw = `${file}.${process.pid}.raw`
  const engine = ENGINES[voice.engine]
  const prosody = prosodyFilter(voice.options, typeof engine.native === 'function' ? engine.native(voice.options) : engine.native)
  try {
    await engine.synthesize({ text, voice, out: raw, config })
    const af = `${TRIM},aresample=24000${prosody ? `,${prosody}` : ''}`
    await atomic(file, tmp => run(requireFfmpeg(config), ['-y', '-v', 'error', '-i', raw, '-af', af, '-ar', '24000', '-ac', '1', '-f', 'wav', tmp]))
  } finally {
    rmSync(raw, { force: true })
  }
  return file
}

const silence = async (seconds, config) => {
  const dir = join(config.cacheDir, 'voice', 'sentences')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `silence-${seconds}.wav`)
  if (!existsSync(file)) {
    await atomic(file, tmp => run(requireFfmpeg(config), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(seconds), '-f', 'wav', tmp]))
  }
  return file
}

// Narrates `text` with `voiceSpec` (or takes it from the cache). Returns the wav file and its duration in seconds.
// Options: aliases (the script's voices), pause (seconds between sentences), pronounce ({ word: how it is said }).
/**
 * @param {string} text @param {string} [voiceSpec] @param {any} [config]
 * @param {{ aliases?: Record<string, string>, pause?: number, pronounce?: Record<string, string> }} [options]
 */
export const narrate = async (text, voiceSpec, config = loadConfig(), { aliases = undefined, pause = config.tts.pause, pronounce = undefined } = {}) => {
  const voice = parseVoice(voiceSpec, config, aliases)
  const parts = splitNarration(applyPronunciation(text, { ...config.tts.pronounce, ...pronounce }))
  if (!parts.some(p => p.text)) throw new UserError('nothing to narrate')
  const dir = join(config.cacheDir, 'voice')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${voice.engine}-${hash(`${voice.spec}:${pause}:${JSON.stringify(parts)}`)}.wav`)
  if (!existsSync(file)) {
    const lines = []
    let gap = false
    for (const part of parts) {
      if (part.silence !== undefined) {
        if (part.silence > 0) lines.push(concatEntry(await silence(part.silence, config)))
        gap = false
        continue
      }
      if (gap && pause > 0) lines.push(concatEntry(await silence(pause, config)))
      lines.push(concatEntry(await sentence(part.text, voice, config)))
      gap = true
    }
    const listFile = `${file}.${process.pid}.txt`
    writeFileSync(listFile, lines.join('\n'))
    try {
      await atomic(file, tmp => run(requireFfmpeg(config), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-f', 'wav', tmp]))
    } finally {
      rmSync(listFile, { force: true })
    }
  }
  return { file, duration: await durationOf(file, config), voice: voice.spec }
}

// Every voice this server can use right now, with the engines that are (not) available.
export const listVoices = async (config = loadConfig()) => {
  const engines = Object.fromEntries(
    await Promise.all(Object.entries(ENGINES).map(async ([name, e]) => [name, await e.available(config)]))
  )
  const voices = []
  for (const [alias, spec] of Object.entries({ ...ALIASES, ...config.tts.aliases })) {
    const engine = spec.split(':')[0]
    if (engine === 'piper' && engines.piper.ok) {
      const model = spec.slice(6).split('?')[0]
      if (!existsSync(join(config.tts.piper.voicesDir, `${model}.onnx`))) continue
    }
    voices.push({ name: alias, voice: spec, engine, available: Boolean(engines[engine]?.ok) })
  }
  if (engines.piper.ok && existsSync(config.tts.piper.voicesDir)) {
    for (const f of readdirSync(config.tts.piper.voicesDir).filter(f => f.endsWith('.onnx'))) {
      voices.push({ name: `piper:${f.slice(0, -5)}`, voice: `piper:${f.slice(0, -5)}`, engine: 'piper', available: true })
    }
  }
  return { default: config.tts.defaultVoice, engines, voices }
}
