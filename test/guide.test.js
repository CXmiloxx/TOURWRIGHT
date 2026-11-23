import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig } from '#core/config.js'
import { findChromium } from '#render/browser/chromium.js'
import { contrast, inkOn } from '#render/guide/layout.js'
import { countPages, printGuide } from '#render/guide/pdf.js'
import { guideEntry, writeGuide } from '#render/guide/write.js'

const config = loadConfig()
const missing = (await findChromium(config)).source === 'missing' && 'no browser'

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
    assert.match(html, /<div class="keep"><h2 id="s1">Iniciar sesión<\/h2>/)
    assert.match(html, /data:image\/jpeg;base64,/)
    assert.match(html, /Pulsa &lt;Ingresar&gt;\./)
    const md = readFileSync(out.markdown, 'utf8')
    assert.match(md, /\*\*1\.\*\* Escribe tu correo\. Por ejemplo: «ana@acme\.test»\./)
    assert.match(md, /!\[Paso 1\]\(acme\.guide\/01\.jpg\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the guide wears the brand: accent, readable ink on it, logo; a closing section with nothing after it is left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-guide-'))
  try {
    const out = writeGuide({
      title: 'Acme </style><script>x</script> "uno"',
      theme: { accent: '#FF6B1A', font: '"Plus Jakarta Sans", sans-serif', logo: 'data:image/png;base64,AAAA' },
      entries: [
        { kind: 'section', text: 'Inicio' },
        { kind: 'step', text: 'Pulsa Ingresar.' },
        { kind: 'section', text: 'Hecho con Acme' },
      ],
      out: join(dir, 'acme'),
    })
    assert.equal(out.accent, '#FF6B1A')
    const html = readFileSync(out.html, 'utf8')
    assert.match(html, /--accent: #FF6B1A; --on-accent: #1f2330/)
    assert.match(html, /class="logo" src="data:image\/png;base64,AAAA"/)
    assert.doesNotMatch(html, /Hecho con Acme/)
    // The title in the PDF footer is a CSS string: it can never close the style or the string
    assert.equal((html.match(/<\/style>/g) ?? []).length, 1)
    assert.doesNotMatch(html, /<script>/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ink on the accent reads (WCAG contrast)', () => {
  assert.equal(inkOn('#FF6B1A'), '#1f2330')
  assert.equal(inkOn('#1E3A8A'), '#ffffff')
  assert.equal(inkOn('tomato'), '#ffffff')
  assert.ok(Math.abs((contrast('#000000', '#ffffff') ?? 0) - 21) < 0.01)
  assert.equal(contrast('red', '#fff'), null)
})

test('the guide prints as a PDF: A4, its pages counted, the cover first', { skip: missing }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-guide-'))
  try {
    const g = writeGuide({ title: 'Acme', entries: [{ kind: 'section', text: 'Uno' }, { kind: 'step', text: 'Pulsa.' }, { kind: 'section', text: 'Dos' }, { kind: 'step', text: 'Escribe.' }], out: join(dir, 'acme') })
    const pdf = await printGuide({ html: g.html, out: join(dir, 'acme.guide.pdf'), title: 'Acme' }, config)
    const bytes = readFileSync(pdf.path)
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
    assert.equal(pdf.pages, 2)
    assert.equal(countPages(bytes), 2)
    // The job's time limit stops the print: its browser closes and nothing is written
    const stop = new AbortController()
    stop.abort()
    await assert.rejects(printGuide({ html: g.html, out: join(dir, 'late.guide.pdf'), title: 'Acme', signal: stop.signal }, config), /stopped/)
    assert.equal(existsSync(join(dir, 'late.guide.pdf')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
