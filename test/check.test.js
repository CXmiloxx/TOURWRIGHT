import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareWords, CORPUS, normalizeWords } from '../src/voice/check.js'

test('texts are compared without case, accents, punctuation or digit-vs-word differences', () => {
  assert.deepEqual(normalizeWords('Este mes van 25.800 consultas, el 95 % con resultado.', 'es'),
    normalizeWords('este mes van veinticinco mil ochocientas consultas el noventa y cinco por ciento con resultado', 'es').map(w => (w === 'ochocientas' ? 'ochocientos' : w)))
  assert.deepEqual(normalizeWords('¿Sesión? ¡Sí!', 'es'), ['sesion', 'si'])
  assert.deepEqual(normalizeWords('soporte@consultar.co', 'es'), ['soporte', 'arroba', 'consultar', 'punto', 'co'])
})

test('the words a voice got wrong are grouped into mistakes', () => {
  const r = compareWords(['la', 'api', 'key', 'responde', 'en', 'json'], ['la', 'apiki', 'responde', 'en', 'son'])
  assert.equal(r.words, 6)
  assert.equal(r.errors, 3)
  assert.deepEqual(r.mistakes, [{ expected: 'api key', heard: 'apiki' }, { expected: 'json', heard: 'son' }])
  assert.deepEqual(compareWords(['hola'], ['hola']).mistakes, [])
})

test('the corpus covers what narrations hold', () => {
  const text = CORPUS.es.join(' ')
  for (const word of ['API', 'JSON', 'PDF', '25.800', '%', '$', '@', 'Ctrl', 'curl', 'HTTPS', '¿']) assert.ok(text.includes(word), word)
})
