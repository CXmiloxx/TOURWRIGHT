// `tourwright render --keep` keeps what a video is made of next to it; `tourwright recompose` makes the video again
// from that, without opening the browser: the app is not touched again (no second sign-up, no second SMS).
//
//   videos/<name>/<name>.source/
//     timeline.json   cuts, captions, chapters, narration (text, voice, file), effects, blurs, when each step starts
//     raw.<ext>       the recording, as filmed
//     voice/NNN.wav   each sentence as the voice said it (before leveling)
//     sounds/…        clicks, typing and sounds
//     frame/…         the studio frame, when the theme uses one
//
// What can change in timeline.json (or with options): the text of a caption or of a sentence (it is said again),
// the voice, the sound of the narration (`polish`), clicks and typing on or off, music, and `blurs`: boxes of the
// video blurred between two seconds of the final video (a date that should not have been seen).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { compose } from './compose.js'
import { qualityOf } from './quality.js'
import { loadConfig } from '#core/config.js'
import { reportFindings, reviewAudio, reviewVideo } from './review.js'
import { toOutput, normalizeCuts } from './timeline.js'
import { isInside, log, UserError } from '#core/util.js'
import { narrate, parseVoice, POLISH_PRESETS } from '#voice/index.js'

const TIMELINE = 'timeline.json'
const VERSION = 1

// Moved when it can be (the recording is big), copied when it is on another disk
const moveFile = (from, to) => {
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to)
  }
}

/**
 * Saves the parts of a finished video next to it. Called while the work folder still exists.
 * @param {Record<string, any>} p  what compose() got, plus { steps, voice, speech, quality (name), export }
 * @returns {string} the folder
 */
export const keepSource = p => {
  const folder = `${p.out}.source`
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(join(folder, 'voice'), { recursive: true })
  mkdirSync(join(folder, 'sounds'), { recursive: true })
  const raw = `raw${extname(p.video) || '.webm'}`
  moveFile(p.video, join(folder, raw))
  // The same sound file is kept once, whatever the number of clicks
  const sounds = new Map()
  const sound = file => {
    if (!sounds.has(file)) {
      const name = `${String(sounds.size + 1).padStart(3, '0')}-${basename(file)}`
      copyFileSync(file, join(folder, 'sounds', name))
      sounds.set(file, `sounds/${name}`)
    }
    return sounds.get(file)
  }
  const narrations = p.narrations.filter(n => existsSync(n.file)).map((n, i) => {
    const file = `voice/${String(i + 1).padStart(3, '0')}.wav`
    copyFileSync(n.file, join(folder, file))
    return { at: n.at, file, duration: n.duration, step: n.step, text: n.text, said: n.text, voice: n.voice }
  })
  let frame = null
  if (p.frame) {
    mkdirSync(join(folder, 'frame'), { recursive: true })
    copyFileSync(p.frame.background, join(folder, 'frame', 'background.png'))
    copyFileSync(p.frame.mask, join(folder, 'frame', 'mask.png'))
    frame = { ...p.frame, background: 'frame/background.png', mask: 'frame/mask.png' }
  }
  let music = null
  if (p.music?.file && existsSync(p.music.file)) {
    music = { ...p.music, file: sound(p.music.file) }
  }
  const cuts = normalizeCuts(p.cuts)
  const timeline = {
    version: VERSION,
    title: p.title,
    name: basename(p.out),
    language: p.language ?? null,
    quality: p.quality,
    fps: p.fps,
    end: p.end,
    video: raw,
    voice: p.voice ?? null,
    speech: p.speech ?? {},
    polish: p.polish ?? null,
    cuts: p.cuts,
    // When each step starts, in seconds of the final video: to place a blur
    steps: (p.steps ?? []).map(s => ({ step: s.step, at: Number(toOutput(s.at, cuts).toFixed(2)) })),
    captions: p.captions,
    marks: p.marks,
    narrations,
    effects: p.effects.filter(e => existsSync(e.file)).map(e => ({ at: e.at, file: sound(e.file), volume: e.volume, kind: e.kind ?? 'sound' })),
    music,
    frame,
    blurs: [],
  }
  writeFileSync(join(folder, TIMELINE), JSON.stringify(timeline, null, 2))
  const where = isInside(dirname(folder), process.cwd()) ? relative(process.cwd(), dirname(folder)) || '.' : dirname(folder)
  log.info(`source kept in ${folder} (to make it again: tourwright recompose ${where})`)
  return folder
}

