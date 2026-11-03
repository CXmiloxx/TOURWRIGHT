// Text-to-speech with pluggable engines and a disk cache.
//
// A voice is a string `engine:id[?option=value&…]`, or an alias (built-in, from the config or from the
// script's `voices`), optionally with more options: `salome?rate=+10%` is Salome, a bit faster.
//   pocket:lola                             offline, open, natural (default once installed)
//   piper:es_MX-claude-high                 offline, open source, light (default without Pocket TTS)
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
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'
import { concatEntry, hash, run, UserError } from '../util.js'
import { ENGINES } from './engines.js'
import { lexicon, speakable, voiceLanguage } from './lexicon.js'
import { findPiperVoice, installedPiperVoices } from './piper-voices.js'

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
  // English · US, UK
  jenny: 'edge:en-US-JennyNeural?rate=-4%',
  guy: 'edge:en-US-GuyNeural?rate=-6%',
  sonia: 'edge:en-GB-SoniaNeural?rate=-4%',
  // Offline, open and natural (Pocket TTS: tourwright install --pocket). Spanish, then English
  lola: 'pocket:lola',
  'lola-rapida': 'pocket:lola?model=spanish',
  alba: 'pocket:alba',
  jane: 'pocket:jane',
  mary: 'pocket:mary',
  michael: 'pocket:michael',
  george: 'pocket:george',
  // Offline (Piper): lighter, more synthetic
  claude: 'piper:es_MX-claude-high',
  davefx: 'piper:es_ES-davefx-medium',
  lessac: 'piper:en_US-lessac-medium',
  ryan: 'piper:en_US-ryan-high',
}

// The sound of each preset, without the loudness: compose() levels every sentence to the same loudness on its
// own (two passes, linear gain), so no sentence comes out louder than the next and nothing pumps in the silences.
// default: clear and close, the way people expect a narrator: warmth in the lows, presence where consonants live,
// softer "s", gentle compression. No room: an echo blurs the words.
export const POLISH_DEFAULT =
  'highpass=f=80,equalizer=f=180:t=q:w=1:g=1.5,equalizer=f=3200:t=q:w=1.2:g=2.5,deesser=i=0.35,' +
  'acompressor=threshold=-20dB:ratio=2.5:attack=8:release=140'

// Named sounds for the narration. Scripts pick one by name; only the server config takes a raw filter.
export const POLISH_PRESETS = {
  default: POLISH_DEFAULT,
  // Just even loudness: the voice as the engine made it
  clean: 'highpass=f=60',
  // Closer and rounder
  warm: 'highpass=f=70,equalizer=f=150:t=q:w=1:g=3.5,equalizer=f=3000:t=q:w=2:g=-1,equalizer=f=8000:t=q:w=2:g=-2,' +
    'acompressor=threshold=-22dB:ratio=3:attack=10:release=200',
  // Telephone / walkie-talkie band
  radio: 'highpass=f=300,lowpass=f=3400,equalizer=f=1800:t=q:w=1:g=4,acompressor=threshold=-25dB:ratio=6:attack=5:release=100',
  // Dense and upfront, like a podcast host, with a hint of room
  podcast: 'highpass=f=80,equalizer=f=200:t=q:w=1:g=2,equalizer=f=5000:t=q:w=1.5:g=2.5,deesser=i=0.4,' +
    'acompressor=threshold=-24dB:ratio=4:attack=5:release=120:makeup=2,aecho=0.9:0.7:20:0.05',
  none: null,
}

// Where every sentence lands: -16 LUFS (web and podcast standard), peaks under -1.5 dB
export const LOUDNESS = { I: -16, TP: -1.5, LRA: 7 }
const LOUDNORM = `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`

/** The tone of a preset only (or the server's raw filter, as it is); null for none */
export const polishTone = (config = loadConfig(), preset) => {
  const p = preset ?? config.tts.polish
  if (!p || p === 'none') return null
  return Object.hasOwn(POLISH_PRESETS, p) ? POLISH_PRESETS[p] : p
}

