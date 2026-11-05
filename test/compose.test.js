// Needs ffmpeg (skipped without it): builds a tiny video and mixes voice, music and effects for real.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { audibleEffects, compose } from '#video/compose.js'
import { ffmpeg } from '#video/ffmpeg.js'
import { levelClip, loudnessOf } from '#video/loudness.js'
import { LOUDNESS } from '#voice/index.js'
import { loadConfig } from '#core/config.js'
import { run } from '#core/util.js'
import { builtInSound, BUILT_IN_SOUNDS, typingSound } from '#voice/effects.js'

const config = loadConfig()

test('voice, ducked music and effects end up in one track; cuts move everything', { skip: !config.ffmpeg && 'ffmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-compose-'))
  try {
    const cfg = loadConfig({ cacheDir: dir })
    const video = join(dir, 'raw.mkv')
    const tone = (f, d, file) => ffmpeg(['-f', 'lavfi', '-i', `sine=f=${f}:d=${d}`, file], cfg)
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=10:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', video], cfg)
    await tone(440, 1, join(dir, 'voice.wav'))
    await tone(220, 10, join(dir, 'music.wav'))
    for (const name of BUILT_IN_SOUNDS) assert.ok(await builtInSound(name, cfg))
    const typing = await typingSound(12, 70, cfg)
    const result = await compose({
      video, fps: 10, end: 6, cuts: [[0, 1]],
      narrations: [{ at: 2, file: join(dir, 'voice.wav') }],
      effects: [{ at: 1.5, file: await builtInSound('click', cfg) }, { at: 3, file: typing, volume: 0.5 }],
      captions: [{ start: 2, end: 3, text: 'Hola' }],
      marks: [{ start: 1, title: 'Uno' }],
      music: { file: join(dir, 'music.wav'), volume: 0.2, fadeIn: 1, fadeOut: 1 },
      polish: 'radio',
      out: join(dir, 'out'), title: 'Test', language: 'es', quality: { crf: '30', preset: 'ultrafast' }, workDir: dir,
    }, cfg)
    assert.equal(result.duration, 5)
    assert.deepEqual(result.captions, [{ text: 'Hola', start: 1, end: 2 }])
    assert.deepEqual(result.chapters.map(c => [c.title, c.start]), [['Uno', 0]])
    const { stdout } = await run(cfg.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', result.paths.video])
    // No subtitle track: players would show it on top of the captions drawn on the video
    const streams = stdout.trim().split(/\r?\n/)
    assert.deepEqual(streams.slice(0, 2), ['video', 'audio'])
    assert.ok(!streams.includes('subtitle'))
    // loudnorm in the polish works at 192 kHz: the file must still come out at 48 kHz for every player
    const rate = await run(cfg.ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', result.paths.video])
    assert.equal(rate.stdout.trim(), '48000')
    assert.match(readFileSync(result.paths.srt, 'utf8'), /00:00:01,000 --> 00:00:02,000\nHola/)
    // Not named after the video: players would load it by themselves over the captions drawn on it
    assert.equal(basename(result.paths.srt), 'captions.srt')
    assert.equal(basename(result.paths.vtt), 'captions.vtt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a short, peaky sentence is leveled like the others; the mix never peaks over the limit; clicks in a cut are dropped', { skip: !config.ffmpeg && 'ffmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-level-'))
  try {
    const cfg = loadConfig({ cacheDir: dir })
    // 1.4 s of a quiet tone with one sharp click: loudnorm kept it 5 to 15 dB under the target to save that peak
    const peaky = join(dir, 'peaky.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=300:d=1.4:r=48000,volume=0.05', '-f', 'lavfi', '-i', 'sine=f=3000:d=0.01:r=48000,volume=0.95',
      '-filter_complex', '[1]adelay=700[c];[0][c]amix=inputs=2:normalize=0', peaky], cfg)
    const leveled = await levelClip(peaky, join(dir, 'leveled.wav'), null, cfg)
    assert.ok(Math.abs((leveled.lufs ?? 0) - LOUDNESS.I) <= 1, `leveled to ${leveled.lufs}`)
    const measured = await loudnessOf(leveled.file, cfg)
    assert.ok(Math.abs((measured.i ?? 0) - LOUDNESS.I) <= 1, `measured ${measured.i}`)
    assert.ok((measured.tp ?? 0) <= LOUDNESS.TP + 0.5, `true peak ${measured.tp}`)
    // The second time it comes from the cache
    assert.deepEqual((await levelClip(peaky, join(dir, 'again.wav'), null, cfg)).lufs, leveled.lufs)

    // Twelve loud clicks at the same instant: the master limiter keeps the sum under the limit
    const video = join(dir, 'raw.mkv')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=160x120:r=10:d=4', '-c:v', 'libx264', '-preset', 'ultrafast', video], cfg)
    const click = await builtInSound('click', cfg)
    const result = await compose({
      video, fps: 10, end: 4, cuts: [[1, 2]],
      narrations: [{ at: 0.2, file: peaky, duration: 1.4, step: 1, text: 'Hola' }],
      effects: Array.from({ length: 12 }, () => ({ at: 2.5, file: click, volume: 2, kind: 'click' })).concat([{ at: 1.5, file: click, volume: 2, kind: 'click' }]),
      captions: [], marks: [], out: join(dir, 'out'), title: 'Test', quality: { crf: '30', preset: 'ultrafast' }, workDir: dir,
    }, cfg)
    assert.ok(((await loudnessOf(result.paths.video, cfg)).tp ?? 0) <= -1, 'true peak of the mix')
    assert.equal(result.spoken.length, 1)
    assert.equal(result.spoken[0].step, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('effects inside a cut (off camera, before the video starts) are dropped instead of piling up on the cut', () => {
  const kept = audibleEffects([{ at: 0.5, kind: 'click' }, { at: 3, kind: 'typing' }, { at: 3.5, kind: 'sound' }, { at: 3.9, kind: 'click' }, { at: 4, kind: 'click' }, { at: 6 }], [[0, 1], [3, 4]])
  // A sound the script asked for stays; clicks and typing off camera go
  assert.deepEqual(kept.map(e => e.at), [3.5, 4, 6])
})
