// Needs ffmpeg (skipped without it): the review of the finished video hears a long silence.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ffmpeg } from '../src/compose.js'
import { loadConfig } from '../src/config.js'
import { reviewVideo } from '../src/render/review.js'

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
