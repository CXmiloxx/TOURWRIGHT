import assert from 'node:assert/strict'
import { test } from 'node:test'
import YAML from 'yaml'
import { checkTranslation, translatable, translatedPath, translateScript } from '../src/translate.js'

const SOURCE = `# My tour
title: Tu primera factura
language: es
voice: salome
pronounce: { Facturero: Factureró }
steps:
  - title: { text: Facturas, kicker: "Paso a paso", subtitle: Sin enredos }
  # the login
  - focus: { target: { label: Correo }, say: "Escribe tu {correo}.", text: "Tu <b>correo</b>" }
  - type: { target: { label: Correo }, text: "\${secret:APP_USER}" }
  - say: "Hola {{name}}, bienvenido."
  - callout: { target: { text: Guardar }, text: Aquí se guarda }
  - wait: { text: Guardado }
  - click: { role: button, name: Guardar }
`

test('only what the viewer reads or hears is translated; targets and typed text stay', () => {
  const texts = translatable(YAML.parseDocument(SOURCE)).map(t => t.node.value)
  assert.deepEqual(texts, ['Tu primera factura', 'Facturas', 'Paso a paso', 'Sin enredos', 'Escribe tu {correo}.', 'Tu <b>correo</b>', 'Hola {{name}}, bienvenido.', 'Aquí se guarda'])
})

test('a translation keeps variables, secrets, tags and the marked word, or the line stays as it was', () => {
  assert.equal(checkTranslation('Escribe tu {correo}.', 'Type your {email}.'), null)
  assert.match(checkTranslation('Escribe tu {correo}.', 'Type your email.'), /marked/)
  assert.match(checkTranslation('Hola {{name}}', 'Hi {{nombre}}'), /variable/)
  assert.match(checkTranslation('Tu <b>correo</b>', 'Your email'), /HTML/)
})

test('the translated script: new language, no fixed voice, comments kept, bad lines reported', async () => {
  const fake = async texts => new Map(texts.map(t => [t.id, t.text === 'Hola {{name}}, bienvenido.' ? 'Hi, welcome.' : `EN ${t.text}`]))
  const r = await translateScript(SOURCE, { to: 'en', translate: fake })
  const out = YAML.parse(r.text)
  assert.equal(out.language, 'en')
  assert.equal(out.voice, undefined)
  assert.equal(out.pronounce, undefined)
  assert.equal(out.title, 'EN Tu primera factura')
  assert.equal(out.steps[1].focus.say, 'EN Escribe tu {correo}.')
  assert.deepEqual(out.steps[1].focus.target, { label: 'Correo' })
  assert.equal(out.steps[2].type.text, '${secret:APP_USER}')
  assert.deepEqual(out.steps[5].wait, { text: 'Guardado' })
  assert.equal(out.steps[3].say, 'Hola {{name}}, bienvenido.', 'the line that lost its variable stays')
  assert.equal(r.kept.length, 1)
  assert.match(r.text, /# the login/)
  await assert.rejects(translateScript(SOURCE, { to: 'es', translate: fake }), /already in Spanish/)
  assert.equal(translatedPath('videos/tour.yaml', 'en'), 'videos/tour.en.yaml')
  assert.equal(translatedPath('videos/tour.es.yaml', 'en'), 'videos/tour.en.yaml')
})
