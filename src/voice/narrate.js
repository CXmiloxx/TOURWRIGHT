// Saying a narration: each sentence synthesized whole (or taken from the disk cache), trimmed, and joined with
// even pauses. Every sentence and phrase is cached by engine, voice and text: the same script twice never asks
// the engine again.
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '#core/config.js'
import { concatEntry, hash, run, UserError } from '#core/util.js'
import { ENGINES } from './engines.js'
import { lexicon, speakable, voiceLanguage } from './lexicon.js'
import { prosodyFilter } from './sound.js'
import { applyPronunciation, splitNarration } from './text.js'
import { parseVoice } from './voices.js'

const TRIM =
  'silenceremove=start_periods=1:start_threshold=-45dB,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-45dB,areverse'
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

export const requireFfmpeg = config => {
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

export const silence = async (seconds, config) => {
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
