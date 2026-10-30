// From a raw recording (or a slideshow) to the deliverables: an mp4 any player opens, with narration,
// optional background music ducked under the voice, soft subtitles and chapters; plus .srt, .vtt,
// a thumbnail and a JSON manifest that agents can read.
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadConfig } from './config.js'
import { chaptersFrom, cutFilter, normalizeCuts, toFfmetadata, toOutput, toSrt, toVtt } from './timeline.js'
import { polishFilter } from './voice/index.js'

export const QUALITIES = {
  sd: { width: 854, height: 480, crf: '26', preset: 'medium' },
  hd: { width: 1280, height: 720, crf: '23', preset: 'medium' },
  fullhd: { width: 1920, height: 1080, crf: '20', preset: 'medium' },
  // Vertical, for phones and short-form platforms
  vertical: { width: 1080, height: 1920, crf: '21', preset: 'medium' },
  square: { width: 1080, height: 1080, crf: '21', preset: 'medium' },
}

export const ffmpeg = (args, config = loadConfig()) =>
  new Promise((resolve, reject) => {
    if (!config.ffmpeg) return reject(new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)'))
    const child = spawn(config.ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', c => (stderr = (stderr + c).slice(-4000)))
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve(undefined) : reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))))
  })

const LANGUAGES = { es: 'spa', en: 'eng', pt: 'por', fr: 'fra', de: 'deu', it: 'ita' }

/**
 * @param {object} p
 * @param {string} p.video        raw video file
 * @param {number} p.fps
 * @param {number} p.end          recording second where the video ends
 * @param {Array}  p.cuts         [[from, to]] recording seconds to drop
 * @param {Array}  p.narrations   [{ at, file }] recording seconds
 * @param {Array}  [p.effects]    [{ at, file, volume? }] recording seconds: sound effects, not ducked or polished
 * @param {Array}  p.captions     [{ start, end, text }] recording seconds
 * @param {Array}  p.marks        [{ start, title }] recording seconds (chapters)
 * @param {Record<string, any>} [p.music] { file, volume = 0.15, duck = true, fadeIn = 0, fadeOut = 2 }
 * @param {string} [p.polish]     narration sound preset (default, clean, warm, radio, podcast, none)
 * @param {string} p.out          output path without extension
 * @param {string} p.title
 * @param {string} [p.voice]      voice spec, for the manifest
 * @param {string} [p.language]   'es', 'en'…
 * @param {Record<string, any>} p.quality { crf, preset }
 * @param {string} p.workDir
 */
export const compose = async (p, config = loadConfig()) => {
  const cuts = normalizeCuts(p.cuts ?? [])
  const at = t => toOutput(t, cuts)
  const total = at(p.end)
  const captions = (p.captions ?? []).map(c => ({ text: c.text, start: at(c.start), end: at(c.end ?? p.end) })).filter(c => c.end > c.start)
  const chapters = chaptersFrom((p.marks ?? []).map(m => ({ title: m.title, start: at(m.start) })), total).filter(c => c.end > c.start)

  const files = { video: `${p.out}.mp4`, srt: `${p.out}.srt`, vtt: `${p.out}.vtt`, thumbnail: `${p.out}.jpg`, manifest: `${p.out}.json` }
  writeFileSync(files.srt, toSrt(captions))
  writeFileSync(files.vtt, toVtt(captions))
  const metaFile = join(p.workDir, 'chapters.txt')
  writeFileSync(metaFile, toFfmetadata(p.title, chapters))

  const inputs = ['-i', p.video]
  const filters = [`[0:v]${cutFilter(cuts, p.fps)}[vout]`]
  const maps = ['-map', '[vout]']
  let next = 1
  // Three buses mixed at the end: the voice, the music (ducked under the voice) and sound effects
  const buses = []
  const voices = (p.narrations ?? []).filter(n => existsSync(n.file))
  let voiceBus = null
  if (voices.length) {
    voices.forEach((n, i) => {
      inputs.push('-i', n.file)
      filters.push(`[${next++}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(at(n.at) * 1000)}:all=1[a${i}]`)
    })
    const polish = polishFilter(config, p.polish)
    filters.push(`${voices.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voices.length}:normalize=0:duration=longest${polish ? `,${polish}` : ''},aresample=48000,apad[voice]`)
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
  const effects = (p.effects ?? []).filter(e => existsSync(e.file))
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
    filters.push(`${buses.join('')}amix=inputs=${buses.length}:normalize=0:duration=first[aout]`)
    audio = '[aout]'
  }
  // 48 kHz, what every player expects: loudnorm (in the polish) works at 192 kHz and would leave 96 kHz AAC
  if (audio) maps.push('-map', audio, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000')
  const metaIndex = next++
  inputs.push('-i', metaFile)
  maps.push('-map_metadata', String(metaIndex), '-map_chapters', String(metaIndex))
  if (captions.length) {
    inputs.push('-i', files.srt)
    maps.push('-map', `${next++}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', `language=${LANGUAGES[p.language] ?? 'und'}`)
  }
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
  return { ...manifest, paths: files }
}