// The script's preset wins over the server's; the server may also set a raw ffmpeg filter.
// One filter for a single clip (voice samples): the tone, then the loudness. A raw server filter goes as it is.
export const polishFilter = (config = loadConfig(), preset) => {
  const p = preset ?? config.tts.polish
  const tone = polishTone(config, preset)
  if (!tone) return null
  return Object.hasOwn(POLISH_PRESETS, p) ? `${tone},${LOUDNORM}` : tone
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

// The most natural voice this machine can use for a language, when nobody chose one: Pocket TTS (offline,
// natural) when installed; else a neural Microsoft voice when edge-tts answers (needs internet; tried once per
// process with a short word); else Piper, offline everywhere.
const AUTO = {
  pocket: { es: 'lola', en: 'alba', pt: 'pocket:rafael', fr: 'pocket:estelle', de: 'pocket:juergen', it: 'pocket:giovanni' },
  edge: { es: 'salome', en: 'ava' },
  piper: { es: 'claude', en: 'lessac' },
}
let edgeWorks = null
const edgeAnswers = async config => {
  edgeWorks ??= (async () => {
    if (!(await ENGINES.edge.available(config).catch(() => ({ ok: false }))).ok) return false
    const dir = mkdtempSync(join(tmpdir(), 'tw-edge-'))
    try {
      const probe = ENGINES.edge.synthesize({ text: 'ok', voice: parseVoice('ava', config), out: join(dir, 'probe.wav'), config })
      await Promise.race([probe, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))])
      return true
    } catch {
      return false
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })()
  return edgeWorks
}

