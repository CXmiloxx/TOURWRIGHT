import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lexicon, spanishNumber, speakable, voiceLanguage } from '#voice/lexicon.js'
import { applyPronunciation } from '#voice/index.js'

test('Spanish numbers in words, with "un" before thousands and millions', () => {
  const cases = { 0: 'cero', 21: 'veintiuno', 31: 'treinta y uno', 100: 'cien', 101: 'ciento uno', 2026: 'dos mil veintiséis', 21000: 'veintiún mil', 25800: 'veinticinco mil ochocientos', 1000000: 'un millón', 2500000: 'dos millones quinientos mil' }
  for (const [n, words] of Object.entries(cases)) assert.equal(spanishNumber(Number(n)), words)
})

test('numbers are said in words, agreeing with what they count', () => {
  assert.equal(speakable('El consumo es de 25.800 pesos y el 95 % tuvo resultado.', 'es'), 'El consumo es de veinticinco mil ochocientos pesos y el noventa y cinco por ciento tuvo resultado.')
  assert.equal(speakable('Hay 21 consultas, 31 días, 1 fuente, 1 usuario y 3,5 segundos.', 'es'), 'Hay veintiuna consultas, treinta y un días, una fuente, un usuario y tres coma cinco segundos.')
  assert.equal(speakable('Código 00021, cédula 1088248203.', 'es'), 'Código cero cero cero dos uno, cédula uno cero ocho ocho dos cuatro ocho dos cero tres.')
})

test('acronyms without vowels are spelled; the ones read as words are left alone', () => {
  assert.equal(speakable('La CC, los PDFs, la UE, el IVA y el ADRES.', 'es'), 'La ce ce, los pe de efes, la u e, el IVA y el ADRES.')
  assert.equal(speakable('The CC and the IVA.', 'en'), 'The CC and the IVA.')
})

test('keyboard shortcuts are said the way people say them, only inside a shortcut', () => {
  assert.equal(speakable('Abre la búsqueda con Ctrl K.', 'es'), 'Abre la búsqueda con control ca.')
  assert.equal(speakable('Pulsa Ctrl+Shift+P y luego Cmd + v.', 'es'), 'Pulsa control Shift pe y luego comando ve.')
  assert.equal(speakable('El control de calidad, la tecla K y el Ctrl de la izquierda.', 'es'), 'El control de calidad, la tecla K y el Ctrl de la izquierda.')
  assert.equal(speakable('Press Ctrl K.', 'en'), 'Press Ctrl K.')
})

test('a voice\'s own calibration wins over its engine\'s, only for the terms it got right', () => {
  // A term the voice heard right with a respelling gets it; one heard right as written loses the engine's respelling
  const engine = lexicon('es', 'piper')
  const own = lexicon('es', 'piper', 'es_ES-davefx-medium')
  assert.equal(own.API, 'a pe i')
  assert.notEqual(engine.API, own.API)
  assert.deepEqual(lexicon('es', 'piper', 'a-voice-never-measured'), engine)
})

test('tech words come from the lexicon of the language; a script\'s pronounce wins', () => {
  const words = { ...lexicon('es'), API: 'ei pi ai' }
  assert.equal(applyPronunciation('Conecta la API key y lee el JSON.', words), 'Conecta la a pe i qui y lee el yei son.')
  assert.equal(applyPronunciation('La API.', words), 'La ei pi ai.')
  assert.deepEqual(lexicon('fr'), {})
})

test('the language of a voice comes from its name or its model', () => {
  assert.equal(voiceLanguage({ engine: 'piper', id: 'es_MX-claude-high', options: {} }), 'es')
  // A multilingual voice speaks the script's language: its name does not decide the lexicon or the numbers
  assert.equal(voiceLanguage({ engine: 'edge', id: 'en-US-AvaMultilingualNeural', options: {} }), undefined)
  assert.equal(voiceLanguage({ engine: 'edge', id: 'en-US-JennyNeural', options: {} }), 'en')
  assert.equal(voiceLanguage({ engine: 'pocket', id: 'lola', options: {} }), 'es')
  assert.equal(voiceLanguage({ engine: 'pocket', id: 'alba', options: { model: 'french_24l' } }), 'fr')
  assert.equal(voiceLanguage({ engine: 'openai', id: 'alloy', options: {} }), undefined)
})
