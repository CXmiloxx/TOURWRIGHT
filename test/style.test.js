// A video with life: `style`, the shape of each line and the built-in music (made with ffmpeg; skipped without it).
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { loadConfig } from '#core/config.js'
import { fromData } from '#script/load.js'
import { withStyle } from '#script/style.js'
import { applyShifts, lineProsody, lineShape } from '#voice/lively.js'
import { parseVoice, withProsody } from '#voice/index.js'
import { prosodyFilter } from '#voice/sound.js'
import { BUILT_IN_MUSIC, builtInMusic, layers, MUSIC, placeMusic } from '#voice/music.js'
import { ffmpegReport } from '#video/ffmpeg.js'

const config = loadConfig()

test('a style gives defaults; what the script sets wins', () => {
  /** @type {Record<string, any>} */
  const promo = withStyle({ style: 'promo', audio: { rate: '+2%' }, theme: { accent: '#0052CC' }, steps: [] })
  assert.equal(promo.music.file, 'upbeat')
  assert.equal(promo.audio.rate, '+2%')
  assert.equal(promo.audio.dynamic, true)
  assert.equal(promo.audio.transitions, 'whoosh')
  assert.deepEqual(promo.theme, { frame: 'window', titleBackground: 'aurora', accent: '#0052CC' })
  assert.equal(withStyle({ style: 'promo', music: 'none', steps: [] }).music, 'none')
  const plain = { steps: [] }
  assert.equal(withStyle(plain), plain)
  // Loading a script applies it
  assert.equal(/** @type {any} */ (fromData({ style: 'calm', steps: [{ pause: 1 }] }).script).music.file, 'calm')
})

test('each line gets a shape from what it is; its own prosody wins', () => {
  assert.equal(lineShape('¿Tu negocio sigue en hojas de cálculo?').kind, 'question')
  assert.equal(lineShape('¡Listo en 48 horas!').kind, 'exclamation')
  assert.equal(lineShape('Sin compromiso.').kind, 'punch')
  assert.equal(lineShape('Construyen el software que opera tu negocio.').kind, 'plain')
  const audio = { rate: '+6%', dynamic: true }
  assert.deepEqual(lineProsody('¿Y si no se cayera?', {}, audio), { rateShift: '+9%', pitchShift: '+5%' })
  assert.deepEqual(lineProsody('Sin compromiso.', {}, audio), { rateShift: '-1%', pitchShift: '-2%' })
  assert.deepEqual(lineProsody('Una línea normal con varias palabras dentro.', {}, audio), { rateShift: '+6%' })
  assert.deepEqual(lineProsody('¿Y si no se cayera?', { rate: '-10%' }, audio), { rate: '-10%', pitchShift: '+5%' })
  // Neither a rate nor dynamic: the line as it was
  const own = { voice: 'ana' }
  assert.equal(lineProsody('¿Hola?', own, {}), own)
})

test('the music loops are eight bars, with drums only where they belong', () => {
  assert.deepEqual(BUILT_IN_MUSIC, ['upbeat', 'corporate', 'calm'])
  const up = layers(MUSIC.upbeat)
  assert.ok(Math.abs(up.seconds - (8 * 4 * 60) / 112) < 1e-9)
  assert.equal(up.layers.length, 4)
  assert.equal(layers(MUSIC.calm).layers.length, 1)
})

