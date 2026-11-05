// From a raw recording (or a slideshow) to the deliverables: an mp4 any player opens, with narration,
// optional background music ducked under the voice, and chapters; plus .srt, .vtt (the captions are drawn on it),
// a thumbnail and a JSON manifest that agents can read.
import { existsSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { loadConfig } from '#core/config.js'
import { chaptersFrom, cutFilter, normalizeCuts, toFfmetadata, toOutput, toSrt, toVtt } from './timeline.js'
import { frameFilter } from './frame-filter.js'
import { polishTone } from '#voice/index.js'
import { mapLimit } from '#core/util.js'
import { ffmpeg } from './ffmpeg.js'
import { levelClip, peakLimiter } from './loudness.js'

/**
 * Clicks and typing that fall inside a cut are dropped: off camera nothing was seen, and they would all land on
 * the cut at once. A sound the script asked for is kept (it plays where the video goes on).
 */
export const audibleEffects = (effects, cuts) =>
  effects.filter(e => !(['click', 'typing'].includes(e.kind) && cuts.some(([a, b]) => e.at >= a && e.at < b)))

const LANGUAGES = { es: 'spa', en: 'eng', pt: 'por', fr: 'fra', de: 'deu', it: 'ita' }

/**
 * @param {object} p
 * @param {string} p.video        raw video file
 * @param {number} p.fps
 * @param {number} p.end          recording second where the video ends
 * @param {Array}  p.cuts         [[from, to]] recording seconds to drop
 * @param {Array}  p.narrations   [{ at, file, duration?, step?, text? }] recording seconds
 * @param {Array}  [p.effects]    [{ at, file, volume?, kind? }] recording seconds: sound effects, not ducked or polished.
 *                                Those inside a cut are dropped
 * @param {Array}  p.captions     [{ start, end, text }] recording seconds
 * @param {Array}  p.marks        [{ start, title }] recording seconds (chapters)
 * @param {Record<string, any>} [p.music] { file, volume = 0.15, duck = true, fadeIn = 0, fadeOut = 2 }
 * @param {string} [p.polish]     narration sound preset (default, clean, warm, radio, podcast, none)
 * @param {string} p.out          output path without extension
 * @param {string} [p.sidecar]    path without extension of the .srt and .vtt (default: captions, next to the video).
 *                                Never the video's own name: players would load it over the captions on the video
 * @param {string} p.title
 * @param {string} [p.voice]      voice spec, for the manifest
 * @param {string} [p.language]   'es', 'en'…
 * @param {Record<string, any>} p.quality { crf, preset }
 * @param {string} p.workDir
 * @param {{ x: number, y: number, width: number, height: number, start?: number, end?: number }[]} [p.blurs]
 *                                boxes of the final video (its pixels) blurred, between two of its seconds
 * @param {{ background: string, mask: string, x: number, y: number, width: number, height: number } | null} [p.frame]
 *                                the studio frame (render/frame.js): the recording goes inside its window
 */
export const compose = async (p, config = loadConfig()) => {
  const cuts = normalizeCuts(p.cuts ?? [])
  const at = t => toOutput(t, cuts)
  const total = at(p.end)
  const captions = (p.captions ?? []).map(c => ({ text: c.text, start: at(c.start), end: at(c.end ?? p.end) })).filter(c => c.end > c.start)
  const chapters = chaptersFrom((p.marks ?? []).map(m => ({ title: m.title, start: at(m.start) })), total).filter(c => c.end > c.start)

  const sidecar = p.sidecar ?? join(dirname(p.out), 'captions')
  const files = { video: `${p.out}.mp4`, srt: `${sidecar}.srt`, vtt: `${sidecar}.vtt`, thumbnail: `${p.out}.jpg`, manifest: `${p.out}.json` }
  writeFileSync(files.srt, toSrt(captions))
  writeFileSync(files.vtt, toVtt(captions))
  const metaFile = join(p.workDir, 'chapters.txt')
  writeFileSync(metaFile, toFfmetadata(p.title, chapters))

  const inputs = ['-i', p.video]
  // `blurs` (tourwright recompose): boxes of the final video (its pixels, what is seen) blurred between two of its seconds
  const blurs = p.blurs ?? []
  const shown = blurs.length ? '[b0]' : '[vout]'
  const filters = [`[0:v]${cutFilter(cuts, p.fps)}${p.frame ? '[cut]' : shown}`]
  blurs.forEach((b, i) => {
    const [x, y, w, h] = [b.x, b.y, b.width, b.height].map(n => Math.max(0, Math.round(n)))
    // The box is cut to the video (a box past an edge blurs what is inside it), and the blur's radius follows
    // the size of each plane (the chroma planes are half the size)
    const when = b.start !== undefined || b.end !== undefined ? `:enable='between(t,${(b.start ?? 0).toFixed(2)},${(b.end ?? total).toFixed(2)})'` : ''
    const crop = `crop=w='max(4,min(${w},iw-${x}))':h='max(4,min(${h},ih-${y}))':x='min(${x},iw-4)':y='min(${y},ih-4)'`
    const blur = "boxblur=lr='max(0,min(20,min(w,h)/2-1))':lp=2:cr='max(0,min(10,min(cw,ch)/2-1))':cp=2"
    filters.push(`[b${i}]split[bm${i}][bs${i}];[bs${i}]${crop},${blur}[bb${i}];` +
      `[bm${i}][bb${i}]overlay=${x}:${y}${when}${i === blurs.length - 1 ? '[vout]' : `[b${i + 1}]`}`)
  })
  const maps = ['-map', '[vout]']
  let next = 1
  if (p.frame) {
    inputs.push('-loop', '1', '-framerate', String(p.fps), '-i', p.frame.background, '-loop', '1', '-i', p.frame.mask)
    filters.push(frameFilter(p.frame, next, next + 1).replace(/\[vout\]$/, shown))
    next += 2
  }
  // Three buses mixed at the end: the voice, the music (ducked under the voice) and sound effects
  const buses = []
  const voices = (p.narrations ?? []).filter(n => existsSync(n.file))
  // Where each sentence is heard in the video and how loud it came out, for the review
  const spoken = []
  let voiceBus = null
  if (voices.length) {
    // Each sentence gets its tone and is leveled on its own (a few at a time); `none` leaves them as the engine made them
    const preset = p.polish ?? config.tts.polish
    const tone = polishTone(config, p.polish)
    const leveled = !preset || preset !== 'none'
    const levels = leveled
      ? await mapLimit(voices, 4, (n, i) => levelClip(n.file, join(p.workDir, `voice-${i}.wav`), tone, config))
      : voices.map(n => ({ file: n.file, lufs: null, tp: null }))
    const files = levels.map(l => l.file)
    voices.forEach((n, i) => {
      const start = at(n.at)
      spoken.push({ start, end: start + (n.duration ?? 0), lufs: levels[i].lufs, step: n.step, text: n.text })
    })
    voices.forEach((n, i) => {
      inputs.push('-i', files[i])
      filters.push(`[${next++}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(at(n.at) * 1000)}:all=1[a${i}]`)
    })
    // The sentences are already level: only a limiter on the sum, for the rare overlap
    filters.push(`${voices.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voices.length}:normalize=0:duration=longest${leveled ? ',alimiter=limit=0.84:attack=5:release=50:level=false' : ''},aresample=48000,apad[voice]`)
    voiceBus = '[voice]'
  }
  if (p.music?.file) {
    inputs.push('-stream_loop', '-1', '-i', p.music.file)
    const volume = p.music.volume ?? 0.15
    const fadeIn = p.music.fadeIn ?? 0
    const fadeOut = Math.min(p.music.fadeOut ?? 2, total)
    filters.push(`[${next++}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${volume}${fadeIn ? `,afade=t=in:st=0:d=${fadeIn}` : ''}` +
      `${fadeOut ? `,afade=t=out:st=${Math.max(0, total - fadeOut).toFixed(2)}:d=${fadeOut}` : ''}[music]`)
    if (voiceBus && p.music.duck !== false) {
      // The music lowers itself while someone speaks
      filters.push('[voice]asplit=2[vk][vs]', '[music][vs]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=500[ducked]')
      voiceBus = '[vk]'
      buses.push('[ducked]')
    } else buses.push('[music]')
  }
  if (voiceBus) buses.unshift(voiceBus)
  const effects = audibleEffects((p.effects ?? []).filter(e => existsSync(e.file)), cuts)
  if (effects.length) {
    effects.forEach((e, i) => {
      inputs.push('-i', e.file)
      filters.push(`[${next++}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${e.volume ?? 1},adelay=${Math.round(at(e.at) * 1000)}:all=1[e${i}]`)
    })
    filters.push(`${effects.map((_, i) => `[e${i}]`).join('')}amix=inputs=${effects.length}:normalize=0:duration=longest,apad[sfx]`)
    buses.push('[sfx]')
  }
  let audio = buses.length === 1 ? buses[0] : null
  if (buses.length > 1) {
    // Every bus is endless (apad, looped music): -t cuts the mix at the end of the video
    filters.push(`${buses.join('')}amix=inputs=${buses.length}:normalize=0:duration=first[mix]`)
    audio = '[mix]'
  }
  if (audio) {
    // The last word on the peaks: voice, music and effects summed can go over what each bus kept under
    filters.push(`${audio}${peakLimiter()}[aout]`)
    audio = '[aout]'
  }
  // 48 kHz, what every player expects: loudnorm (in the polish) works at 192 kHz and would leave 96 kHz AAC
  if (audio) maps.push('-map', audio, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-metadata:s:a:0', `language=${LANGUAGES[p.language] ?? 'und'}`)
  const metaIndex = next++
  inputs.push('-i', metaFile)
  maps.push('-map_metadata', String(metaIndex), '-map_chapters', String(metaIndex))
  // No subtitle track inside the mp4: the captions are already drawn on the video, and players turn on the first
  // track of an mp4 by themselves (two captions on screen). The .srt and .vtt go next to it, for YouTube or a translation.
  await ffmpeg([...inputs, '-filter_complex', filters.join(';'), ...maps,
    '-r', String(p.fps), '-c:v', 'libx264', '-preset', config.preset ?? p.quality.preset, '-crf', p.quality.crf, '-threads', String(config.threads),
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-t', total.toFixed(3), '-movflags', '+faststart', files.video], config)

  const thumbAt = Math.min(Math.max(0, total - 0.1), (chapters[0]?.start ?? 0) + 1.2)
  await ffmpeg(['-ss', thumbAt.toFixed(2), '-i', files.video, '-frames:v', '1', '-q:v', '3', files.thumbnail], config).catch(() => {
    delete files.thumbnail
  })

  const manifest = {
    title: p.title,
    duration: Number(total.toFixed(3)),
    files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, basename(f)])),
    chapters: chapters.map(c => ({ ...c, start: Number(c.start.toFixed(3)), end: Number(c.end.toFixed(3)) })),
    captions: captions.map(c => ({ ...c, start: Number(c.start.toFixed(3)), end: Number(c.end.toFixed(3)) })),
    voice: p.voice ?? null,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(files.manifest, JSON.stringify(manifest, null, 2))
  return { ...manifest, paths: files, spoken }
}
