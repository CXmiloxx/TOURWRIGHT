// Needs ffmpeg (skipped without it): the review of the finished video hears a long silence.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ffmpeg } from '#video/ffmpeg.js'
import { loadConfig } from '#core/config.js'
import { integrated, reviewAudio, reviewVideo } from '#video/review.js'

const config = loadConfig()

test('a narrated video with 7 s of nothing to hear is reported; a pause of 4 s or a quiet opening or closing card is not', { skip: !config.ffmpeg && 'ffmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-review-'))
  try {
    const file = join(dir, 'v.mp4')
    // A quiet opening card, voice, a pause of 4 s to read, voice, 7 s of nothing, voice and a quiet closing card
    const audio = 'anullsrc=r=48000:cl=mono,atrim=duration=5[z];sine=f=440:d=2:r=48000[a];anullsrc=r=48000:cl=mono,atrim=duration=4[b];sine=f=440:d=2:r=48000[c];anullsrc=r=48000:cl=mono,atrim=duration=7[d];sine=f=440:d=2:r=48000[e];anullsrc=r=48000:cl=mono,atrim=duration=5[y];[z][a][b][c][d][e][y]concat=n=7:v=0:a=1[out]'
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=10:d=27', '-filter_complex', audio, '-map', '0:v', '-map', '[out]', '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', file], config)
    const found = (await reviewVideo(file, config)).filter(f => f.kind === 'silence')
    assert.equal(found.length, 1)
    assert.ok(Math.abs((found[0].at ?? 0) - 13) < 0.3, `silence at ${found[0].at}`)
    // A tour with no voice at all is quiet on purpose
    assert.deepEqual((await reviewVideo(file, config, { narrated: false })).filter(f => f.kind === 'silence'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a sentence far quieter than the narration and a peak that distorts are reported, with the step and the second', { skip: !config.ffmpeg && 'ffmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tourwright-review-audio-'))
  try {
    const file = join(dir, 'v.mp4')
    // Two sentences at about -16 LUFS, one at about -33, then a click at +6 dB over full scale
    const audio = 'sine=f=440:d=2:r=48000,volume=2[a];anullsrc=r=48000:cl=mono,atrim=duration=1[g1];sine=f=440:d=2:r=48000,volume=2[b];' +
      'anullsrc=r=48000:cl=mono,atrim=duration=1[g2];sine=f=440:d=2:r=48000,volume=0.3[c];anullsrc=r=48000:cl=mono,atrim=duration=1[g3];' +
      'sine=f=1000:d=0.05:r=48000,volume=16[p];anullsrc=r=48000:cl=mono,atrim=duration=1[g4];[a][g1][b][g2][c][g3][p][g4]concat=n=8:v=0:a=1[out]'
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=160x120:r=10:d=10', '-filter_complex', audio, '-map', '0:v', '-map', '[out]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', '-shortest', file.replace('.mp4', '.mkv')], config)
    const spoken = [{ start: 0, end: 2, step: 1, text: 'Uno' }, { start: 3, end: 5, step: 2, text: 'Dos' }, { start: 6, end: 8, step: 3, text: 'Tres' }]
    const found = await reviewAudio(file.replace('.mp4', '.mkv'), config, spoken)
    const quiet = found.filter(f => f.kind === 'loudness')
    assert.equal(quiet.length, 1, JSON.stringify(found))
    assert.equal(quiet[0].step, 3)
    assert.match(quiet[0].message, /"Tres".*quieter/)
    const peaks = found.filter(f => f.kind === 'clipping')
    assert.equal(peaks.length, 1, JSON.stringify(found))
    assert.ok(Math.abs((peaks[0].at ?? 0) - 9.1) < 0.5, `peak at ${peaks[0].at}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the loudness of a stretch is the gated mean of its 400 ms blocks', () => {
  const frames = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(t => ({ t, m: -16, peak: -3 })).concat([{ t: 1.1, m: -80, peak: -60 }, { t: 1.2, m: -40, peak: -30 }])
  assert.equal(Math.round(integrated(frames, 0, 1.2) ?? 0), -16)
  assert.equal(integrated(frames, 5, 6), null)
})
