// Background music for a video: your tracks (music-library.js), a URL or a file, and the built-in loops
// synthesized by ffmpeg (no audio files to ship or license) when nothing else is there, made once into the cache. Each is eight bars over a I–V–vi–IV progression, so it loops without a seam under the voice.
//   upbeat     112 bpm: pad, plucked arpeggio, bass, kick, claps and hats — a product launch, a promo
//   corporate  100 bpm: pad, arpeggio, soft kick and hats — a demo, an explainer
//   calm        76 bpm: pad and slow notes, no drums — onboarding, a tutorial
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadConfig } from '#core/config.js'
import { hash, log, run, UserError } from '#core/util.js'
import { AUDIO_EXTENSIONS, findTrack, listTracks, MOODS } from './music-library.js'

// C – G – Am – F: the roots (an octave under the melody) and the third of each chord
const ROOTS = [130.81, 98.0, 110.0, 87.31]
const THIRDS = [1.2599, 1.2599, 1.1892, 1.2599]
const FIFTH = 1.4983

/** An expression that picks one of four values by the chord now playing */
const byChord = (chord, values) => values.slice(0, 3).reduceRight((rest, v, i) => `if(eq(${chord},${i}),${v},${rest})`, String(values[3]))

/**
 * The layers of a loop as ffmpeg `aevalsrc` expressions, each with its own filter. Eight bars: the progression
 * twice, a melody joining the second time, so it moves instead of repeating one figure.
 * @param {{ bpm: number, pluck: number, drums: 'full' | 'soft' | 'none', bright: number, pump?: boolean }} m
 */
export const layers = ({ bpm, pluck, drums, bright, pump = false }) => {
  const beat = 60 / bpm
  const bar = 4 * beat
  const loop = 8 * bar
  const chord = `mod(floor(mod(t,${loop})/${bar}),4)`
  const second = `gte(mod(t,${loop}),${4 * bar})`
  const root = byChord(chord, ROOTS)
  const third = byChord(chord, THIRDS)
  // Fades at the edges of every bar or note: a frequency that changes never clicks
  const x = `(mod(t,${bar})/${bar})`
  const swell = `min(1,${x}*5)*min(1,(1-${x})*12)`
  // `pump`: the pad ducks on every beat and swells back, the breathing of dance music
  const breathe = pump ? `*(0.55+0.45*min(1,mod(t,${beat})/${beat * 0.6}))` : ''
  const pad = `0.1*${swell}${breathe}*(sin(2*PI*2*${root}*t)+sin(2*PI*2*${root}*1.004*t)+sin(2*PI*2*${root}*${third}*t)+sin(2*PI*2*${root}*${FIFTH}*t)+0.5*sin(2*PI*2*${root}*1.7818*t)+0.4*sin(2*PI*4*${root}*t))`
  // The arpeggio: root, third, fifth, octave, `pluck` notes per beat
  const step = beat / pluck
  const note = `mod(floor(mod(t,${bar})/${step}),4)`
  const ratio = `if(eq(${note},0),1,if(eq(${note},1),${third},if(eq(${note},2),${FIFTH},2)))`
  const n = `mod(t,${step})`
  const arp = `0.12*exp(-${n}*${(7 * pluck) / 2})*min(1,(${step}-${n})*80)*min(1,${n}*300)*(sin(2*PI*4*${root}*${ratio}*t)+0.3*sin(2*PI*8*${root}*${ratio}*t)+0.1*sin(2*PI*12*${root}*${ratio}*t))`
  // The melody, the second time round: a note per two beats, the fifth, the octave, the third, the fifth
  const two = 2 * beat
  const m = `mod(floor(mod(t,${bar})/${two}),2)+2*mod(floor(mod(t,${loop})/${bar}),2)`
  const lead = `if(eq(${m},0),${FIFTH},if(eq(${m},1),2,if(eq(${m},2),${third}*2,${FIFTH})))`
  const l = `mod(t,${two})`
  const melody = `${second}*0.09*min(1,${l}*30)*min(1,(${two}-${l})*25)*exp(-${l}*1.2)*(sin(2*PI*4*${root}*${lead}*t+0.6*sin(2*PI*5.5*t))+0.35*sin(2*PI*8*${root}*${lead}*t))`
  const b = `mod(t,${beat})`
  const bass = `0.2*exp(-${b}*3.5)*min(1,(${beat}-${b})*40)*min(1,${b}*200)*(sin(2*PI*${root}*t)+0.3*sin(2*PI*2*${root}*t))`
  // A room around the notes: two soft echoes
  const out = [{ expr: `${pad}+${arp}+${melody}${drums === 'none' ? '' : `+${bass}`}`, filter: `lowpass=f=${bright},aecho=0.8:0.6:${Math.round(beat * 750)}|${Math.round(beat * 1500)}:0.22|0.12` }]
  if (drums !== 'none') {
    // Kick on every beat (soft: on 1 and 3), its pitch falling from 155 Hz to 45 Hz
    const k = drums === 'full' ? b : `mod(t,${2 * beat})`
    out.push({ expr: `0.55*sin(2*PI*(45*${k}+3.6*(1-exp(-30*${k}))))*exp(-${k}*9)`, filter: 'lowpass=f=300' })
    // Hats between the beats; the second time round, on every eighth
    const h = `mod(t+${beat / 2},${beat})`
    const h8 = `mod(t,${beat / 2})`
    out.push({ expr: `${drums === 'full' ? 0.07 : 0.05}*(random(0)*2-1)*(exp(-${h}*70)+0.5*${second}*exp(-${h8}*90))`, filter: 'highpass=f=7000,highpass=f=7000' })
    // Claps on 2 and 4
    if (drums === 'full') {
      const c = `mod(t+${beat},${2 * beat})`
      out.push({ expr: `0.12*(random(1)*2-1)*exp(-${c}*26)*lt(${c},0.25)`, filter: 'bandpass=f=1800:w=900,highpass=f=600,aecho=0.8:0.5:60:0.3' })
    }
  }
  return { layers: out, seconds: loop }
}

