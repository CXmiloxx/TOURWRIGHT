import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyFixes, likeness, markdownReport, suggestFix } from '../src/repair.js'

const elements = [
  { target: { placeholder: 'Tu usuario o tu correo' }, kind: 'field', hint: 'Tu usuario o tu correo Usuario o correo' },
  { target: { label: 'Contraseña' }, kind: 'field', hint: 'Contraseña' },
  { target: { role: 'button', name: 'Ingresar' }, kind: 'button', hint: 'Ingresar' },
  { target: { role: 'link', name: '¿Olvidaste tu contraseña?' }, kind: 'link', hint: '¿Olvidaste tu contraseña?' },
]

test('texts are compared by their words, without accents, case or filler words', () => {
  assert.equal(likeness('Usuario o correo', 'Tu usuario o tu correo'), 1)
  assert.equal(likeness('CONTRASEÑA', 'contrasena'), 1)
  assert.equal(likeness('Guardar cambios', 'Guardar'), 0.5)
  assert.equal(likeness('Entrar', 'Ingresar'), 0)
})

test('a broken step gets the element it most likely meant, of the same kind', () => {
  assert.deepEqual(suggestFix({ target: { label: 'Usuario o correo' }, elements })?.to, { placeholder: 'Tu usuario o tu correo' })
  // Nothing alike, but the only button on the page
  const only = suggestFix({ target: { role: 'button', name: 'Entrar' }, elements })
  assert.deepEqual(only?.to, { role: 'button', name: 'Ingresar' })
  assert.equal(only?.only, true)
  // Two fields and no word in common: no guess
  assert.equal(suggestFix({ target: { label: 'Clave secreta' }, elements: elements.filter(e => e.kind === 'field') }), null)
  // A selector says nothing to compare with
  assert.equal(suggestFix({ target: '#user', elements }), null)
})

test('fixes go into the YAML where the target is written, keeping comments', () => {
  const source = [
    '# The login',
    'blocks:',
    '  login:',
    '    - type: { target: { label: Usuario o correo }, text: ana }  # the user',
    'steps:',
    '  - use: login',
    '  - click: { role: button, name: Entrar }',
    '',
  ].join('\n')
  const { text, applied } = applyFixes(source, [
    { from: { label: 'Usuario o correo' }, to: { placeholder: 'Tu usuario o tu correo' } },
    { from: { role: 'button', name: 'Entrar' }, to: { role: 'button', name: 'Ingresar' } },
  ])
  assert.equal(applied, 2)
  assert.match(text, /^# The login/)
  assert.match(text, /type: \{ target: \{ placeholder: Tu usuario o tu correo \}, text: ana \} # the user/)
  assert.match(text, /click: \{ role: button, name: Ingresar \}/)
})

test('the CI report names each broken step and its fix', () => {
  const md = markdownReport([
    { name: 'ok-video', ok: true, failures: [] },
    { name: 'login', ok: false, failures: [{ step: 4, action: 'click', target: { role: 'button', name: 'Entrar' }, message: '', fix: { to: { role: 'button', name: 'Ingresar' } } }] },
  ])
  assert.match(md, /1 of 2 scripts broken/)
  assert.match(md, /step 4 \(click\): cannot find the button named "Entrar" → try `\{ role: button, name: Ingresar \}`/)
})
