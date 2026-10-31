// Narrated slideshows: title cards, images and HTML pages, each one on screen while its narration lasts.
// Slides are drawn by headless Chromium (no virtual display); a slideshow of only images also works
// without any browser, with ffmpeg alone.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compose, ffmpeg, QUALITIES } from '../compose.js'
import { loadConfig } from '../config.js'
import { concatEntry, escapeHtml, log, plainText, UserError } from '../util.js'
import { builtInSound } from '../voice/effects.js'
import { narrate, stripMarks, withProsody } from '../voice/index.js'
import { resolveTheme, safePath, themeCss, toDataUrl } from './theme.js'

// Clips and the crossfade are temporary (compose encodes the final video): fastest preset, low CRF
const INTERMEDIATE_PRESET = 'ultrafast'

// Seconds of screen before and after each narration
const LEAD = 0.5
const TAIL = 0.7
const DEFAULT_DURATION = 3

const slideHtml = (s, theme, { width, height, image }) => {
  const body = s.html
    ? `<div class="tw-html">${s.html}</div>`
    : image
      ? `<div class="tw-image" style="background-image:url('${image}')"></div>${s.title ? `<div class="tw-image-title">${escapeHtml(s.title)}</div>` : ''}`
      : `<div id="tw-title">${theme.logo ? `<img src="${theme.logo}">` : ''}<h1>${escapeHtml(s.title ?? '')}</h1>${s.subtitle ? `<p>${escapeHtml(s.subtitle)}</p>` : ''}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${themeCss(theme)}
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: var(--tw-gradient); color: var(--tw-text); font-family: var(--tw-font); }
    #tw-caption { animation: none; }
    #tw-title { position: absolute; }
    .tw-image { position: absolute; inset: 0; background: center / contain no-repeat, var(--tw-bg); }
    .tw-image-title { position: absolute; top: 4vh; left: 50%; transform: translateX(-50%); padding: .4em 1em; border-radius: 12px;
      background: color-mix(in srgb, var(--tw-bg) 85%, transparent); font: 700 min(3.2vw, 4.5vh)/1.2 var(--tw-font); }
    .tw-html { position: absolute; inset: 0; padding: 7vh 8vw; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center;
      font-size: min(3vw, 4.6vh); line-height: 1.5; }
    .tw-html h1 { font-size: 1.8em; } .tw-html li { margin: .35em 0; }
    .tw-html h1, .tw-html h2 { color: var(--tw-text); margin: 0 0 .5em; } .tw-html b, .tw-html strong, .tw-html em { color: var(--tw-accent); }
  </style></head><body>${body}${s.caption ? `<div id="tw-caption">${stripMarks(s.caption)}</div>` : ''}</body></html>`
}

// Slow camera movement over a still image (Ken Burns)
const motionFilter = (motion, frames, width, height, fps) => {
  const size = `${width}x${height}`
  switch (motion) {
    case 'zoom-in': return `zoompan=z='min(1+0.10*on/${frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${size}:fps=${fps}`
    case 'zoom-out': return `zoompan=z='max(1.10-0.10*on/${frames},1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${size}:fps=${fps}`
    case 'pan': return `zoompan=z=1.08:x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':d=1:s=${size}:fps=${fps}`
    default: return null
  }
}

