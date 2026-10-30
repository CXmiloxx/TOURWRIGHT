// Sound effects: a few built-in sounds synthesized by ffmpeg (no audio files to ship or license) and the
// keyboard sound of typing. Generated once into the cache, like the voice.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { hash, run, UserError } from '../util.js'

// ffmpeg `aevalsrc` expressions (t = seconds) and their length
const BUILT_IN = {
  click: { expr: '0.55*sin(2*PI*1500*t)*exp(-t*120)+0.35*(random(0)*2-1)*exp(-t*300)', seconds: 0.08 },
  pop: { expr: '0.6*sin(2*PI*(500+900*exp(-t*35))*t)*exp(-t*22)', seconds: 0.18 },
  ding: { expr: '0.45*sin(2*PI*1320*t)*exp(-t*3.5)+0.2*sin(2*PI*2640*t)*exp(-t*5)+0.1*sin(2*PI*3960*t)*exp(-t*8)', seconds: 1.4 },
  whoosh: { expr: '0.7*(random(0)*2-1)*sin(PI*t/0.55)^2', seconds: 0.55, filter: 'highpass=f=350,lowpass=f=2400' },
}

export const BUILT_IN_SOUNDS = Object.keys(BUILT_IN)

const generate = async (name, expr, seconds, filter, config) => {
  if (!config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')
  const dir = join(config.cacheDir, 'sounds')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}-${hash(`${expr}:${seconds}:${filter ?? ''}`)}.wav`)
  if (existsSync(file)) return file
  const tmp = `${file}.${process.pid}.tmp.wav`
  try {
    await run(config.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${seconds}`,
      ...(filter ? ['-af', filter] : []), '-ac', '1', '-f', 'wav', tmp])
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  return file
}

// A built-in sound by name (click, pop, ding, whoosh), or null when `name` is not one.
export const builtInSound = (name, config = loadConfig()) => {
  const s = BUILT_IN[name]
  return s ? generate(name, s.expr, s.seconds, s.filter, config) : null
}

// Keys pressed every `delay` ms, `count` times: one file for the whole word.
export const typingSound = (count, delay, config = loadConfig()) => {
  if (count < 1) throw new UserError('nothing to type')
  const period = Math.max(0.02, delay / 1000)
  const expr = `0.4*(random(0)*2-1)*exp(-mod(t,${period})*380)+0.25*sin(2*PI*(700+400*random(1))*t)*exp(-mod(t,${period})*260)`
  return generate('typing', expr, Math.min(600, count * period + 0.05).toFixed(3), 'highpass=f=200', config)
}
