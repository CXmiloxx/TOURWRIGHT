// How the browser is filmed. Three strategies, from best to most portable:
//
//   screen      Chromium on a private virtual display (Xvfb) recorded by ffmpeg at a constant frame rate:
//               sharp and smooth, exactly what a viewer would see. Needs Xvfb.
//   screencast  Headless Chromium streams its frames over CDP; Tourwright repeats the last frame at a fixed
//               rate into ffmpeg. Runs anywhere Chromium runs (containers, ARM, no X server).
//   playwright  Playwright's built-in recorder (VP8, lower quality). Last resort.
//
// `auto` picks screen when Xvfb exists, screencast otherwise.
import { spawn } from 'node:child_process'
import { loadConfig } from '../config.js'

// Window chrome (tabs, address bar) sits above the content and is left out of the recording: the virtual
// display is taller than the video and ffmpeg grabs only the content area.
export const CHROME_MAX = 300

export const pickCapture = (requested, config = loadConfig()) => {
  if (requested && requested !== 'auto') {
    if (requested === 'screen' && !config.xvfb) throw new Error('capture "screen" needs Xvfb (apt install xvfb) — try --capture=screencast')
    return requested
  }
  return config.xvfb ? 'screen' : 'screencast'
}

// A free virtual display chosen by Xvfb itself (-displayfd): many renders can run side by side.
export const openDisplay = (width, height, config = loadConfig()) =>
  new Promise((resolve, reject) => {
    const proc = spawn(config.xvfb, ['-displayfd', '3', '-screen', '0', `${width}x${height + CHROME_MAX}x24`, '-nolisten', 'tcp', '-ac'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('Xvfb did not start in 10 s'))
    }, 10_000)
    proc.stdio[3].on('data', chunk => {
      out += chunk
      const m = /^(\d+)\s*$/m.exec(out)
      if (m) {
        clearTimeout(timer)
        resolve({ display: `:${m[1]}`, close: () => proc.kill('SIGTERM') })
      }
    })
    proc.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`Xvfb exited with ${code}`))
    })
  })

const encoderArgs = config => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-threads', String(config.threads), '-pix_fmt', 'yuv420p']

// Records the virtual display without the system pointer (the overlay draws its own). Resolves once ffmpeg
// is capturing: that is second 0 of the recording.
export const recordScreen = ({ display, width, height, offsetY, fps, file }, config = loadConfig()) =>
  new Promise((resolve, reject) => {
    const p = spawn(config.ffmpeg, ['-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(fps), '-video_size', `${width}x${height}`,
      '-i', `${display}+0,${offsetY}`, ...encoderArgs(config), file], { stdio: ['pipe', 'ignore', 'pipe'] })
    let ready = false
    let stderr = ''
    p.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-2000)
      if (!ready && /Press \[q\]|frame=/.test(String(chunk))) {
        ready = true
        resolve({ startedAt: Date.now(), stop: () => stopFfmpeg(p), kill: () => p.kill('SIGKILL') })
      }
    })
    p.on('exit', code => !ready && reject(new Error(`ffmpeg could not record the screen (${code}): ${stderr.trim()}`)))
  })

const stopFfmpeg = proc =>
  new Promise(resolve => {
    if (proc.exitCode !== null) return resolve(undefined)
    proc.on('exit', () => resolve(undefined))
    proc.stdin.end('q')
  })

// CDP screencast → constant-rate video. Chromium only sends a frame when something changes; the last
// frame is written again on every tick so the video keeps wall-clock time.
export const recordScreencast = async ({ page, context, width, height, fps, file }, config = loadConfig()) => {
  const cdp = await context.newCDPSession(page)
  const ff = spawn(config.ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p`, ...encoderArgs(config), file], { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  ff.stderr.on('data', c => (stderr = (stderr + c).slice(-2000)))
  ff.stdin.on('error', () => {})
  let last = null
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    last = Buffer.from(data, 'base64')
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
  // First frame before the clock starts
  for (let i = 0; i < 50 && !last; i++) await new Promise(r => setTimeout(r, 50))
  const start = Date.now()
  let written = 0
  const tick = setInterval(() => {
    if (!last) return
    const due = Math.floor(((Date.now() - start) / 1000) * fps)
    while (written < due) {
      ff.stdin.write(last)
      written++
    }
  }, 1000 / fps / 2)
  return {
    startedAt: start,
    stop: async () => {
      clearInterval(tick)
      await cdp.send('Page.stopScreencast').catch(() => {})
      await new Promise((resolve, reject) => {
        ff.on('exit', code => (code === 0 ? resolve(undefined) : reject(new Error(`ffmpeg screencast failed (${code}): ${stderr.trim()}`))))
        ff.stdin.end()
      })
    },
    kill: () => {
      clearInterval(tick)
      ff.kill('SIGKILL')
    },
  }
}