/** @param {import('../script/load.js').Loaded & { kind: 'slides' }} loaded @param {any} opts */
export const renderSlides = async (loaded, opts, config = loadConfig()) => {
  const { name, dir, sandboxed, script } = loaded
  const progress = opts.onProgress ?? (() => {})
  const quality = QUALITIES[opts.quality ?? script.quality ?? 'hd']
  const width = opts.width ?? script.width ?? quality.width
  const height = opts.height ?? script.height ?? quality.height
  const fps = script.fps ?? 30
  const voiceSpec = opts.voice ?? script.voice ?? config.tts.defaultVoice
  const voice = opts.dryRun || voiceSpec === 'none' ? null : voiceSpec
  const theme = resolveTheme(script.theme, config.theme, dir, { sandboxed })
  const work = opts.workDir
  const fade = script.transition ?? 0.4
  const audio = script.audio ?? {}
  const speech = { aliases: script.voices, pause: audio.pause, pronounce: script.pronounce, language: script.language }
  if (!opts.dryRun && !config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')

  // Narration first: it decides how long each slide stays
  progress({ stage: 'voice' })
  const timed = []
  let t = 0
  for (const [i, s] of script.slides.entries()) {
    let narration = null
    // A slide may have its own voice from the cast, and its own way of speaking
    const spec = opts.dryRun ? null : (s.voice ?? voice)
    if (spec && spec !== 'none' && s.say) narration = await narrate(s.say, withProsody(spec, s), config, speech)
    const duration = Math.max(s.duration ?? 0, narration ? narration.duration + LEAD + TAIL : (s.duration ?? DEFAULT_DURATION))
    // `frame` (the drawn PNG) and `source` (what ffmpeg reads) are filled in while drawing
    timed.push({ ...s, index: i, start: t, duration, narration, frame: '', source: '' })
    t += duration
  }
  const end = t
  if (opts.dryRun) return { dryRun: true, title: script.title ?? name, seconds: Number(end.toFixed(1)), slides: timed.length }

  // Frames: Chromium draws every slide that is not a plain image
  progress({ stage: 'drawing' })
  const needsBrowser = timed.some(s => !s.image || s.html || s.caption || s.title)
  let browser = null
  try {
    if (needsBrowser) {
      const { chromium } = await import('playwright')
      if (config.browsersPath) process.env.PLAYWRIGHT_BROWSERS_PATH ??= config.browsersPath
      browser = await chromium.launch({ headless: true, ...(config.chromium ? { executablePath: config.chromium } : {}), args: ['--disable-gpu', '--disable-dev-shm-usage'] })
    }
    const page = browser && (await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 }))
    if (page && sandboxed) {
      // A slide's HTML is drawn offline: it may not reach the network
      await page.route('**/*', route => (/^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort()))
    }
    for (const s of timed) {
      s.frame = join(work, `slide-${String(s.index).padStart(3, '0')}.png`)
      const image = s.image ? toDataUrl(s.image, dir, { sandboxed }) : null
      if (s.image && !s.html && !s.caption && !s.title) {
        if (/^https?:/.test(image)) {
          if (sandboxed) throw new Error('remote images in API jobs: send them as assets')
          s.source = image
        } else s.source = safePath(s.image, dir, sandboxed)
        continue
      }
      await page.setContent(slideHtml(s, theme, { width, height, image }), { waitUntil: 'load' })
      await page.evaluate(() => document.fonts?.ready)
      await page.screenshot({ path: s.frame })
      s.source = s.frame
    }
  } finally {
    await browser?.close()
  }

  // One clip per slide, then a crossfade chain
  progress({ stage: 'encoding' })
  const clips = []
  for (const s of timed) {
    const clip = join(work, `clip-${String(s.index).padStart(3, '0')}.mp4`)
    const frames = Math.round((s.duration + fade) * fps)
    const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${theme.background.replace('#', '0x')},setsar=1`
    const motion = motionFilter(s.motion, frames, width, height, fps)
    const vf = motion ? `${fit},scale=${width * 2}:${height * 2},${motion},format=yuv420p` : `${fit},fps=${fps},format=yuv420p`
    await ffmpeg(['-loop', '1', '-framerate', String(fps), '-i', s.source, '-t', (s.duration + fade).toFixed(3), '-vf', vf, '-c:v', 'libx264', '-preset', INTERMEDIATE_PRESET,
      '-crf', '16', '-threads', String(config.threads), '-r', String(fps), clip], config)
    clips.push(clip)
  }
  const raw = join(work, 'slides.mkv')
  if (clips.length === 1 || fade === 0) {
    const list = join(work, 'clips.txt')
    writeFileSync(list, clips.map(concatEntry).join('\n'))
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', raw], config)
  } else {
    const inputs = clips.flatMap(c => ['-i', c])
    const chain = []
    let last = '[0:v]'
    let offset = 0
    timed.slice(0, -1).forEach((s, i) => {
      offset += s.duration
      const out = i === timed.length - 2 ? '[vout]' : `[x${i}]`
      chain.push(`${last}[${i + 1}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${out}`)
      last = out
    })
    await ffmpeg([...inputs, '-filter_complex', chain.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', INTERMEDIATE_PRESET, '-crf', '16',
      '-threads', String(config.threads), raw], config)
  }

  const effects = []
  for (const s of timed.filter(s => s.sound)) {
    const { file, volume = 1 } = typeof s.sound === 'string' ? { file: s.sound } : s.sound
    let path = await builtInSound(file, config)
    if (!path) {
      path = safePath(file, dir, sandboxed)
      if (!existsSync(path)) throw new UserError(`sound not found: ${file} (built-in: click, pop, ding, whoosh)`)
    }
    effects.push({ at: s.start, file: path, volume: volume * (audio.effects ?? 1) })
  }

  const music = typeof script.music === 'string' ? { file: script.music } : script.music
  log.debug(`slides: ${timed.length} slides, ${end.toFixed(1)} s`)
  return compose({
    video: raw,
    fps,
    end,
    cuts: [],
    narrations: timed.filter(s => s.narration).map(s => ({ at: s.start + LEAD, file: s.narration.file })),
    effects,
    captions: timed.filter(s => s.say || s.caption).map(s => ({ start: s.start, end: s.start + s.duration, text: plainText(stripMarks(s.caption ?? s.say)) })),
    marks: timed.filter(s => s.chapter || (s.title && !s.image && !s.html)).map(s => ({ start: s.start, title: s.chapter ?? s.title })),
    music: music ? { ...music, file: safePath(music.file, dir, sandboxed) } : null,
    polish: audio.polish,
    out: opts.out,
    title: script.title ?? name,
    language: script.language,
    quality,
    workDir: work,
    voice,
  }, config)
}
