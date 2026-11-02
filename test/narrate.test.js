import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseJson } from '../src/ai.js'
import { applyNarration, checkLine, narratable } from '../src/narrate.js'
import { hideSecret } from '../src/util.js'

test('the lines a script says are found, with the element each one points at', () => {
  const lines = narratable([
    { goto: '/' },
    { title: { text: 'Acme', say: 'Así se usa Acme.' } },
    { focus: { target: { role: 'button', name: 'Ingresar' }, say: 'Pulsa {Ingresar}.', click: true } },
    { say: 'Listo.' },
    { say: null },
  ])
  assert.deepEqual(lines.map(l => [l.step, l.kind, l.element ?? null]), [[2, 'title', 'Acme'], [3, 'focus', 'Ingresar'], [4, 'say', null]])
})

test('an AI line is used only when it keeps the focus word and says nothing secret', () => {
  const focus = { step: 3, kind: 'focus', before: 'Pulsa {Ingresar}.', element: 'Ingresar' }
  assert.deepEqual(checkLine(focus, 'Con todo listo, pulsa {Ingresar} para entrar.'), { after: 'Con todo listo, pulsa {Ingresar} para entrar.' })
  // The braces are put back around the element's name
  assert.equal(checkLine(focus, 'Con todo listo, pulsa Ingresar para entrar.').after, 'Con todo listo, pulsa {Ingresar} para entrar.')
  assert.equal(checkLine(focus, 'Entra a la aplicación.').kept, 'the focus word was lost')
  assert.equal(checkLine(focus, 'Pulsa {Ingresar} y luego {Salir}.').after, 'Pulsa {Ingresar} y luego Salir.')
  hideSecret('demo-secret-123')
  assert.equal(checkLine(focus, 'Escribe demo-secret-123 y pulsa {Ingresar}.').kept, 'it held a secret')
  assert.equal(checkLine({ step: 4, kind: 'say', before: 'Listo.' }, 'Ya está: {todo} guardado.').after, 'Ya está: todo guardado.')
  assert.equal(checkLine(focus, '').kept, 'empty answer')
})

test('new lines go into the YAML, keeping comments, and never over {{variables}}', () => {
  const source = '# Tour\nsteps:\n  - title: { text: Acme, say: "Así se usa Acme." }  # intro\n  - say: "Hola {{name}}."\n  - focus: { target: { role: button, name: Ingresar }, say: "Pulsa {Ingresar}.", click: true }\n'
  const { text, applied } = applyNarration(source, [
    { step: 1, kind: 'title', before: 'Así se usa Acme.', after: 'Bienvenido a Acme.' },
    { step: 2, kind: 'say', before: 'Hola Ana.', after: 'Hola, Ana.' },
    { step: 3, kind: 'focus', before: 'Pulsa {Ingresar}.', after: 'Con todo listo, pulsa {Ingresar}.' },
  ])
  assert.equal(applied, 2)
  assert.match(text, /^# Tour/)
  assert.match(text, /title: \{ text: Acme, say: "Bienvenido a Acme\." \} # intro/)
  assert.match(text, /say: "Hola \{\{name\}\}\."/)
  assert.match(text, /say: "Con todo listo, pulsa \{Ingresar\}\."/)
  assert.throws(() => applyNarration('steps:\n  - use: login\n', [{ step: 1, kind: 'say', before: 'a', after: 'b' }]), /copy the new lines by hand/)
})

test('the JSON in an answer is found also inside prose or a code fence', () => {
  assert.deepEqual(parseJson('Here it is:\n```json\n{"lines": []}\n```'), { lines: [] })
  assert.throws(() => parseJson('no json'), /did not answer JSON/)
})
