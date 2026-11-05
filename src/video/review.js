// A look at the finished video before anyone else sees it: a blank or black screen for more than a second, a
// long stretch with nothing to hear, a sentence much quieter or louder than the rest, a peak that distorts.
// Each finding names its step when it has one; none of them stops the render. The page side is render/page/review.js.
import { LOUDNESS } from '#voice/index.js'
import { log, run } from '#core/util.js'

/**
 * @typedef {{ kind: 'page-error' | 'http' | 'no-effect' | 'blank' | 'silence' | 'caption' | 'layout' | 'loudness' | 'clipping' | 'privacy' | 'ambiguous' | 'skipped', message: string, step?: number, at?: number }} Finding
 */


const SPANS = /black_start:([\d.]+)\s+black_end:([\d.]+)/g

/**
 * Blank (white) and black screens of a second or more in the finished video and, when it is narrated, long
 * stretches with nothing to hear.
 * @param {string} file @param {{ ffmpeg?: string }} config @param {{ narrated?: boolean }} [opts]
 * @returns {Promise<Finding[]>}
 */
export const reviewVideo = async (file, config, { narrated = true } = {}) => {
  if (!config.ffmpeg) return []
  // Nearly every pixel near pure black, or near pure white once the picture is inverted. A small grey picture
  // at 10 fps says the same, and both passes run at once
  const look = [['black', 'blackdetect=d=1:pix_th=0.03:pic_th=0.995'], ['blank (white)', 'negate,blackdetect=d=1:pix_th=0.03:pic_th=0.995']]
  const found = await Promise.all(look.map(async ([what, filter]) => {
    // blackdetect reports at the info level, on stderr
    const { stderr } = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `fps=10,scale=320:-2,format=gray,${filter}`, '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 })
      .catch(error => ({ stderr: String(error.stderr ?? '') }))
    return [...String(stderr ?? '').matchAll(SPANS)].map(m => {
      const [start, end] = [Number(m[1]), Number(m[2])]
      return /** @type {Finding} */ ({ kind: 'blank', at: start, message: `the screen is ${what} from ${start.toFixed(1)} s to ${end.toFixed(1)} s` })
    })
  }))
  return [...found.flat(), ...(narrated ? await silences(file, config) : [])]
}

const QUIET = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g

/**
 * Long stretches with nothing to hear: no voice, no sound, no music. A pause to read a note or watch a field
 * fill takes 3–5 s; 6 s of nothing feels like the video stopped (a slow page or a long search filmed whole).
 * @returns {Promise<Finding[]>}
 */
export const silences = async (file, config, seconds = 6) => {
  const { stderr } = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=n=-45dB:d=${seconds}`, '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 })
    .catch(error => ({ stderr: String(error.stderr ?? '') }))
  // A video with no sound at all has no audio stream: nothing to say about it
  const out = String(stderr ?? '')
  if (!/Audio:/.test(out)) return []
  // A quiet opening or closing card (the title, the logo at the end) is on purpose
  const [, h = '0', min = '0', sec = '0'] = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(out) ?? []
  const duration = Number(h) * 3600 + Number(min) * 60 + Number(sec)
  return [...out.matchAll(QUIET)].flatMap(m => {
    const [start, end] = [Number(m[1]), Number(m[2])]
    if (start < 0.3 || (duration && end > duration - 0.3)) return []
    return /** @type {Finding} */ ({ kind: 'silence', at: start, message: `nothing is heard from ${start.toFixed(1)} s to ${end.toFixed(1)} s (a slow page or search filmed whole? a long \`ms\`?)` })
  })
}

const FRAME = /t:\s*([\d.]+)\s.*?M:\s*(-?[\d.]+|-inf)\s.*?FTPK:\s*(-?[\d.]+|-inf)\s+(-?[\d.]+|-inf)?/

/**
 * The loudness of the video every 100 ms (momentary loudness of the last 400 ms) and its true peaks, in one pass.
 * @returns {Promise<{ t: number, m: number, peak: number }[] | null>} null without an audio track
 */
