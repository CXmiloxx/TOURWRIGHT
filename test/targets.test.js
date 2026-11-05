import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import YAML from 'yaml'
import { acquireLock } from '#core/lock.js'
import { asTarget, describeTarget, isMissingElement, targetsOf } from '#render/steps/targets.js'
import { validateScript } from '#script/schema.js'

test('a value split by an unquoted comma says how to write it', () => {
  const data = YAML.parse('title: x\nsteps:\n  - type: { target: { placeholder: Nombres, apellidos o celular }, text: ana }\n')
  const r = validateScript(data)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /write placeholder: "Nombres, apellidos o celular"/)
})

test('targets are written the way a script writes them, quoted only when YAML needs it', () => {
  assert.equal(asTarget({ placeholder: 'Tu usuario o tu correo' }), '{ placeholder: Tu usuario o tu correo }')
  assert.equal(asTarget({ placeholder: 'Nombres, apellidos o celular' }), '{ placeholder: "Nombres, apellidos o celular" }')
  assert.equal(asTarget({ role: 'button', name: 'Ingresar' }), '{ role: button, name: Ingresar }')
  assert.equal(describeTarget({ label: 'Usuario o correo' }), 'the field labelled "Usuario o correo"')
  assert.equal(describeTarget({ role: 'button', name: 'Entrar', nth: 1 }), 'the button named "Entrar" (number 2)')
})

test('the targets of a step and the errors that mean "not there"', () => {
  assert.deepEqual(targetsOf('click', { role: 'button', name: 'A' }), [{ role: 'button', name: 'A' }])
  assert.deepEqual(targetsOf('type', { target: { label: 'B' }, text: 'x' }), [{ label: 'B' }])
  assert.deepEqual(targetsOf('drag', { from: '#a', to: '#b' }), ['#a', '#b'])
  assert.deepEqual(targetsOf('say', 'hello'), [])
  assert.equal(isMissingElement(Object.assign(new Error('x'), { name: 'TimeoutError' })), true)
  assert.equal(isMissingElement(new Error('locator.evaluate: Timeout 30000ms exceeded.')), true)
  assert.equal(isMissingElement(new Error('net::ERR_NAME_NOT_RESOLVED')), false)
})

test('the browser lock lets one holder in at a time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-lock-'))
  try {
    const file = join(dir, 'browser.lock')
    const order = []
    const first = await acquireLock(file)
    order.push('first in')
    const second = acquireLock(file).then(release => {
      order.push('second in')
      return release
    })
    await new Promise(r => setTimeout(r, 300))
    assert.deepEqual(order, ['first in'])
    first()
    const release = await second
    assert.deepEqual(order, ['first in', 'second in'])
    release()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mask rules and a preview of some steps are checked like the rest of the script', async () => {
  const { parseSteps } = await import('#render/index.js')
  assert.deepEqual(parseSteps('5'), [5, 5])
  assert.deepEqual(parseSteps('3-6'), [3, 6])
  assert.equal(parseSteps(undefined), null)
  assert.throws(() => parseSteps('6-3'), /range goes up/)
  assert.throws(() => parseSteps('x'), /step number/)
  const ok = validateScript({ title: 't', mask: ['email', 'id', { text: 'Ana Pérez', as: 'Laura Gómez' }, { pattern: 'P-d+', as: 'P-0000' }], steps: [{ goto: '/' }] })
  assert.equal(ok.ok, true)
  const bad = validateScript({ title: 't', mask: ['passport'], steps: [{ goto: '/' }] })
  assert.equal(bad.ok, false)
})
