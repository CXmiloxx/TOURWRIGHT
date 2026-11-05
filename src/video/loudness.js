// How loud a sound is (EBU R128) and each sentence of narration brought to the same loudness, with a true-peak
// limiter where a peak needs it. Leveled sentences are cached.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadConfig } from '#core/config.js'
import { LOUDNESS } from '#voice/index.js'
import { hash } from '#core/util.js'
import { ffmpeg, ffmpegReport } from './ffmpeg.js'

/**
 * Integrated loudness (LUFS) and true peak (dBFS) of a file, after an optional filter (EBU R128).
 * @returns {Promise<{ i: number | null, tp: number | null }>}
 */
export const loudnessOf = async (file, config = loadConfig(), filter = null) => {
  const report = await ffmpegReport(['-i', file, '-vn', '-af', [filter, 'ebur128=peak=true:framelog=verbose'].filter(Boolean).join(','), '-f', 'null', '-'], config)
  const summary = report.slice(report.lastIndexOf('Summary:'))
  const number = re => {
    const n = Number(re.exec(summary)?.[1])
    return Number.isFinite(n) ? n : null
  }
  const i = number(/I:\s+(-?[\d.]+)\s+LUFS/)
  return { i: i !== null && i > -70 ? i : null, tp: number(/Peak:\s+(-?[\d.]+)\s+dBFS/) }
}

// A peak limiter that also catches the peaks between samples (true peak): it works at 4x the rate. Its ceiling
// sits half a decibel under the target, the margin the AAC encoder needs.
export const peakLimiter = (tp = LOUDNESS.TP) =>
  `aresample=192000,alimiter=limit=${(10 ** ((tp - 0.5) / 20)).toFixed(4)}:attack=1:release=60:level=false,aresample=48000`

// Bumped whenever the way a sentence is leveled changes: the leveled sentences cached before are made again
const LEVEL_VERSION = 2

/**
 * One sentence of narration with its tone and at the target loudness, the way a sound engineer levels each take:
 * measured, a linear gain, a true-peak limiter only where the gain would push a peak over, and measured again until
 * it lands within half a decibel. loudnorm is not used: to keep its peaks it gives up the gain without saying so,
 * and a short sentence with one sharp consonant came out 5 to 15 dB quieter than the others. A sentence too
 * quiet to measure keeps the tone and a one-pass level.
 * Leveled sentences are cached: the same sentence with the same sound is leveled once per machine.
 * @returns {Promise<{ file: string, lufs: number | null, tp: number | null }>}
 */
export const levelClip = async (file, out, tone, config = loadConfig()) => {
  const format = ['aresample=48000', 'aformat=channel_layouts=stereo']
  const write = filters => ffmpeg(['-i', file, '-af', [tone, ...filters, ...format].filter(Boolean).join(','), '-c:a', 'pcm_s16le', out], config)
  let key = null
  try {
    const s = statSync(file)
    key = join(config.cacheDir, 'voice', 'leveled', `${hash(`${LEVEL_VERSION}|${file}|${s.size}|${s.mtimeMs}|${tone}|${LOUDNESS.I}|${LOUDNESS.TP}`)}`)
    if (existsSync(`${key}.wav`) && existsSync(`${key}.json`)) {
      copyFileSync(`${key}.wav`, out)
      return { ...JSON.parse(readFileSync(`${key}.json`, 'utf8')), file: out }
    }
  } catch {
    key = null
  }
  const before = await loudnessOf(file, config, tone).catch(() => null)
  let result
  if (before?.i === null || before?.i === undefined) {
    await write([`loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`])
    result = { file: out, lufs: null, tp: null }
  } else {
    let gain = LOUDNESS.I - before.i
    let after = before
    // The limiter takes a little loudness from a peaky sentence: the gain is corrected and it is made again
    for (let pass = 0; pass < 3; pass++) {
      const limit = (before.tp ?? 0) + gain > LOUDNESS.TP - 0.5
      await write([`volume=${gain.toFixed(2)}dB`, ...(limit ? [peakLimiter()] : [])])
      after = await loudnessOf(out, config).catch(() => ({ i: null, tp: null }))
      if (after.i === null || Math.abs(after.i - LOUDNESS.I) <= 0.5) break
      gain += LOUDNESS.I - after.i
    }
    result = { file: out, lufs: after.i, tp: after.tp }
  }
  if (key) {
    try {
      mkdirSync(dirname(key), { recursive: true })
      // Written aside and renamed: another render reading the same sentence never sees half a file
      const part = `${key}.${process.pid}.${Date.now()}`
      copyFileSync(out, `${part}.wav`)
      writeFileSync(`${part}.json`, JSON.stringify({ lufs: result.lufs, tp: result.tp }))
      renameSync(`${part}.wav`, `${key}.wav`)
      renameSync(`${part}.json`, `${key}.json`)
    } catch {
      // A cache that cannot be written only costs time
    }
  }
  return result
}
