// Running ffmpeg: quiet when it works, its last words when it does not, and its report when one is needed.
import { spawn } from 'node:child_process'
import { loadConfig } from '#core/config.js'

export const ffmpeg = (args, config = loadConfig()) =>
  new Promise((resolve, reject) => {
    if (!config.ffmpeg) return reject(new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)'))
    const child = spawn(config.ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', c => (stderr = (stderr + c).slice(-4000)))
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve(undefined) : reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))))
  })

/**
 * A color for an ffmpeg filter option: #RGB, #RRGGBB or #RRGGBBAA, or a plain color name. Anything else (text from a
 * script that could close the option and add filters of its own, like `movie=` reading a file) becomes `fallback`.
 */
export const ffmpegColor = (value, fallback = 'black') => {
  const text = String(value ?? '').trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)?.[1]
  if (hex) return `0x${hex.length === 3 ? [...hex].map(c => c + c).join('') : hex}`
  return /^[a-z]{3,24}$/i.test(text) ? text : fallback
}

// ffmpeg's report on stderr (loudnorm's measure is printed at info level)
export const ffmpegReport = (args, config) =>
  new Promise((resolve, reject) => {
    if (!config.ffmpeg) return reject(new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)'))
    const child = spawn(config.ffmpeg, ['-hide_banner', '-nostats', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', c => (stderr = (stderr + c).slice(-8000)))
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg failed (${code}): ${stderr.trim().slice(-600)}`))))
  })