/** @type {Record<string, { bpm: number, pluck: number, drums: 'full' | 'soft' | 'none', bright: number, pump?: boolean }>} */
export const MUSIC = {
  upbeat: { bpm: 112, pluck: 2, drums: 'full', bright: 7000, pump: true },
  corporate: { bpm: 100, pluck: 2, drums: 'soft', bright: 5500 },
  calm: { bpm: 76, pluck: 1, drums: 'none', bright: 3200 },
}

export const BUILT_IN_MUSIC = Object.keys(MUSIC)

/**
 * The file of a built-in loop (made once into the cache), or null when `name` is not one.
 * @param {string} name @param {Record<string, any>} [config]
 * @returns {Promise<string> | null}
 */
export const builtInMusic = (name, config = loadConfig()) => {
  const spec = MUSIC[name]
  return spec ? generateMusic(name, spec, config) : null
}

const generateMusic = async (name, spec, config) => {
  if (!config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')
  const { layers: parts, seconds } = layers(spec)
  const dir = join(config.cacheDir, 'music')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}-${hash(JSON.stringify(parts))}.wav`)
  if (existsSync(file)) return file
  const tmp = `${file}.${process.pid}.tmp.wav`
  const inputs = parts.flatMap(p => ['-f', 'lavfi', '-i', `aevalsrc='${p.expr}':s=48000:d=${seconds.toFixed(4)}`])
  const chains = parts.map((p, i) => `[${i}:a]${p.filter}[l${i}]`)
  // Mixed, gently compressed and leveled near the loudness of music, so `volume` means the same for any loop
  const mix = `${chains.join(';')};${parts.map((_, i) => `[l${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,` +
    'acompressor=threshold=-18dB:ratio=2.5:attack=15:release=200,alimiter=limit=0.89,volume=2.2[out]'
  try {
    await run(config.ffmpeg, ['-y', '-v', 'error', ...inputs, '-filter_complex', mix, '-map', '[out]', '-ac', '2', '-f', 'wav', tmp])
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  return file
}

// Every track is brought to this loudness before `volume`: 0.3 sounds the same with a quiet loop or a loud master
export const MUSIC_LOUDNESS = -15

/**
 * The gain that brings a track to MUSIC_LOUDNESS, measured once (ffmpeg's EBU R128) and kept in the cache.
 * @param {string} file @returns {Promise<number>}
 */
export const musicGain = async (file, config = loadConfig()) => {
  if (!config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')
  const { size, mtimeMs } = statSync(file)
  const index = join(config.cacheDir, 'music', 'loudness.json')
  let known = {}
  try {
    known = JSON.parse(readFileSync(index, 'utf8'))
  } catch {}
  const key = hash(`${file}:${size}:${mtimeMs}`)
  if (known[key] === undefined) {
    const report = await new Promise((resolve, reject) => {
      const child = spawn(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''
      child.stderr.on('data', c => (err = (err + c).slice(-3000)))
      child.on('error', reject)
      child.on('exit', code => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg could not read ${file}: ${err.trim().slice(-300)}`))))
    })
    const loudness = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+)/.exec(report)?.[1])
    known[key] = Number.isFinite(loudness) && loudness > -70 ? loudness : MUSIC_LOUDNESS
    mkdirSync(dirname(index), { recursive: true })
    writeFileSync(index, JSON.stringify(known))
  }
  // Never more than 4× louder: a track that is mostly silence is not blown up
  return Math.min(4, 10 ** ((MUSIC_LOUDNESS - known[key]) / 20))
}

// A mood with no track of yours: the closest built-in loop
const FALLBACK = { upbeat: 'upbeat', corporate: 'corporate', calm: 'calm', acoustic: 'calm', tech: 'corporate', cinematic: 'calm' }

// A track from a URL: no larger than this, and not waited on forever
const MAX_DOWNLOAD = 60 * 1024 * 1024

/** A track given by URL, downloaded once into the cache */
const downloaded = async (url, config) => {
  let pathname
  try {
    pathname = new URL(url).pathname
  } catch {
    throw new UserError(`music ${url}: not a valid URL`)
  }
  const ext = AUDIO_EXTENSIONS.find(e => pathname.toLowerCase().endsWith(e)) ?? '.mp3'
  const dir = join(config.cacheDir, 'music')
  const file = join(dir, `url-${hash(url)}${ext}`)
  if (existsSync(file)) return file
  mkdirSync(dir, { recursive: true })
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) }).catch(e => {
    throw new UserError(`music ${url}: ${e.name === 'TimeoutError' ? 'no answer in 2 minutes' : e.message}`)
  })
  if (!response.ok) throw new UserError(`music ${url}: ${response.status} ${response.statusText}`)
  const type = response.headers.get('content-type') ?? ''
  if (type && !/^(audio\/|application\/octet-stream|binary\/)/.test(type)) throw new UserError(`music ${url} is not an audio file (${type.split(';')[0]})`)
  const tooBig = () => new UserError(`music ${url}: larger than ${MAX_DOWNLOAD / 1024 / 1024} MB`)
  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) throw tooBig()
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_DOWNLOAD) throw tooBig()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, bytes)
  renameSync(tmp, file)
  return file
}

/**
 * The track from `start` seconds on, cut once into the cache: a looped track then starts every round after its
 * intro (ffmpeg's -ss with -stream_loop would play the intro again on every loop).
 * @param {string} file @param {number} start @returns {Promise<string>}
 */
const fromStart = async (file, start, config) => {
  if (!config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')
  const { size, mtimeMs } = statSync(file)
  const dir = join(config.cacheDir, 'music')
  const out = join(dir, `cut-${hash(`${file}:${size}:${mtimeMs}:${start}`)}.wav`)
  if (existsSync(out)) return out
  mkdirSync(dir, { recursive: true })
  const tmp = `${out}.${process.pid}.tmp.wav`
  try {
    await run(config.ffmpeg, ['-y', '-v', 'error', '-ss', String(start), '-i', file, '-vn', '-ac', '2', '-ar', '48000', '-f', 'wav', tmp])
    renameSync(tmp, out)
  } finally {
    rmSync(tmp, { force: true })
  }
  return out
}

/**
 * The script's `music` ready for compose(). `music` names, in this order:
 *   none                      no music (turns off a style's music)
 *   a track of yours          by name, or a mood (upbeat, calm…): one of your tracks of that mood
 *   an http(s) URL            downloaded once (not for API jobs: they upload the file as an asset)
 *   a file next to the script (or a job asset)
 *   a mood with no track      the closest built-in loop, made by ffmpeg
 * @param {string | Record<string, any> | undefined} music @param {(file: string) => string} toPath
 * @param {Record<string, any>} [config]
 * @param {{ seed?: string, sandboxed?: boolean }} [options]  seed: the video's title, to pick among tracks of a mood
 * @returns {Promise<Record<string, any> | null>}
 */
export const placeMusic = async (music, toPath, config = loadConfig(), { seed = '', sandboxed = false } = {}) => {
  const found = await findMusic(music, toPath, config, { seed, sandboxed })
  if (!found) return null
  const { start, ...placed } = /** @type {Record<string, any>} */ (found)
  if (start > 0) placed.file = await fromStart(placed.file, start, config)
  return { ...placed, gain: await musicGain(placed.file, config) }
}

/**
 * Whether the script's `music` can be found, before anything is filmed: nothing is downloaded or made, so a
 * typo fails in a second, also in a dry run.
 * @param {string | Record<string, any> | undefined} music @param {(file: string) => string} toPath
 */
export const checkMusic = (music, toPath, config = loadConfig(), { sandboxed = false } = {}) =>
  findMusic(music, toPath, config, { seed: '', sandboxed, look: true })

/** @param {string | Record<string, any> | undefined} music @param {(file: string) => string} toPath */
const findMusic = async (music, toPath, config, { seed, sandboxed, look = false }) => {
  const m = typeof music === 'string' ? { file: music } : music
  if (!m?.file || m.file === 'none') return null
  const wanted = String(m.file)
  const track = findTrack(wanted, seed, config)
  if (track) return { ...m, file: track.file, track: track.name }
  if (/^https?:\/\//i.test(wanted)) {
    if (sandboxed) throw new UserError('music from a URL is not fetched for API jobs: send the file as an asset and name it in `music`')
    return { ...m, file: look ? wanted : await downloaded(wanted, config) }
  }
  const path = toPath(wanted)
  if (existsSync(path) && statSync(path).isFile()) return { ...m, file: path }
  const loop = FALLBACK[wanted] ?? (Object.hasOwn(MUSIC, wanted) ? wanted : null)
  if (loop) {
    if (look) return { ...m, file: loop }
    log.info(`music: no track of yours for "${wanted}"; using the built-in ${loop} loop (tourwright install --music adds real ones, tourwright music add yours)`)
    return { ...m, file: await builtInMusic(loop, config) }
  }
  const mine = listTracks(config).map(t => t.name)
  throw new UserError(`music not found: ${wanted}. Use a file next to the script, a URL, one of your tracks${mine.length ? ` (${mine.join(', ')})` : ''} or a mood: ${MOODS.join(', ')}`)
}

/**
 * What a client may put in `music`: the tracks of this machine (no paths), the moods and the built-in loops.
 * @returns {{ tracks: Omit<import('./music-library.js').Track, 'file' | 'source'>[], moods: string[], builtIn: string[], how: string }}
 */
export const musicCatalog = (config = loadConfig()) => ({
  // No paths and no source URLs (one may carry a token): what a track is, not where it came from
  tracks: listTracks(config).map(({ file, source, ...t }) => t),
  moods: MOODS,
  builtIn: BUILT_IN_MUSIC,
  how: 'music: <track name> | <mood> (one of these tracks of that mood, else a built-in loop) | none. Your own track: send it in `assets` and write its asset name in music.',
})
