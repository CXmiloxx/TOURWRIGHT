// Needs ffmpeg (skipped without it): a video kept with --keep is made again without the browser.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { compose } from '#video/compose.js'
import { ffmpeg } from '#video/ffmpeg.js'
import { loadConfig } from '#core/config.js'
import { findSource, keepSource, recompose } from '#video/recompose.js'
import { builtInSound } from '#voice/effects.js'

const config = loadConfig()

test('a kept video is made again with new captions, a blur and without clicks; its files stay in its folder', { skip: !config.ffmpeg && 'ffmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-recompose-'))
  try {
    const cfg = loadConfig({ cacheDir: join(dir, 'cache') })
    const work = join(dir, 'work')
    mkdirSync(work)
    const video = join(work, 'raw.mkv')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=10:d=5', '-c:v', 'libx264', '-preset', 'ultrafast', video], cfg)
    const voice = join(work, 'v.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=440:d=1', voice], cfg)
    const click = await builtInSound('click', cfg)
    const out = join(dir, 'videos', 'demo', 'demo')
    mkdirSync(join(dir, 'videos', 'demo'), { recursive: true })
    const p = { video, fps: 10, end: 5, cuts: [[0, 1]], narrations: [{ at: 1.5, file: voice, duration: 1, step: 2, text: 'Hola', voice: 'none' }],
      effects: [{ at: 2, file: click, kind: 'click' }, { at: 2.5, file: click, kind: 'sound' }], captions: [{ start: 1.5, end: 2.5, text: 'Hola' }],
      marks: [{ start: 1, title: 'Uno' }], steps: [{ step: 1, at: 1 }, { step: 2, at: 1.5 }], title: 'Demo', quality: 'sd' }
    await compose({ ...p, out, quality: { crf: '30', preset: 'ultrafast' }, workDir: work }, cfg)
    const folder = keepSource({ ...p, out })
    assert.equal(findSource(join(dir, 'videos', 'demo')), folder)
    assert.equal(findSource(`${out}.mp4`), folder)
    const file = join(folder, 'timeline.json')
    const timeline = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(timeline.steps, [{ step: 1, at: 0 }, { step: 2, at: 0.5 }])
    timeline.captions[0].text = 'Hola de nuevo'
    timeline.blurs = [{ x: 10, y: 10, width: 100, height: 60, start: 0, end: 2 }]
    writeFileSync(file, JSON.stringify(timeline))
    const result = await recompose(folder, { clicks: false }, cfg)
    assert.equal(result.duration, 4)
    assert.match(readFileSync(join(dir, 'videos', 'demo', 'captions.srt'), 'utf8'), /Hola de nuevo/)
    // A box bigger than the video, past its edge, is cut to it
    timeline.blurs = [{ x: 300, y: 200, width: 5000, height: 5000 }]
    writeFileSync(file, JSON.stringify(timeline))
    await recompose(folder, {}, cfg)
    // A timeline is data: no file outside its folder, no name that is a path, nothing but numbers in the filters
    for (const change of [{ video: '../../../etc/passwd' }, { name: '../../escaped' }, { music: { file: 'voice/001.wav', volume: "1,movie=/etc/passwd" } },
      { frame: { background: 'voice/001.wav', mask: 'voice/001.wav', x: '0:movie=/etc/passwd', y: 0, width: 10, height: 10 } }]) {
      writeFileSync(file, JSON.stringify({ ...timeline, blurs: [], ...change }))
      await assert.rejects(recompose(folder, {}, cfg), /outside|file name|expected number|Invalid/i, JSON.stringify(change))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
