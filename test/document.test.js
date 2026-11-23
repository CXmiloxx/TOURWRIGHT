// The documents of a script: its Markdown, the Word file, the zip under it, the layout review and --compare.
// The comparison needs ffmpeg (skipped without it).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { test } from 'node:test'
import { loadConfig } from '#core/config.js'
import { entryHtml, entryMarkdown } from '#render/guide/blocks.js'
import { jpegSize } from '#render/guide/logo.js'
import { layoutFindings } from '#render/guide/review.js'
import { writeGuide } from '#render/guide/write.js'
import { crc32, zip } from '#render/guide/zip.js'
import { markdownHtml, parseMarkdown } from '#script/markdown.js'
import { validateScript } from '#script/schema.js'
import { compareGuides, matchSteps } from '#video/compare.js'
import { ffmpeg } from '#video/ffmpeg.js'

const config = loadConfig()
const words = { step: 'Paso', tones: { info: 'Nota', ok: 'Listo', warn: 'Atención' } }

test('the Markdown of a script: its small subset, and nothing that runs', () => {
  assert.deepEqual(parseMarkdown('# Hola\n\nUna **línea**\nque sigue.\n\n- uno\n- dos\n\n1. a\n2. b').map(b => b.type), ['h', 'p', 'ul', 'ol'])
  assert.equal(markdownHtml('Ver *esto* y `x`'), '<p>Ver <em>esto</em> y <code>x</code></p>')
  assert.equal(markdownHtml('[sitio](https://a.test)'), '<p><a href="https://a.test">sitio</a></p>')
  // A link that would run code is only its text; raw HTML is text
  assert.equal(markdownHtml('[clic](javascript:alert(1))'), '<p>clic</p>')
  assert.equal(markdownHtml('<script>alert(1)</script> <img src=x onerror=y>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=y&gt;</p>')
  assert.equal(markdownHtml('## Título'), '<h4>Título</h4>')
})

test('content steps are valid script steps; a wrong one is said', () => {
  const ok = validateScript({
    baseUrl: 'https://a.test',
    document: { paper: 'Letter', cover: 'dark', subtitle: 'Para soporte' },
    export: ['pdf', 'docx'],
    steps: [
      { md: 'Hola' }, { note: { md: 'Cuidado', tone: 'warn' } }, { table: { columns: ['A', 'B'], rows: [['1', 2]] } },
      { shot: true }, { shot: { caption: 'La lista', target: { role: 'table' } } }, { gallery: { columns: 4, shots: [{ goto: '/m', caption: 'Móvil' }] } }, { pageBreak: true },
    ],
  })
  assert.equal(ok.ok, true, ok.errors?.join('\n'))
  assert.equal(validateScript({ steps: [{ note: { md: 'x', tone: 'red' } }] }).ok, false)
  assert.equal(validateScript({ document: { paper: 'A3' }, steps: [{ md: 'x' }] }).ok, false)
})

test('each block as HTML and as Markdown, with what came from the script escaped', () => {
  const table = { kind: 'table', columns: ['Estado', 'Quién'], rows: [['<b>Borrador</b>', 'a|b']] }
  assert.match(entryHtml(table, { n: 0, words }), /<td>&lt;b&gt;Borrador&lt;\/b&gt;<\/td>/)
  assert.deepEqual(entryMarkdown(table, { n: 0, words, dir: 'x' }).slice(0, 3), ['| Estado | Quién |', '| --- | --- |', '| &lt;b>Borrador&lt;/b> | a\\|b |'])
  assert.match(entryHtml({ kind: 'note', md: 'Ojo', tone: 'warn' }, { n: 0, words }), /class="note note-warn"/)
  assert.deepEqual(entryMarkdown({ kind: 'note', md: 'Ojo', tone: 'warn' }, { n: 0, words, dir: 'x' }), ['> **Atención:** Ojo', ''])
  assert.match(entryHtml({ kind: 'gallery', columns: 4, items: [] }, { n: 0, words }), /--cols:4/)
})

test('the zip is one a standard tool can read back', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  const dir = mkdtempSync(join(tmpdir(), 'tw-zip-'))
  try {
    const file = join(dir, 'a.zip')
    writeFileSync(file, zip([{ name: 'a.txt', data: 'hola '.repeat(100) }, { name: 'b/c.jpeg', data: Buffer.from([1, 2, 3]) }]))
    const bytes = readFileSync(file)
    assert.equal(bytes.readUInt32LE(0), 0x04034b50)
    // The first entry, deflated: its bytes come back
    const nameLength = bytes.readUInt16LE(26)
    const size = bytes.readUInt32LE(18)
    assert.equal(zlib.inflateRawSync(bytes.subarray(30 + nameLength, 30 + nameLength + size)).toString(), 'hola '.repeat(100))
    try {
      assert.match(execFileSync('unzip', ['-l', file], { encoding: 'utf8' }), /b\/c\.jpeg/)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the guide as a Word file: its parts, the brand and the paper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-docx-'))
  try {
    // A 2×1 JPEG's frame header is enough for its size
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x02, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9])
    assert.deepEqual(jpegSize(jpeg), { width: 2, height: 1 })
    const g = writeGuide({
      title: 'Acme & Cía',
      theme: { accent: '#FF6B1A', font: '"Plus Jakarta Sans", sans-serif' },
      document: { paper: 'Letter', subtitle: 'Para soporte' },
      entries: [
        { kind: 'section', text: 'Inicio' }, { kind: 'step', text: 'Pulsa Ingresar.', image: jpeg },
        { kind: 'md', md: 'Lee [esto](https://a.test).' }, { kind: 'table', columns: ['A'], rows: [['1']] },
        { kind: 'section', text: 'Otra' }, { kind: 'shot', caption: 'La lista', image: jpeg }, { kind: 'break' },
      ],
      out: join(dir, 'acme'),
      docx: true,
    })
    const bytes = readFileSync(g.docx)
    assert.equal(bytes.subarray(0, 2).toString(), 'PK')
    const text = bytes.toString('latin1')
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/footer1.xml', 'word/media/image1.jpeg', 'word/media/image2.jpeg']) assert.ok(text.includes(part), part)
    // Steps in order for --compare: the step and the named picture
    assert.deepEqual(JSON.parse(readFileSync(g.json, 'utf8')).steps.map(s => s.text), ['Pulsa Ingresar.', 'La lista'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the layout review finds a page left half empty and a picture taller than a page', () => {
  const page = 1000
  assert.deepEqual(layoutFindings([{ height: 300, label: 'a' }, { height: 300, label: 'b' }], page), [])
  const gap = layoutFindings([{ height: 400, label: 'a' }, { height: 700, label: 'step 2' }], page)
  assert.equal(gap.length, 1)
  assert.match(gap[0].message, /60% left blank before step 2/)
  // A page break asked for is never a finding
  assert.deepEqual(layoutFindings([{ height: 100, label: 'a' }, { height: 0, forced: true, label: 'break' }, { height: 100, label: 'b' }], page), [])
  assert.equal(layoutFindings([{ height: 1400, tall: true, label: 'a picture' }], page)[0].kind, 'tall-picture')
})

test('steps of two guides are matched by their text, in order', () => {
  const before = [{ text: 'Abre' }, { text: 'Pulsa' }, { text: 'Guarda' }]
  const after = [{ text: 'Abre' }, { text: 'Escribe' }, { text: 'Pulsa' }]
  assert.deepEqual(matchSteps(before, after), { pairs: [[0, 0], [1, 2]], added: [1], removed: [2] })
})

test('--compare says which step changed on screen', { skip: !config.ffmpeg && 'ffmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-compare-'))
  try {
    const guide = async (name, steps) => {
      mkdirSync(join(dir, `${name}.guide`), { recursive: true })
      for (const s of steps) await ffmpeg(['-f', 'lavfi', '-i', s.source, '-frames:v', '1', join(dir, `${name}.guide`, s.file)], config)
      writeFileSync(join(dir, `${name}.guide.json`), JSON.stringify({ steps: steps.map(({ source, ...s }) => s) }))
      return join(dir, `${name}.guide.json`)
    }
    const same = 'testsrc=s=320x200:d=1'
    const a = await guide('a', [{ n: 1, text: 'Abre', file: '01.jpg', source: same }, { n: 2, text: 'Pulsa', file: '02.jpg', source: same }])
    const b = await guide('b', [{ n: 1, text: 'Abre', file: '01.jpg', source: same }, { n: 2, text: 'Pulsa', file: '02.jpg', source: 'color=c=red:s=320x200:d=1' }])
    const r = await compareGuides(a, b, {}, config)
    assert.equal(r.same, 1)
    assert.deepEqual(r.changed.map(c => c.text), ['Pulsa'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a goto that fails for a moment is tried again; a refused one is said at once', async () => {
  const { gotoRetrying } = await import('#render/browser/goto.js')
  let calls = 0
  /** @type {any} */
  const flaky = { goto: async () => (++calls < 2 ? Promise.reject(new Error('net::ERR_CONNECTION_RESET at https://a.test')) : 'ok') }
  // The new try runs inside `retrying` (a filmed goto cuts it from the video)
  let cut = 0
  assert.equal(await gotoRetrying(flaky, 'https://a.test', {}, fn => {
    cut++
    return fn()
  }), 'ok')
  assert.equal(calls, 2)
  assert.equal(cut, 1)
  calls = 0
  /** @type {any} */
  const refused = {
    goto: async () => {
      calls++
      throw new Error('net::ERR_CONNECTION_REFUSED')
    },
  }
  await assert.rejects(gotoRetrying(refused, 'https://a.test'), /REFUSED/)
  assert.equal(calls, 1)
})

test('the logo: its size from the file, drawn at a height in the page header; header and footer on every page', async () => {
  const { headerImage, readLogo } = await import('#render/guide/logo.js')
  // A 1×1 PNG and the IHDR of an 800×160 one
  const png = Buffer.alloc(33)
  png.write('\x89PNG\r\n\x1a\n', 0, 'latin1')
  png.writeUInt32BE(13, 8)
  png.write('IHDR', 12, 'latin1')
  png.writeUInt32BE(800, 16)
  png.writeUInt32BE(160, 20)
  const url = `data:image/png;base64,${png.toString('base64')}`
  assert.deepEqual({ ...readLogo(url), bytes: undefined }, { type: 'png', bytes: undefined, width: 800, height: 160 })
  assert.equal(headerImage(url, 20), `image-set(url("${url}") 8.000x)`)
  assert.equal(readLogo('https://a.test/logo.png'), null)
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"></svg>').toString('base64')}`
  assert.deepEqual([readLogo(svg)?.width, readLogo(svg)?.height], [120, 30])
  const dir = mkdtempSync(join(tmpdir(), 'tw-brand-'))
  try {
    const g = writeGuide({
      title: 'Acme', theme: { accent: '#0052CC', logo: url }, document: { footer: 'Acme · acme.test', coverLogo: url },
      entries: [{ kind: 'section', text: 'Uno' }, { kind: 'md', md: 'Hola' }], out: join(dir, 'acme'), docx: true,
    })
    const html = readFileSync(g.html, 'utf8')
    assert.match(html, /@top-left \{ content: image-set\(url\("data:image\/png/)
    assert.match(html, /@bottom-left \{ content: "Acme · acme\.test"/)
    assert.match(html, /"Página" " " counter\(page\) " " "de" " " counter\(pages\)/)
    assert.match(html, /<div class="foot">Acme · acme\.test<\/div>/)
    const docx = readFileSync(g.docx).toString('latin1')
    for (const part of ['word/header1.xml', 'word/_rels/header1.xml.rels', 'word/media/image1.png']) assert.ok(docx.includes(part), part)
    // No header asked for: the footer stays, the header goes
    const plain = readFileSync(writeGuide({ title: 'Acme', document: { header: false }, entries: [{ kind: 'md', md: 'x' }], out: join(dir, 'b') }).html, 'utf8')
    assert.doesNotMatch(plain, /@top-left \{ content: (?!none)/)
    assert.match(plain, /@bottom-right/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('from the API, a Markdown guide goes out zipped with the pictures it links', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { packMarkdownGuides } = await import('#server/worker.js')
  const dir = mkdtempSync(join(tmpdir(), 'tw-pack-'))
  try {
    writeFileSync(join(dir, 'tour.guide.md'), '![](tour.guide/01.jpg)')
    mkdirSync(join(dir, 'tour.guide'))
    writeFileSync(join(dir, 'tour.guide', '01.jpg'), 'jpg')
    packMarkdownGuides(dir)
    assert.deepEqual(readdirSync(dir).sort(), ['tour.guide', 'tour.guide.zip'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a logo cannot close the CSS or HTML around it, and the printer fetches nothing', async () => {
  const { headerImage, logoUrl } = await import('#render/guide/logo.js')
  const evil = 'data:image/svg+xml,<svg width="10" height="10"/></style><script>alert(1)</script>'
  const css = headerImage(evil, 22)
  assert.ok(css && !/[<>"']/.test(css.replace(/^url\("|"\)$/g, '')), css ?? 'null')
  assert.match(String(logoUrl(evil)), /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/)
  // A URL is not something a document fetches
  assert.equal(logoUrl('http://169.254.169.254/latest'), null)
})
