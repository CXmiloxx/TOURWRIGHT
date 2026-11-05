// After the last step: the recording becomes the finished video, which is looked at and listened to; with --keep
// what it is made of stays next to it.
import { readFileSync, writeFileSync } from 'node:fs'
import { compose } from '#video/compose.js'
import { keepSource } from '#video/recompose.js'
import { drawFrame } from '#render/page/frame.js'
import { reportFindings, reviewAudio, reviewVideo } from '#video/review.js'
import { safePath } from '#render/page/theme.js'

/**
 * @param {{
 *   source: string, end: number, clock: import('./clock.js').Clock, plan: import('./plan.js').Plan, script: Record<string, any>,
 *   loaded: { dir: string, sandboxed: boolean }, browser: import('playwright').Browser, findings: any[], opts: Record<string, any>,
 *   config: Record<string, any>
 * }} p
 */
export const deliver = async ({ source, end, clock, plan, script, loaded, browser, findings, opts, config }) => {
  const music = typeof script.music === 'string' ? { file: script.music } : script.music
  const placedMusic = music ? { ...music, file: safePath(music.file, loaded.dir, loaded.sandboxed) } : null
  const studioFrame = plan.theme.frame === 'window'
    ? await drawFrame(browser, { width: plan.width, height: plan.height, theme: plan.theme, title: plan.title, workDir: opts.workDir })
    : null
  const timeline = clock.timeline(end)
  const result = await compose({
    video: source,
    fps: plan.fps,
    ...timeline,
    music: placedMusic,
    polish: plan.audio.polish,
    out: opts.out,
    sidecar: opts.sidecar,
    title: plan.title,
    language: plan.language,
    quality: plan.quality,
    workDir: opts.workDir,
    voice: plan.voice,
    frame: studioFrame,
  }, config)
  // The finished video is looked at and listened to; the findings go into its manifest
  const [seen, heard] = await Promise.all([
    reviewVideo(result.paths.video, config, { narrated: timeline.narrations.length > 0 }),
    reviewAudio(result.paths.video, config, result.spoken),
  ])
  const review = [...findings, ...seen, ...heard]
  reportFindings(review)
  writeFileSync(result.paths.manifest, JSON.stringify({ ...JSON.parse(readFileSync(result.paths.manifest, 'utf8')), review }, null, 2))
  // --keep: what the video is made of, to make it again without the browser (tourwright recompose)
  if (opts.keep) {
    result.paths.source = keepSource({
      out: opts.out, video: source, fps: plan.fps, ...timeline, steps: clock.steps, music: placedMusic, polish: plan.audio.polish,
      title: plan.title, language: plan.language, quality: plan.qualityName, voice: plan.voice, speech: plan.speech, frame: studioFrame,
      export: opts.export,
    })
  }
  const { spoken, ...delivered } = result
  return { ...delivered, review }
}
