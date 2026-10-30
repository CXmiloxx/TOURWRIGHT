// Needs ffmpeg (skipped without it): builds a tiny video and mixes voice, music and effects for real.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { compose, ffmpeg } from '../src/compose.js'
import { loadConfig } from '../src/config.js'
import { run } from '../src/util.js'
import { builtInSound, BUILT_IN_SOUNDS, typingSound } from '../src/voice/effects.js'

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
    assert.deepEqual(stdout.trim().split('\n').slice(0, 3), ['video', 'audio', 'subtitle'])
    // loudnorm in the polish works at 192 kHz: the file must still come out at 48 kHz for every player
    const rate = await run(cfg.ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', result.paths.video])
    assert.equal(rate.stdout.trim(), '48000')
    assert.match(readFileSync(result.paths.srt, 'utf8'), /00:00:01,000 --> 00:00:02,000\nHola/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
