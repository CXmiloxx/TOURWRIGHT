// What a walkthrough render will be, decided before the browser opens: the size and shape of the video, the
// device, the voice, how it is captured, how big the page is drawn. Every mistake the script or the command can
// make here fails now, not halfway through the recording.
import { qualityOf } from '#video/quality.js'
import { log, UserError } from '#core/util.js'
import { autoVoice, parseVoice } from '#voice/index.js'
import { pickCapture } from '#render/browser/capture.js'
import { resolveTheme } from '#render/page/theme.js'

// `device` in a script: the browser of Playwright's list it borrows (user agent, touch, mobile), the quality used
// when none is chosen, and for a tablet its own video size (3:4, not a phone's 9:16)
export const DEVICES = {
  iphone: { playwright: 'iPhone 15', quality: 'vertical' },
  'iphone-se': { playwright: 'iPhone SE', quality: 'vertical' },
  android: { playwright: 'Pixel 7', quality: 'vertical' },
  ipad: { playwright: 'iPad (gen 7)', quality: 'vertical', size: { width: 1080, height: 1440 } },
}

/** The language a voice speaks, from its id (es_MX-claude-high, es-CO-GonzaloNeural) */
export const voiceLanguage = spec => /(?:^|[:_-])(es|en|pt|fr|de|it)[_-]/i.exec(spec)?.[1]?.toLowerCase()

/**
 * @param {import('#script/load.js').Loaded & { kind: 'browser' }} loaded
 * @param {Record<string, any>} script  the script with its secrets in place
 * @param {Record<string, any>} opts    the options of render()
 * @param {Record<string, any>} config
 */
export const planWalkthrough = async (loaded, script, opts, config) => {
  const { dir, sandboxed } = loaded
  // The command, then the script, then the person's own default (tourwright config set quality …)
  // A device films the app as that phone or tablet shows it: its width in CSS pixels, its browser (user agent,
  // touch, mobile layout) and, unless a size is chosen, a video in its own shape
  const device = script.device ? DEVICES[script.device] : null
  const named = opts.quality ?? script.quality
  const qualityName = named ?? (device ? device.quality : config.render.quality)
  const quality = qualityOf(qualityName)
  const width = opts.width ?? script.width ?? (device && !named ? device.size?.width : undefined) ?? quality.width
  const height = opts.height ?? script.height ?? (device && !named ? device.size?.height : undefined) ?? quality.height
  const fps = script.fps ?? config.render.fps
  // A safe dry run finds every element without pressing, typing or choosing anything: nothing real happens in the app
  const safe = Boolean(opts.safe)
  const dryRun = Boolean(opts.dryRun) || safe
  // Only declarative steps can be held back: a JavaScript script uses the page itself, and the steps before a
  // --step preview run for real
  if (safe && loaded.run) throw new UserError('--safe works with YAML and JSON scripts: a JavaScript script uses the page directly')
  if (safe && opts.steps) throw new UserError('--safe and --step together: the steps before the preview would run for real; use --safe alone')
  // Nobody chose one: the most natural voice this machine has for the script's language
  const voiceSpec = opts.voice ?? script.voice ?? (dryRun ? config.tts.defaultVoice : await autoVoice(script.language, config))
  const voice = dryRun || voiceSpec === 'none' ? null : voiceSpec
  // How big the page is drawn: a vertical video is filmed the way a phone shows the app, half as wide in CSS pixels at
  // twice the density, so the app uses its own mobile layout, filling the screen, big and sharp; `scale` chooses
  // another size. The frames still come out at width x height. The virtual display of capture "screen" draws at
  // 1x: `auto` films any other density as a screencast.
  const browserOf = device ? (await import('playwright')).devices[device.playwright] : null
  const wanted = script.scale ?? (browserOf ? Math.min(4, Math.max(1, width / browserOf.viewport.width)) : height > width ? 2 : 1)
  const mode = dryRun ? 'dry' : pickCapture(opts.capture ?? config.render.capture, config, { portrait: wanted !== 1 || Boolean(device) })
  if (mode === 'screen' && wanted !== 1) log.warn(`scale ${wanted}: capture "screen" draws the page at 1x; use --capture screencast for a bigger page`)
  if (mode === 'screen' && device) log.warn(`device ${script.device}: capture "screen" films a desktop browser; use --capture screencast to film it as the device`)
  const density = mode === 'screen' ? 1 : wanted
  const audio = script.audio ?? {}
  // Unknown voices fail now, not halfway through the recording
  if (!dryRun) for (const spec of [voice, ...Object.values(script.voices ?? {})]) if (spec && spec !== 'none') parseVoice(spec, config, script.voices)
  if (sandboxed && script.hosts && Object.keys(script.hosts).length) throw new UserError('`hosts` is not available for API jobs')
  if (!dryRun && !config.ffmpeg) throw new Error('ffmpeg not found (install ffmpeg or set TOURWRIGHT_FFMPEG)')
  return {
    device,
    browserOf,
    quality,
    qualityName,
    width,
    height,
    fps,
    safe,
    dryRun,
    voice,
    mode,
    density,
    pageSize: { width: Math.round(width / density), height: Math.round(height / density), scale: density },
    theme: resolveTheme(script.theme, config.theme, dir, { sandboxed }),
    audio,
    speech: { aliases: script.voices, pause: audio.pause, pronounce: script.pronounce, language: script.language },
    locale: script.language === 'en' ? 'en-US' : script.language ?? 'es-CO',
    title: script.title ?? loaded.name,
    language: script.language ?? (voice ? voiceLanguage(voice) : undefined),
  }
}

/** @typedef {Awaited<ReturnType<typeof planWalkthrough>>} Plan */
