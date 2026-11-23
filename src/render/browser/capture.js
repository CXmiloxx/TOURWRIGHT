// How the browser is filmed. Three strategies, from best to most portable:
//
//   screen      Chromium on a private virtual display (Xvfb) recorded by ffmpeg at a constant frame rate:
//               sharp and smooth, exactly what a viewer would see. Needs Xvfb.
//   screencast  Headless Chromium streams its frames over CDP; Tourwright repeats the last frame at a fixed
//               rate into ffmpeg. Runs anywhere Chromium runs (containers, ARM, no X server).
//   playwright  Playwright's built-in recorder (VP8, lower quality). Last resort.
//
// `auto` picks screen when Xvfb exists, screencast otherwise. A page drawn bigger than 1x (a vertical video, or
// `scale`) is always a screencast: the virtual display draws at 1x, so a phone-sized video would show the app's
// desktop layout, tiny in the middle of the screen.
import { spawn } from 'node:child_process'
import { loadConfig } from '#core/config.js'
import { log } from '#core/util.js'

// Window chrome (tabs, address bar) sits above the content and is left out of the recording: the virtual
// display is taller than the video and ffmpeg grabs only the content area.
export const CHROME_MAX = 300

/** @param {string | undefined} requested @param {ReturnType<typeof loadConfig>} [config] @param {{ portrait?: boolean }} [video] */
export const pickCapture = (requested, config = loadConfig(), video = {}) => {
  if (requested && requested !== 'auto') {
    if (requested === 'screen' && !config.xvfb) throw new Error('capture "screen" needs Xvfb (apt install xvfb) — try --capture=screencast')
    return requested
  }
  return config.xvfb && !video.portrait ? 'screen' : 'screencast'
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

// CDP screencast → constant-rate video. Chromium only sends a frame when something changes; the last frame is
// written again on every tick so the video keeps wall-clock time. Each frame goes where Chromium drew it (its
// timestamp), not where it arrived: a busy browser (an animated title card, a big page) delivers frames late, and
// placed on arrival they would run behind the voice. Ticks are written LATE seconds behind, so a late frame still
// finds its place.
const LATE = 0.8

/** A timestamp from the future or from long ago is not trusted: the arrival time is used instead.
 * @param {any} metadata @param {number} [now] */
export const drawnAt = (metadata, now = Date.now() / 1000) =>
  metadata?.timestamp && metadata.timestamp <= now + 0.05 && now - metadata.timestamp < 5 ? metadata.timestamp : now

/**
 * Puts frames drawn at a known time into a constant-rate stream, even when they arrive late. A tick writes the
 * last frame drawn by then; ticks run LATE seconds behind the wall clock so a late frame still finds its place.
 * @param {{ fps: number, write: (data: Buffer) => void }} options
 */
export const frameWriter = ({ fps, write }) => {
  /** @type {{ at: number, data: Buffer }[]} */
  const pending = []
  let shownAt = -Infinity
  /** @type {Buffer | null} */
  let shown = null
  let written = 0
  return {
    /** @param {number} at @param {Buffer} data */
    add: (at, data) => { pending.push({ at, data }) },
    // Every frame received before the recording clock starts belongs to the first tick
    rewind: () => { for (const f of pending) f.at = -1 },
    /** @param {number} until last second, since the start, that is ready to be written */
    until: until => {
      const due = Math.floor(until * fps)
      while (written < due) {
        const t = written / fps
        pending.sort((a, b) => a.at - b.at)
        while (pending.length && pending[0].at <= t) {
          const frame = /** @type {{ at: number, data: Buffer }} */ (pending.shift())
          // A frame that arrives out of order must not put an older picture back on screen
          if (frame.at >= shownAt) {
            shown = frame.data
            shownAt = frame.at
          }
        }
        // No frame drawn by this tick yet (none came before the clock started): the first one to come fills it,
        // so the video keeps the clock's length; with nothing at all, the tick waits for one
        if (!shown && pending.length) {
          const first = pending[0]
          shown = first.data
          shownAt = -Infinity
        }
        if (!shown) return
        write(shown)
        written++
      }
    },
  }
}

export const recordScreencast = async ({ page, context, width, height, fps, file }, config = loadConfig()) => {
  const cdp = await context.newCDPSession(page)
  const ff = spawn(config.ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p`, ...encoderArgs(config), file], { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  ff.stderr.on('data', c => (stderr = (stderr + c).slice(-2000)))
  ff.stdin.on('error', () => {})
  const writer = frameWriter({ fps, write: data => ff.stdin.write(data) })
  let start = 0
  let latest = 0
  let received = false
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const now = Date.now() / 1000
    const drawn = drawnAt(metadata, now)
    received = true
    latest = Math.max(latest, now - drawn)
    writer.add(drawn - start / 1000, Buffer.from(data, 'base64'))
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
  // First frame before the clock starts
  for (let i = 0; i < 50 && !received; i++) await new Promise(r => setTimeout(r, 50))
  start = Date.now()
  writer.rewind()
  const tick = setInterval(() => writer.until((Date.now() - start) / 1000 - LATE), 1000 / fps / 2)
  return {
    startedAt: start,
    stop: async () => {
      clearInterval(tick)
      await cdp.send('Page.stopScreencast').catch(() => {})
      writer.until((Date.now() - start) / 1000)
      if (latest > 0.25) log.debug(`screencast: frames arrived up to ${latest.toFixed(2)} s after they were drawn; each was put where it was drawn`)
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