export const audioFrames = async (file, config) => {
  const { stderr } = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true:framelog=info', '-f', 'null', '-'], { maxBuffer: 256 * 1024 * 1024 })
    .catch(error => ({ stderr: String(error.stderr ?? '') }))
  const out = String(stderr ?? '')
  if (!/Audio:/.test(out)) return null
  const value = v => (v === undefined || v === '-inf' ? -Infinity : Number(v))
  const frames = []
  for (const line of out.split('\n')) {
    const m = FRAME.exec(line)
    if (m) frames.push({ t: Number(m[1]), m: value(m[2]), peak: Math.max(value(m[3]), value(m[4])) })
  }
  return frames
}

/**
 * Integrated loudness (EBU R128, gated) of the stretch [start, end] from the momentary loudness of its 400 ms blocks
 * @param {{ t: number, m: number }[]} frames
 */
export const integrated = (frames, start, end) => {
  const blocks = frames.filter(f => f.t - 0.2 >= start && f.t - 0.2 <= end && f.m > -70).map(f => f.m)
  if (!blocks.length) return null
  const mean = list => 10 * Math.log10(list.reduce((s, m) => s + 10 ** (m / 10), 0) / list.length)
  const gate = mean(blocks) - 10
  const kept = blocks.filter(m => m > gate)
  return kept.length ? mean(kept) : null
}

// A sentence this far from the others (in LU) is heard as a jump; a peak over this distorts on some players
const LOUDNESS_SPREAD = 4
const CLIPPING = -1

/**
 * What the finished video sounds like: each sentence near the loudness of the narration, no peak that distorts.
 * @param {string} file
 * @param {{ ffmpeg?: string }} config
 * @param {{ start: number, end: number, step?: number, text?: string, lufs?: number | null }[]} [spoken] where each sentence is heard
 * @returns {Promise<Finding[]>}
 */
export const reviewAudio = async (file, config, spoken = []) => {
  if (!config.ffmpeg) return []
  const frames = await audioFrames(file, config)
  if (!frames?.length) return []
  /** @type {Finding[]} */
  const findings = []
  const measured = spoken.filter(s => s.end - s.start >= 0.5).map(s => ({ ...s, heard: integrated(frames, s.start, s.end) })).filter(s => s.heard !== null)
  // Leveled sentences aim at the target; with `polish: none` they are compared with the narration's own median
  const leveled = spoken.some(s => typeof s.lufs === 'number')
  const levels = measured.map(s => s.heard).sort((a, b) => a - b)
  const reference = leveled || !levels.length ? LOUDNESS.I : levels[Math.floor(levels.length / 2)]
  for (const s of measured) {
    const lufs = s.heard
    const off = lufs - reference
    if (Math.abs(off) <= LOUDNESS_SPREAD) continue
    const words = s.text ? ` "${s.text.length > 60 ? `${s.text.slice(0, 57)}…` : s.text}"` : ''
    findings.push({ kind: 'loudness', step: s.step, at: Number(s.start.toFixed(2)),
      message: `the sentence${words} at ${s.start.toFixed(1)} s is ${Math.abs(off).toFixed(1)} LU ${off < 0 ? 'quieter' : 'louder'} than the narration (${lufs.toFixed(1)} LUFS, ${leveled ? 'target' : 'the others'} ${reference.toFixed(1)})` })
  }
  // Peaks over the limit, one finding per second where they happen (at most 5)
  const seconds = []
  for (const f of frames) {
    if (f.peak <= CLIPPING) continue
    const last = seconds.at(-1)
    if (last && f.t - last.end <= 1) {
      last.end = f.t
      last.peak = Math.max(last.peak, f.peak)
    } else seconds.push({ start: f.t, end: f.t, peak: f.peak })
  }
  for (const c of seconds.slice(0, 5)) {
    findings.push({ kind: 'clipping', at: Number(c.start.toFixed(2)),
      message: `the sound peaks at ${c.peak > 0 ? '+' : ''}${c.peak.toFixed(1)} dBFS at ${c.start.toFixed(1)} s (over ${CLIPPING} dBFS distorts: many clicks at once, loud music or a sound file)` })
  }
  if (seconds.length > 5) findings.push({ kind: 'clipping', message: `…and ${seconds.length - 5} more moments over ${CLIPPING} dBFS` })
  return findings
}

/** Says each finding once, with its step */
export const reportFindings = findings => {
  for (const f of findings) log.warn(`review: ${f.step ? `step ${f.step}: ` : ''}${f.message}`)
}