test('a built-in loop is made once and is music-loud; a file name is resolved; none is no music', { skip: !config.ffmpeg && 'ffmpeg not found' }, async () => {
  const file = await builtInMusic('calm', config)
  assert.ok(file && existsSync(file))
  assert.equal(await builtInMusic('calm', config), file)
  const report = await ffmpegReport(['-i', file, '-af', 'ebur128', '-f', 'null', '-'], config)
  const loudness = Number(/I:\s*(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(report)?.[1])
  assert.ok(loudness > -20 && loudness < -8, `loudness ${loudness}`)
  // No tracks of yours: a mood plays the built-in loop; a file is used as it is, at the gain that levels it
  const bare = { ...config, musicDir: `${config.cacheDir}/no-music-here` }
  const loop = await placeMusic({ file: 'calm', volume: 0.1 }, f => `/x/${f}`, bare)
  assert.equal(loop?.file, file)
  assert.ok(loop?.gain > 0.5 && loop?.gain < 2)
  assert.equal((await placeMusic('song.wav', () => file, bare))?.file, file)
  assert.equal(await placeMusic('none', f => f, bare), null)
})

test('your music: added with a name and a mood, found by either, listed without paths, removed', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { addTrack, findTrack, listTracks, removeTrack } = await import('#voice/music-library.js')
  const { musicCatalog } = await import('#voice/music.js')
  const dir = mkdtempSync(join(tmpdir(), 'tw-music-'))
  const cfg = { ...config, musicDir: join(dir, 'music') }
  try {
    const src = join(dir, 'Mi Tema.mp3')
    writeFileSync(src, 'not really audio')
    const a = await addTrack(src, { mood: 'upbeat', artist: 'Ana' }, cfg)
    assert.equal(a.name, 'mi-tema')
    await addTrack(src, { name: 'otra', mood: 'upbeat' }, cfg)
    await addTrack(src, { name: 'suave', mood: 'calm' }, cfg)
    assert.deepEqual(listTracks(cfg).map(t => t.name), ['mi-tema', 'otra', 'suave'])
    assert.equal(findTrack('suave', '', cfg)?.mood, 'calm')
    assert.equal(findTrack('calm', 'x', cfg)?.name, 'suave')
    // The same video always gets the same track of a mood
    assert.equal(findTrack('upbeat', 'Acme', cfg)?.name, findTrack('upbeat', 'Acme', cfg)?.name)
    assert.equal(findTrack('cinematic', '', cfg), null)
    assert.ok(musicCatalog(cfg).tracks.every(t => !('file' in t)))
    await assert.rejects(addTrack(src, { mood: 'sad' }, cfg), /mood sad/)
    await assert.rejects(addTrack(join(dir, 'x.txt'), {}, cfg), /not an audio file/)
    assert.equal(removeTrack('otra', cfg), true)
    assert.equal(removeTrack('otra', cfg), false)
    // A URL is never fetched for an API job
    await assert.rejects(placeMusic('https://a.test/x.mp3', f => f, cfg, { sandboxed: true }), /asset/)
    await assert.rejects(placeMusic('nada.mp3', f => join(dir, f), cfg), /music not found: nada\.mp3/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the words before a focus mark are said the way their whole line says them', () => {
  const audio = { rate: '+6%', dynamic: true }
  // Alone, "Cuéntales tu idea. En" would be a short line, slower and lower; inside its line it is not
  assert.notDeepEqual(lineProsody('Cuéntales tu idea. En', {}, audio), lineProsody('Cuéntales tu idea. En 48 horas tienes respuesta.', {}, audio))
  assert.deepEqual(lineProsody('Cuéntales tu idea. En 48 horas tienes respuesta.', {}, audio), { rateShift: '+6%' })
})

test('a line\'s shape shifts the voice\'s own rate and pitch, and works on every engine', () => {
  const audio = { rate: '+6%', dynamic: true }
  // gonzalo is tuned to -10%: a question is 9% faster than that, not +9% flat
  assert.equal(parseVoice(withProsody('gonzalo', lineProsody('¿Listo?', {}, audio)), config).options.rate, '-1%')
  // The shift is said in the unit the voice already uses
  assert.deepEqual(applyShifts({ pitch: '+1st', pitchShift: '+5%' }).pitch, '+1.84st')
  assert.deepEqual(applyShifts({ pitch: '+2Hz', pitchShift: '+5%' }).pitch, '+12Hz')
  assert.deepEqual(applyShifts({ rateShift: '-7%', pitchShift: '-2%' }), { rate: '-7%', pitch: '-2%' })
  // Piper, Pocket and OpenAI get pitch from ffmpeg: every shape must turn into a filter
  for (const line of ['¿Listo?', '¡Ya!', 'Sin compromiso.', 'Una línea larga '.repeat(6)]) {
    const { options } = parseVoice(withProsody('piper:es_ES-davefx-medium', lineProsody(line, {}, audio)), config)
    assert.doesNotThrow(() => prosodyFilter(options, ['rate']))
  }
})