/** @param {string} [language] @returns {Promise<string>} a voice spec */
export const autoVoice = async (language, config = loadConfig()) => {
  if (config.tts.voiceChosen) return config.tts.defaultVoice
  const lang = String(language ?? 'es').slice(0, 2).toLowerCase()
  if (config.tts.pocket?.python) return AUTO.pocket[lang] ?? AUTO.pocket.en
  // Multilingual Ava speaks the other languages without a strong accent
  if (await edgeAnswers(config)) return AUTO.edge[lang] ?? 'ava'
  return AUTO.piper[lang] ?? config.tts.defaultVoice
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

// The length of a PCM WAV file from its header (what narrate() writes): no ffprobe process per narration.
// null when the file is not a plain WAV that can be read that way.
export const wavDuration = file => {
  let fd
  try {
    fd = openSync(file, 'r')
    const head = Buffer.alloc(4096)
    const read = readSync(fd, head, 0, head.length, 0)
    if (read < 12 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null
    let byteRate = 0
    for (let at = 12; at + 8 <= read;) {
      const id = head.toString('ascii', at, at + 4)
      const size = head.readUInt32LE(at + 4)
      if (id === 'fmt ' && at + 20 <= read) byteRate = head.readUInt32LE(at + 16)
      if (id === 'data') {
        if (!byteRate) return null
        // A size ffmpeg could not fill in (0 or 0xFFFFFFFF): the rest of the file is the data
        const rest = fstatSync(fd).size - (at + 8)
        return (size && size !== 0xffffffff ? Math.min(size, rest) : rest) / byteRate
      }
      at += 8 + size + (size % 2)
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export const durationOf = async (file, config = loadConfig()) => {
  if (/\.wav$/i.test(file)) {
    const seconds = wavDuration(file)
    if (seconds !== null) return seconds
  }
  if (!config.ffprobe) throw new Error('ffprobe not found (install ffmpeg or set TOURWRIGHT_FFPROBE)')
  const { stdout } = await run(config.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Number(stdout.trim())
}

const requireFfmpeg = config => {
  if (!config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')
  return config.ffmpeg
}

// Files being made right now (a sentence or a whole line), so a second request waits for the first
/** @type {Map<string, Promise<void>>} */
const making = new Map()

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
  // Two lines made at once may share a sentence: it is made once
  if (!making.has(file)) making.set(file, synthesizeSentence(file, text, voice, config).finally(() => making.delete(file)))
  await making.get(file)
  return file
}

const synthesizeSentence = async (file, text, voice, config) => {
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
// Options: aliases (the script's voices), pause (seconds between sentences), pronounce ({ word: how it is said }),
// language (the script's, when the voice's name does not tell it). Tech words, acronyms and numbers are said
// the way people say them in the voice's language (src/voice/lexicon.js); `pronounce` wins over that.
/**
 * @param {string} text @param {string} [voiceSpec] @param {any} [config]
 * @param {{ aliases?: Record<string, string>, pause?: number, pronounce?: Record<string, string>, language?: string }} [options]
 */
export const narrate = async (text, voiceSpec, config = loadConfig(), { aliases = undefined, pause = config.tts.pause, pronounce = undefined, language = undefined } = {}) => {
  const voice = parseVoice(voiceSpec, config, aliases)
  const lang = voiceLanguage(voice) ?? language
  const parts = splitNarration(speakable(applyPronunciation(text, { ...lexicon(lang, voice.engine), ...config.tts.pronounce, ...pronounce }), lang))
  if (!parts.some(p => p.text)) throw new UserError('nothing to narrate')
  const dir = join(config.cacheDir, 'voice')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${voice.engine}-${hash(`${voice.spec}:${pause}:${JSON.stringify(parts)}`)}.wav`)
  // The same line asked again while it is being made (warmed up ahead, then reached on camera) waits for it
  if (!existsSync(file)) {
    if (!making.has(file)) making.set(file, build(file, parts, voice, pause, config).finally(() => making.delete(file)))
    await making.get(file)
  }
  return { file, duration: await durationOf(file, config), voice: voice.spec }
}

const build = async (file, parts, voice, pause, config) => {
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
  // Unique per call: two processes (or two workers) making the same line never share a list file
  const listFile = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.txt`
  writeFileSync(listFile, lines.join('\n'))
  try {
    await atomic(file, tmp => run(requireFfmpeg(config), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-f', 'wav', tmp]))
  } finally {
    rmSync(listFile, { force: true })
  }
}

// The languages a voice is for: its own, and Spanish and English for the multilingual ones
/** @returns {string[]} */
export const voiceLanguages = voice => (/Multilingual/.test(voice.id) ? ['es', 'en'] : [voiceLanguage(voice) ?? 'es'])

// A recorded sample of every built-in voice comes with Tourwright (docs/voices/<name>.mp3): anyone can listen
// to them and choose before installing anything. `tourwright voices --samples` records them again, with
// this server's voices or another text.
export const SAMPLES_DIR = fileURLToPath(new URL('../../docs/voices/', import.meta.url))
export const SAMPLES_URL = 'https://github.com/CXmiloxx/TOURWRIGHT/tree/main/docs/voices'

const SAMPLE_TEXT = {
  es: 'Hola, soy {name}. Así sueno narrando un video: la API responde en JSON, el informe llega en PDF, y este mes van 25.800 consultas, el 95 % con resultado.',
  en: "Hi, I'm {name}. This is how I sound narrating a video: the API answers in JSON, the report comes as a PDF, and this month there were twenty-five thousand searches.",
}

/**
 * Records a sample of each named voice into `out` (mp3). Multilingual voices speak Spanish, the rest their language.
 * @param {any} config @param {{ out: string, text?: string, only?: string[] }} options
 * @returns {Promise<{ name: string, voice: string, language: string, file?: string, error?: string }[]>}
 */
export const recordSamples = async (config, { out, text, only = [] }) => {
  const named = Object.entries({ ...ALIASES, ...config.tts.aliases }).filter(([name]) => !only.length || only.includes(name))
  const results = []
  for (const [name, spec] of named) {
    let languages = ['es']
    try {
      languages = voiceLanguages(parseVoice(spec, config))
    } catch {}
    // One folder per language: docs/voices/es/lola.mp3, docs/voices/en/alba.mp3
    for (const lang of languages) {
      try {
        const said = (text ?? SAMPLE_TEXT[lang] ?? SAMPLE_TEXT.es).replaceAll('{name}', name.split('-')[0].replace(/^./, c => c.toUpperCase()))
        const n = await narrate(said, spec, config, { language: lang })
        mkdirSync(join(out, lang), { recursive: true })
        const file = join(out, lang, `${name}.mp3`)
        await run(requireFfmpeg(config), ['-y', '-v', 'error', '-i', n.file, '-af', polishFilter(config) ?? 'anull', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', file])
        results.push({ name, voice: spec, language: lang, file })
      } catch (error) {
        results.push({ name, voice: spec, language: lang, error: String(error.message).split('\n')[0] })
      }
    }
  }
  return results
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
      if (!findPiperVoice(config, model)) continue
    }
    let languages = []
    try {
      languages = voiceLanguages(parseVoice(spec, config))
    } catch {}
    const samples = Object.fromEntries(languages.map(l => [l, join(SAMPLES_DIR, l, `${alias}.mp3`)]).filter(([, f]) => existsSync(f)))
    voices.push({ name: alias, voice: spec, engine, languages, available: Boolean(engines[engine]?.ok), samples })
  }
  if (engines.piper.ok) {
    // Installed Piper voices without a name of their own
    for (const id of installedPiperVoices(config).filter(id => !voices.some(v => v.voice === `piper:${id}`))) {
      voices.push({ name: `piper:${id}`, voice: `piper:${id}`, engine: 'piper', languages: [id.slice(0, 2)], available: true, samples: {} })
    }
  }
  return { default: config.tts.defaultVoice, engines, voices }
}
