import assert from 'node:assert/strict'
import { test } from 'node:test'
import YAML from 'yaml'
import { recordedScript, stepsFrom } from '../src/record.js'
import { validateScript } from '../src/script/schema.js'

test('a recording becomes steps with a first narration, and passwords become secrets', () => {
  const steps = stepsFrom([
    { action: 'goto', url: 'https://app.example.com/login' },
    { action: 'type', target: { label: 'Correo' }, text: 'ana@acme.com' },
    { action: 'type', target: { label: 'Contraseña' }, text: 'hunter2', password: true },
    // The same field again (Enter after change): one step
    { action: 'type', target: { label: 'Contraseña' }, text: 'hunter2', password: true },
    { action: 'press', key: 'Enter' },
    { action: 'click', target: { role: 'link', name: 'Facturas' } },
    { action: 'select', target: { label: 'Estado' }, value: 'pagada' },
    { action: 'check', target: { label: 'Solo este mes' } },
  ], { secret: 'APP' })
  const text = recordedScript({ title: 'App', language: 'es', url: 'https://app.example.com/login', steps })
  assert.ok(!text.includes('hunter2'), 'the password is never written')
  assert.match(text, /type: \{ target: \{ label: Contraseña \}, text: "\$\{secret:APP_PASSWORD\}" \}/)
  assert.match(text, /focus: \{ target: \{ role: link, name: Facturas \}, say: "Abre \{Facturas\}\.", click: true \}/)
  assert.equal(steps.filter(s => s.type).length, 2)
  const parsed = YAML.parse(text)
  assert.equal(validateScript(parsed).ok, true, JSON.stringify(validateScript(parsed).errors))
})

test('the narration says where the element is, and logins keep nothing personal', () => {
  const steps = stepsFrom([
    { action: 'goto', url: 'https://app.example.com/login' },
    { action: 'type', target: { placeholder: 'Tu usuario o tu correo' }, text: 'ana@acme.com', where: 'user', screen: 'Iniciar sesión' },
    { action: 'type', target: { label: 'Código de verificación' }, text: '123456', where: 'otp', screen: 'Verificación' },
    { action: 'press', key: 'Enter', screen: 'Verificación' },
    // The field says its value again as the page changes: no second step
    { action: 'type', target: { label: 'Código de verificación' }, text: '123456', where: 'otp', screen: 'Verificación' },
    { action: 'click', target: { role: 'link', name: 'Clientes' }, where: 'menu', screen: 'Inicio' },
    { action: 'type', target: { placeholder: 'Documento, nombres o celular' }, text: 'PEDRO', where: 'search', screen: 'Clientes' },
    { action: 'click', target: { role: 'button', name: 'Guardar' }, where: 'save', screen: 'Clientes' },
  ], { secret: 'APP' })
  const says = steps.filter(s => s.focus).map(s => s.focus.say)
  assert.deepEqual(says, [
    'Escribe tu {usuario o tu correo}.',
    'Escribe el {código} de tu aplicación de autenticación.',
    'Abre {Clientes} en el menú.',
    'Para buscar, escribe en {documento, nombres o celular}.',
    'Cuando todo esté listo, pulsa {Guardar}.',
  ])
  assert.deepEqual(steps.filter(s => s.chapter).map(s => s.chapter), ['Iniciar sesión', 'Verificación', 'Inicio', 'Clientes'])
  const typed = steps.filter(s => s.type).map(s => s.type.text)
  assert.deepEqual(typed, ['${secret:APP_USER}', '${totp:APP_TOTP}', 'PEDRO'])
})

test('the studio look: zoom on fields, a pulse on the button that sends, the theme and a closing card', async () => {
  const { stepsFrom, recordedScript, outroStep, studioTheme, secretsTyped } = await import('../src/record.js')
  const events = [
    { action: 'goto', url: 'https://app.acme.test/login' },
    { action: 'look', accent: '#2563eb' },
    { action: 'type', target: { label: 'Usuario' }, text: 'ana@acme.test', where: 'user', screen: 'Ingresar' },
    { action: 'type', target: { label: 'Contraseña' }, text: 's3cret', password: true, where: 'password', screen: 'Ingresar' },
    { action: 'click', target: { role: 'button', name: 'Ingresar' }, where: 'submit', screen: 'Ingresar' },
  ]
  const steps = stepsFrom(events, { secret: 'ACME', studio: true })
  const focus = steps.filter(s => s.focus).map(s => s.focus)
  assert.deepEqual(focus.map(f => f.zoom), [1.3, 1.3, undefined])
  assert.equal(focus[2].pulse, true)
  assert.ok(!steps.some(s => s.look), 'the color is not a step')
  // Without the studio look nothing changes
  assert.ok(stepsFrom(events, { secret: 'ACME' }).every(s => !s.focus?.zoom && !s.focus?.pulse))
  assert.deepEqual(secretsTyped(events, 'ACME'), { ACME_USER: 'ana@acme.test', ACME_PASSWORD: 's3cret' })
  const yaml = recordedScript({ title: 'Acme', language: 'es', url: 'https://app.acme.test/login', steps: [...steps, outroStep('Acme')], theme: studioTheme('#2563eb'), audio: { clicks: true } })
  assert.match(yaml, /^theme: \{ frame: window, accent: "#2563eb", titleBackground: aurora \}$/m)
  assert.match(yaml, /^audio: \{ clicks: true \}$/m)
  assert.match(yaml, /title: \{ text: ¡Listo!, subtitle: Ya sabes usar Acme, animation: zoom \}/)
  assert.ok(!yaml.includes('s3cret') && !yaml.includes('ana@acme.test'), 'what was typed in the login stays out of the script')
  const { fromData, parseText } = await import('../src/script/load.js')
  assert.ok(fromData(parseText(yaml)).script.theme.frame === 'window')
})
