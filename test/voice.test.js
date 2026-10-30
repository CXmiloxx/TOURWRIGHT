import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'
import { applyPronunciation, parseVoice, polishFilter, prosodyFilter, splitNarration, splitSentences, stripMarks, withProsody } from '../src/voice/index.js'

const config = loadConfig({ tts: { defaultVoice: 'piper:es_MX-claude-high', aliases: { mia: 'gonzalo' }, piper: {}, edge: {}, openai: {} } })

test('splitSentences splits only between sentences', () => {
  assert.deepEqual(splitSentences('Hola, mundo. ¿Listo? ¡Vamos! | sin *énfasis*'), ['Hola, mundo.', '¿Listo?', '¡Vamos!, sin énfasis'])
  assert.deepEqual(splitSentences('  ...  '), [])
})

test('parseVoice reads engine, id and options, and follows aliases', () => {
  assert.deepEqual(parseVoice('edge:es-CO-SalomeNeural?rate=-4%', config), { engine: 'edge', id: 'es-CO-SalomeNeural', options: { rate: '-4%' }, spec: 'edge:es-CO-SalomeNeural?rate=-4%' })
  assert.equal(parseVoice('mia', config).id, 'es-CO-GonzaloNeural')
  assert.equal(parseVoice(undefined, config).spec, 'piper:es_MX-claude-high')
})

test('parseVoice rejects unknown engines and unsafe ids', () => {
  assert.throws(() => parseVoice('nope:x', config), /unknown TTS engine/)
  assert.throws(() => parseVoice('command:a;rm -rf', config), /invalid voice id/)
  assert.throws(() => parseVoice('piper:../../etc/x', config), /invalid voice id/)
  assert.throws(() => parseVoice('whatever', config), /unknown voice/)
})

test('options after a name add to the alias, literally (+ is not a space)', () => {
  assert.equal(parseVoice('salome?rate=+10%&pitch=+2st', config).spec, 'edge:es-CO-SalomeNeural?rate=+10%&pitch=+2st')
  assert.equal(parseVoice('ana?volume=-3dB', config, { ana: 'claude?rate=-5%' }).spec, 'piper:es_MX-claude-high?rate=-5%&volume=-3dB')
  assert.equal(withProsody('ana?rate=-5%', { rate: '+5%', style: 'calm' }), 'ana?rate=+5%&instructions=calm')
  assert.equal(withProsody('ana', {}), 'ana')
})

test('prosody the engine cannot do becomes ffmpeg filters', () => {
  assert.equal(prosodyFilter({ rate: '+10%', pitch: '+12st', volume: '+3dB' }, ['rate']), 'asetrate=24000*2.0000,aresample=24000,atempo=0.5000,volume=3dB')
  assert.equal(prosodyFilter({ rate: '-20%' }, []), 'atempo=0.8000')
  assert.equal(prosodyFilter({ pitch: '+10Hz' }, ['pitch']), '')
  assert.throws(() => prosodyFilter({ pitch: '+10Hz' }, []), /semitones/)
})

test('exact pauses, pronunciation and captions without marks', () => {
  assert.deepEqual(splitNarration('Uno. [[1.5s]] Dos, tres. [[300ms]]Cuatro'), [{ text: 'Uno.' }, { silence: 1.5 }, { text: 'Dos, tres.' }, { silence: 0.3 }, { text: 'Cuatro' }])
  assert.equal(stripMarks('Uno. [[1.5s]] Dos'), 'Uno. Dos')
  assert.equal(applyPronunciation('El CRM, no los CRMs. SaaS.', { CRM: 'ce erre eme', SaaS: 'sas' }), 'El ce erre eme, no los CRMs. sas.')
})

test('polish presets by name; the server may set a raw filter', () => {
  assert.equal(polishFilter({ tts: { polish: 'default' } }, 'none'), null)
  assert.match(polishFilter({ tts: { polish: 'default' } }, 'radio'), /lowpass=f=3400/)
  assert.equal(polishFilter({ tts: { polish: 'volume=2' } }), 'volume=2')
})
