import assert from 'node:assert/strict'
import { test } from 'node:test'
import YAML from 'yaml'
import { describe, draftScript, keyControls, outline, secretPrefix, sections } from '../src/explore.js'
import { validateScript } from '../src/script/schema.js'

const SNAPSHOT = `- link "Skip to content":
  - /url: "#content"
- complementary:
  - navigation "Main menu":
    - list:
      - listitem:
        - link "Home":
          - /url: /
      - listitem:
        - link "Invoices":
          - /url: /invoices
      - listitem:
        - link "Docs":
          - /url: https://elsewhere.example/docs
- banner:
  - link "New invoice":
    - /url: /invoices/new
- main:
  - heading "Invoices" [level=1]
  - paragraph: Every invoice sent this year, paid or not.
  - button "Export"
  - searchbox "Search by customer"
  - radiogroup "Status":
    - radio "All" [checked]
  - table "Invoices":
    - row "ACME Ltd 1.200 Paid":
      - cell "ACME Ltd"
      - button "Actions for ACME Ltd"
  - button "Send"`

test('an aria snapshot becomes elements with their place on the page; tables are data and skipped', () => {
  const items = outline(SNAPSHOT)
  assert.deepEqual(items.find(i => i.name === 'Invoices' && i.role === 'heading'), { role: 'heading', name: 'Invoices', text: undefined, level: 1, url: undefined, within: ['main'] })
  assert.equal(items.find(i => i.name === 'Home').url, '/')
  assert.ok(!items.some(i => i.name === 'Actions for ACME Ltd'))
  assert.ok(items.some(i => i.name === 'Send'), 'the element after the table is kept')
})

test('a page is described by its heading, its sentence and its targets', () => {
  const d = describe(outline(SNAPSHOT))
  assert.equal(d.heading, 'Invoices')
  assert.equal(d.description, 'Every invoice sent this year, paid or not.')
  assert.deepEqual(d.targets.filter(t => t.role === 'button').map(t => t.name), ['Export', 'Send'])
})

test('sections come from the navigation and the top bar, same origin, no anchors', () => {
  assert.deepEqual(sections(outline(SNAPSHOT), 'https://app.example/'), [
    { name: 'Home', path: '/' },
    { name: 'Invoices', path: '/invoices' },
    { name: 'New invoice', path: '/invoices/new' },
  ])
})

test('the draft is a valid script with one narrated stop per section', () => {
  const page = describe(outline(SNAPSHOT))
  const text = draftScript({
    header: { title: 'App', language: 'en', baseUrl: 'https://app.example', setup: [{ fill: { target: { label: 'Password' }, text: '${secret:APP_PASSWORD}' } }], dismiss: [{ role: 'button', name: 'Skip tour' }] },
    start: '/',
    home: page,
    pages: [{ name: 'Invoices', path: '/invoices', page }],
    site: 'App',
  })
  const r = validateScript(YAML.parse(text))
  assert.equal(r.ok, true, r.errors?.join('\n'))
  assert.match(text, /click: \{ role: link, name: Invoices \}/)
  assert.match(text, /say: "?Invoices\. Every invoice sent this year/)
  assert.match(text, /# +\{ role: button, name: Export \}/)
  assert.match(text, /\$\{secret:APP_PASSWORD\}/)
})

test('a page under two paths (/ and /index.html) is one section', () => {
  const nav = `- navigation "Menu":
  - link "Home":
    - /url: /
  - link "Start":
    - /url: /index.html
  - link "Bills":
    - /url: /bills/index.php
  - link "Bills again":
    - /url: /bills/`
  assert.deepEqual(sections(outline(nav), 'https://app.example/').map(s => s.path), ['/', '/bills/index.php'])
})

test('the secrets of a site are named after its host, starting with a letter', () => {
  assert.equal(secretPrefix('app.example.com'), 'APP')
  assert.equal(secretPrefix('my-app.example.com'), 'MY_APP')
  assert.equal(secretPrefix('127.0.0.1'), 'SITE_127')
  assert.equal(secretPrefix('3d.example'), 'SITE_3D')
})

test('with the login on camera, the draft types each field with a focus and starts logged out', () => {
  const page = describe(outline(SNAPSHOT))
  const login = { path: '/login', user: { label: 'Email', exact: true }, password: { label: 'Password', exact: true }, submit: { role: 'button', name: 'Sign in' }, names: ['APP_USER', 'APP_PASSWORD'] }
  const text = draftScript({
    header: { title: 'App', language: 'en', baseUrl: 'https://app.example', session: 'app.example', sessionCheck: { goto: '/', notUrl: '/login' }, setup: [{ goto: '/login' }] },
    start: '/',
    home: page,
    pages: [{ name: 'Invoices', path: '/invoices', page }],
    site: 'App',
    login,
  })
  const script = YAML.parse(text)
  const r = validateScript(script)
  assert.equal(r.ok, true, r.errors?.join('\n'))
  assert.equal(script.setup, undefined)
  assert.equal(script.session, undefined)
  assert.deepEqual(script.steps[0], { goto: '/login' })
  assert.deepEqual(script.steps.filter(s => s.type).map(s => s.type.text), ['${secret:APP_USER}', '${secret:APP_PASSWORD}'])
  assert.equal(script.steps.find(s => s.focus?.target.name === 'Sign in').focus.click, true)
})

test('a section points at its filters and main buttons first, never at generic controls', () => {
  const page = { targets: [
    { role: 'button', name: 'Elegir la fecha en el calendario' },
    { role: 'searchbox', name: 'Buscar' },
    { role: 'button', name: 'Nueva carga' },
    { role: 'radiogroup', name: 'Estado de las empresas' },
  ] }
  assert.deepEqual(keyControls(page).map(t => t.name), ['Estado de las empresas', 'Nueva carga'])
})
