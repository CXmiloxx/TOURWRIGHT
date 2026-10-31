import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromData, interpolate, parseText } from '../src/script/load.js'
import { jsonSchema, validateScript } from '../src/script/schema.js'

test('a browser script with every kind of target is valid', () => {
  const r = validateScript({
    baseUrl: 'https://example.com',
    steps: [
      { goto: '/' },
      { title: { text: 'Hi', subtitle: 'there' } },
      { say: 'Hello <b>world</b>' },
      { say: { caption: 'Short', speak: 'A longer narration' } },
      { click: { role: 'button', name: 'Buy' } },
      { type: { target: { placeholder: 'Email' }, text: 'a@b.c' } },
      { zoom: { target: 'h1', scale: 2 } },
      { wait: { text: 'Done', timeout: 1000 } },
      { offCamera: [{ pause: 10 }] },
      { say: null },
    ],
  })
  assert.equal(r.ok, true, r.errors?.join('\n'))
})

test('errors point to the step and the action', () => {
  const r = validateScript({ steps: [{ clik: 'a' }, { click: 'a', pause: 3 }, { zoom: { target: 'a', scale: 9 } }] })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /^steps\.0: unknown action "clik"/)
  assert.match(r.errors[1], /^steps\.1: a step has exactly one action/)
  assert.match(r.errors[2], /^steps\.2\.zoom/)
})

test('slides scripts', () => {
  assert.equal(validateScript({ type: 'slides', slides: [{ title: 'A', say: 'B' }, { image: 'x.png' }] }).ok, true)
  assert.equal(validateScript({ type: 'slides', slides: [{}] }).ok, false)
  assert.equal(fromData({ type: 'slides', slides: [{ title: 'A' }] }).kind, 'slides')
})

test('YAML and JSON text', () => {
  assert.deepEqual(parseText('steps:\n  - goto: /'), { steps: [{ goto: '/' }] })
  assert.throws(() => parseText('{', 'json'), /not valid JSON/)
})

test('only TOURWRIGHT_SECRET_* variables can be interpolated', () => {
  process.env.TOURWRIGHT_SECRET_PASS = 's3cret'
  process.env.OTHER = 'x'
  assert.deepEqual(interpolate({ a: ['${env:TOURWRIGHT_SECRET_PASS}'] }), { a: ['s3cret'] })
  assert.throws(() => interpolate('${env:OTHER}'), /only TOURWRIGHT_SECRET_/)
  assert.throws(() => interpolate('${env:TOURWRIGHT_SECRET_PASS}', { allowed: false }), /disabled/)
})

test('the JSON Schema describes every step action', () => {
  const s = jsonSchema()
  assert.equal(s.oneOf.length, 2)
  const actions = s.$defs.step.oneOf.map(o => o.required[0])
  assert.ok(actions.includes('click') && actions.includes('offCamera'))
})

test('new actions, voices per line and audio options are valid', () => {
  const r = validateScript({
    voices: { ana: 'salome', guide: 'piper:es_MX-claude-high?rate=-5%' },
    pronounce: { CRM: 'ce erre eme' },
    audio: { polish: 'warm', pause: 0.3, clicks: true, typing: true, effects: 0.8 },
    music: { file: 'm.mp3', fadeIn: 2, fadeOut: 3 },
    steps: [
      { say: { caption: 'Hola', voice: 'ana', rate: '+10%', pitch: '-2st', volume: '+2dB', style: 'calm' } },
      { title: { text: 'T', say: 'Hi', voice: 'guide' } },
      { dblclick: '#a' }, { rightClick: { role: 'row' } }, { check: { label: 'I agree' } }, { uncheck: '#b' },
      { drag: { from: '#card', to: '#done' } },
      { spotlight: { target: '#a', ms: 1000 } }, { callout: { target: '#a', text: 'Here', position: 'top' } },
      { cursor: 'hide' }, { back: true }, { reload: null }, { sound: 'ding' }, { sound: { file: 'x.wav', volume: 0.5, wait: true } },
      { if: { visible: { text: 'Accept cookies' }, then: [{ click: { text: 'Accept cookies' } }] } },
      { try: [{ click: '#maybe' }] }, { try: { steps: [{ click: '#maybe' }], timeout: 1000 } },
    ],
  })
  assert.equal(r.ok, true, r.errors?.join('\n'))
  assert.equal(validateScript({ steps: [{ say: { caption: 'x', rate: 'fast' } }] }).ok, false)
  assert.equal(validateScript({ steps: [{ if: { then: [] } }] }).ok, false)
  assert.equal(validateScript({ type: 'slides', slides: [{ title: 'A', say: 'B', voice: 'ana', sound: 'pop', pitch: '+1st' }] }).ok, true)
})

test('the JSON Schema points nested steps back to the step definition', () => {
  const s = jsonSchema()
  const def = name => s.$defs.step.oneOf.find(o => o.required[0] === name).properties[name]
  assert.equal(def('if').properties.then.items.$ref, '#/$defs/step')
  assert.equal(def('offCamera').items.$ref, '#/$defs/step')
  const browser = s.oneOf.find(o => o.title === 'Browser walkthrough')
  assert.equal(browser.properties.blocks.additionalProperties.items.$ref, '#/$defs/step')
})

test('focus: the marked word and what is said before it', async () => {
  const { markedLine } = await import('../src/voice/index.js')
  assert.deepEqual(markedLine('Then press {Pay}.'), { spoken: 'Then press Pay.', before: 'Then press ' })
  assert.deepEqual(markedLine('{Total} first'), { spoken: 'Total first', before: '' })
  assert.deepEqual(markedLine('No mark here'), { spoken: 'No mark here', before: null })
  assert.equal(markedLine('A {b} and {c}').spoken, 'A b and c')
  const ok = validateScript({ steps: [{ focus: { target: { role: 'button', name: 'Pay' }, say: 'Press {Pay}', step: '3/5', zoom: 1.3, pulse: true, click: true } }] })
  assert.equal(ok.ok, true)
  assert.equal(validateScript({ steps: [{ focus: { target: 'a', zoom: 9 } }] }).ok, false)
})

test('a title card: words to animate, escaped text, known styles only', async () => {
  const { titleHtml } = await import('../src/render/theme.js')
  const html = titleHtml({ text: 'Tu <b>primera</b> factura', subtitle: 'Paso a paso', kicker: 'Tutorial', animation: 'rise', background: 'aurora' })
  assert.match(html, /class="tw-s-rise tw-bg-aurora"/)
  assert.equal((html.match(/class="tw-w"/g) ?? []).length, 3)
  assert.match(html, /&lt;b&gt;primera&lt;\/b&gt;/)
  assert.match(html, /<div class="tw-kicker">Tutorial<\/div>/)
  assert.equal((titleHtml({ text: 'Hola', animation: 'type' }).match(/class="tw-c"/g) ?? []).length, 4)
  assert.match(titleHtml({ text: 'x', animation: 'evil" onload="x', background: 'nope' }), /class="tw-s-rise tw-bg-gradient"/)
})
