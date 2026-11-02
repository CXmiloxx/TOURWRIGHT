import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { guideEntry, writeGuide } from '../src/guide.js'

test('each step says what to do, in plain words, and never a secret', () => {
  assert.deepEqual(guideEntry({ chapter: 'Clientes' }), { kind: 'section', text: 'Clientes' })
  assert.equal(guideEntry({ say: 'Esto es <b>Acme</b>. [[400ms]] Bienvenido.' })?.text, 'Esto es Acme. Bienvenido.')
  assert.equal(guideEntry({ focus: { target: { role: 'link', name: 'Facturas' }, say: 'Abre {Facturas} en el menú.', click: true } })?.text, 'Abre Facturas en el menú.')
  assert.equal(guideEntry({ click: { role: 'button', name: 'Guardar' } })?.text, 'Haz clic en «Guardar».')
  assert.equal(guideEntry({ type: { target: { label: 'Contraseña' }, text: '${secret:APP_PASSWORD}' } })?.text, 'Escribe en «Contraseña» (el valor no se muestra).')
  assert.equal(guideEntry({ type: { target: { label: 'Código' }, text: '⟦totp:ABC⟧' } })?.example, '')
  assert.equal(guideEntry({ type: { target: { placeholder: 'Buscar' }, text: 'PEDRO' } })?.example, 'Por ejemplo: «PEDRO».')
  assert.equal(guideEntry({ select: { target: { label: 'Cliente' }, value: 'Luis' } }, 'en')?.text, 'In "Cliente", choose "Luis".')
  assert.equal(guideEntry({ highlight: { target: 'table' } })?.kind, 'look')
  assert.equal(guideEntry({ pause: 500 }), null)
})

test('the guide is one HTML file with its pictures inside, and Markdown with its pictures beside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-guide-'))
  try {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const out = writeGuide({
      title: 'Acme',
      entries: [
        { kind: 'section', text: 'Iniciar sesión' },
        { kind: 'step', text: 'Escribe tu correo.', detail: 'Por ejemplo: «ana@acme.test».', image: jpeg },
        { kind: 'text', text: 'Así se ven los clientes.', image: jpeg },
        { kind: 'step', text: 'Pulsa <Ingresar>.' },
      ],
      out: join(dir, 'acme'),
    })
    assert.equal(out.steps, 2)
    const html = readFileSync(out.html, 'utf8')
    assert.match(html, /<h2>Iniciar sesión<\/h2>/)
    assert.match(html, /data:image\/jpeg;base64,/)
    assert.match(html, /Pulsa &lt;Ingresar&gt;\./)
    const md = readFileSync(out.markdown, 'utf8')
    assert.match(md, /\*\*1\.\*\* Escribe tu correo\. Por ejemplo: «ana@acme\.test»\./)
    assert.match(md, /!\[Paso 1\]\(acme\.guide\/01\.jpg\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