const blur = z.object({
  x: z.number().finite().min(0), y: z.number().finite().min(0), width: z.number().finite().min(4), height: z.number().finite().min(4),
  start: z.number().min(0).optional(), end: z.number().positive().optional(),
}).strict()

const seconds = z.number().finite().min(0).max(30)
const timelineSchema = z.object({
  version: z.literal(VERSION),
  title: z.string(),
  // A file name, never a path: the video is written next to its source folder
  name: z.string().regex(/^[\w][\w.-]{0,120}$/, 'a file name: letters, digits, . _ -'),
  fps: z.number(),
  end: z.number(),
  video: z.string(),
  cuts: z.array(z.tuple([z.number(), z.number()])),
  captions: z.array(z.object({ start: z.number(), end: z.number().optional(), text: z.string() }).passthrough()),
  marks: z.array(z.object({ start: z.number(), title: z.string() })),
  narrations: z.array(z.object({ at: z.number(), file: z.string(), text: z.string().optional(), said: z.string().optional(), voice: z.string().nullish() }).passthrough()),
  effects: z.array(z.object({ at: z.number(), file: z.string(), volume: z.number().optional(), kind: z.string().optional() })),
  blurs: z.array(blur).optional(),
  // Everything that reaches ffmpeg's filters is a number or a file inside the folder
  music: z.object({ file: z.string(), volume: z.number().finite().min(0).max(1).optional(), duck: z.boolean().optional(),
    fadeIn: seconds.optional(), fadeOut: seconds.optional() }).strict().nullish(),
  frame: z.object({ background: z.string(), mask: z.string(), x: z.number().int().min(0), y: z.number().int().min(0),
    width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullish(),
  quality: z.string().nullish(),
  polish: z.string().nullish(),
}).passthrough()

/** The source folder of a video: the folder given, its `<name>.source` inside, or the one next to an .mp4 */
export const findSource = path => {
  const full = resolve(path)
  if (existsSync(join(full, TIMELINE))) return full
  if (full.endsWith('.mp4') && existsSync(join(`${full.slice(0, -4)}.source`, TIMELINE))) return `${full.slice(0, -4)}.source`
  if (existsSync(full) && statSync(full).isDirectory()) {
    const inside = readdirSync(full).filter(f => f.endsWith('.source') && existsSync(join(full, f, TIMELINE)))
    if (inside.length === 1) return join(full, inside[0])
    if (inside.length > 1) throw new UserError(`${path} has several videos kept: ${inside.join(', ')}. Name one of them`)
  }
  throw new UserError(`${path}: no ${TIMELINE} there. Render with --keep first (tourwright render <script> --keep)`)
}

/**
 * Makes the video again from its source, with what changed.
 * @param {string} path   the video folder, its .mp4 or its .source folder
 * @param {{ voice?: string, polish?: string, clicks?: boolean, out?: string, quality?: string }} [opts]
 * @returns the manifest, like render()
 */
export const recompose = async (path, opts = {}, config = loadConfig()) => {
  const folder = findSource(path)
  const parsed = timelineSchema.safeParse(JSON.parse(readFileSync(join(folder, TIMELINE), 'utf8')))
  if (!parsed.success) throw new UserError(`${join(folder, TIMELINE)}: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  const t = /** @type {Record<string, any>} */ (parsed.data)
  // Every file it names stays inside the folder: a timeline is data, not a way to read the disk
  const real = realpathSync(folder)
  const inFolder = file => {
    const full = resolve(folder, file)
    if (isAbsolute(file) || !isInside(full, folder)) throw new UserError(`${TIMELINE}: ${file} is outside ${folder}`)
    if (!existsSync(full)) throw new UserError(`${TIMELINE}: ${file} is missing`)
    // Nor through a link that points elsewhere
    if (!isInside(realpathSync(full), real)) throw new UserError(`${TIMELINE}: ${file} is outside ${folder}`)
    return full
  }
  if (t.polish && !Object.hasOwn(POLISH_PRESETS, t.polish)) throw new UserError(`${TIMELINE}: polish ${t.polish}: use ${Object.keys(POLISH_PRESETS).join(', ')}`)
  if (opts.voice) parseVoice(opts.voice, config, t.speech?.aliases)
  if (opts.polish && !Object.hasOwn(POLISH_PRESETS, opts.polish)) throw new UserError(`--polish ${opts.polish}: use ${Object.keys(POLISH_PRESETS).join(', ')}`)
  const base = config.tmpDir ?? tmpdir()
  mkdirSync(base, { recursive: true })
  const workDir = mkdtempSync(join(base, 'tourwright-recompose-'))
  try {
    // A sentence whose text changed, or every one with another voice, is said again
    let said = 0
    const narrations = []
    for (const n of t.narrations) {
      const text = n.text ?? n.said
      const voice = opts.voice ?? n.voice ?? t.voice
      if (text && voice && (opts.voice || text !== n.said)) {
        const made = await narrate(text, voice, config, t.speech ?? {})
        narrations.push({ ...n, file: made.file, duration: made.duration, text })
        said++
      } else narrations.push({ ...n, file: inFolder(n.file) })
    }
    if (said) log.info(`${said} sentence${said > 1 ? 's' : ''} said again`)
    // Sentences said again may last longer: one that runs into the next is reported
    const sorted = [...narrations].sort((a, b) => a.at - b.at)
    for (const [i, n] of sorted.entries()) {
      const next = sorted[i + 1]
      if (next && n.duration && n.at + n.duration > next.at + 0.05) log.warn(`step ${n.step ?? '?'}: "${n.text}" now runs ${(n.at + n.duration - next.at).toFixed(1)} s into the next sentence`)
    }
    const clicks = opts.clicks ?? true
    const effects = t.effects
      .filter(e => clicks || !['click', 'typing'].includes(e.kind))
      .map(e => ({ ...e, file: inFolder(e.file) }))
    const out = opts.out ? (opts.out.endsWith('.mp4') ? resolve(opts.out).slice(0, -4) : join(resolve(opts.out), t.name)) : join(dirname(folder), t.name)
    mkdirSync(dirname(out), { recursive: true })
    const result = await compose({
      video: inFolder(t.video),
      fps: t.fps,
      end: t.end,
      cuts: t.cuts,
      narrations,
      effects,
      captions: t.captions,
      marks: t.marks,
      music: t.music ? { ...t.music, file: inFolder(t.music.file) } : null,
      polish: opts.polish ?? t.polish ?? undefined,
      out,
      sidecar: join(dirname(out), 'captions'),
      title: t.title,
      language: t.language ?? undefined,
      quality: qualityOf(opts.quality ?? t.quality ?? config.render.quality),
      workDir,
      voice: opts.voice ?? t.voice,
      frame: t.frame ? { ...t.frame, background: inFolder(t.frame.background), mask: inFolder(t.frame.mask) } : null,
      blurs: t.blurs ?? [],
    }, config)
    const [seen, heard] = await Promise.all([
      reviewVideo(result.paths.video, config, { narrated: narrations.length > 0 }),
      reviewAudio(result.paths.video, config, result.spoken),
    ])
    const review = [...seen, ...heard]
    reportFindings(review)
    writeFileSync(result.paths.manifest, JSON.stringify({ ...JSON.parse(readFileSync(result.paths.manifest, 'utf8')), review }, null, 2))
    const { spoken, ...delivered } = result
    return { ...delivered, review }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
