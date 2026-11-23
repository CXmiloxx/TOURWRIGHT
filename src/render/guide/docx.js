// The guide as a Word file (.docx): the same entries as the HTML, with the script's brand (accent, font) and
// its `document` options (paper, cover, contents). Plain OOXML in a zip: no dependency, opens in Word,
// LibreOffice and Google Docs.
import { writeFileSync } from 'node:fs'
import { parseMarkdown } from '#script/markdown.js'
import { pageAccent } from './layout.js'
import { jpegSize, readLogo } from './logo.js'
import { zip } from './zip.js'

// Word's units: twips (1/1440 in) for the page, EMU (1/914400 in) for pictures, half-points for text
const MM_TWIP = 56.7
const MM_EMU = 36_000
const PAPER = { A4: { w: 11906, h: 16838, mm: 210 }, Letter: { w: 12240, h: 15840, mm: 215.9 } }
const MARGIN_MM = 20

// Text in XML: escaped, and without the control characters XML 1.0 refuses
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters taken out
const x = text => String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const hex = color => (/^#[\da-f]{6}$/i.test(String(color ?? '')) ? color.slice(1).toUpperCase() : /^#[\da-f]{3}$/i.test(String(color ?? '')) ? [...color.slice(1)].map(c => c + c).join('').toUpperCase() : '4F46E5')

// The first family of a CSS font list that Word can name: "Plus Jakarta Sans", system-ui → Plus Jakarta Sans
const fontName = css => {
  const generic = /^(system-ui|-apple-system|sans-serif|serif|monospace|ui-\w+|BlinkMacSystemFont)$/i
  const first = String(css ?? '').split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).find(f => f && !generic.test(f))
  return first && /^[\w .-]{1,60}$/.test(first) ? first : 'Calibri'
}

const run = (text, { bold = false, italic = false, code = false, color = null, size = null } = {}) =>
  `<w:r><w:rPr>${code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}` +
  `${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>`

const para = (runs, { style = null, spacing = null, keepNext = false, align = null, shade = null, border = null, indent = null } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}` +
  `${border ? `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${border}"/></w:pBdr>` : ''}` +
  `${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}${spacing ? `<w:spacing ${spacing}/>` : ''}` +
  `${indent ? `<w:ind w:left="${indent}"/>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runs}</w:p>`

/**
 * @param {{ title: string, language?: string, theme?: Record<string, any> | null, document?: Record<string, any>,
 *   entries: Record<string, any>[], toc: { id: string, text: string }[], words: Record<string, any>, out: string }} guide
 * @returns {string} the file written
 */
export const writeDocx = ({ title, language = 'es', theme = null, document = {}, entries, toc, words, out }) => {
  // The same accent as the PDF: a pale one would leave headings unreadable on the white page
  const accent = hex(pageAccent(theme?.accent ?? '#4f46e5'))
  const font = fontName(theme?.font)
  const paper = PAPER[document.paper ?? 'A4'] ?? PAPER.A4
  const contentMm = paper.mm - MARGIN_MM * 2
  const media = []
  const links = []
  let ids = 0

  // A picture `cx`×`cy` EMU from the media of the file (rid), with a light border or none (a logo)
  const drawing = (rid, cx, cy, border = true) => {
    const id = ++ids
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
      `${border ? '<a:ln w="9525"><a:solidFill><a:srgbClr val="E3E5EC"/></a:solidFill></a:ln>' : ''}</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  }
  /** Adds a file to the media; its relationship id */
  const addMedia = (data, ext) => {
    media.push({ data, ext })
    return `rIdImg${media.length}`
  }
  // A picture at most the width of the text and 150 mm tall, in its own shape
  const picture = (image, maxMm = contentMm, maxHeightMm = 150) => {
    if (!image) return ''
    const size = jpegSize(image) ?? { width: 1280, height: 800 }
    const scale = Math.min(maxMm / size.width, maxHeightMm / size.height)
    return drawing(addMedia(image, 'jpeg'), Math.round(size.width * scale * MM_EMU), Math.round(size.height * scale * MM_EMU))
  }
  // The brand's logo (PNG or JPEG: Word draws neither SVG nor WebP), `heightMm` tall
  const brand = readLogo(theme?.logo)
  const wordLogo = brand && (brand.type === 'png' || brand.type === 'jpeg') ? brand : null
  const logoRid = wordLogo ? addMedia(wordLogo.bytes, wordLogo.type === 'png' ? 'png' : 'jpeg') : null
  const logoDrawing = heightMm => {
    if (!wordLogo) return ''
    const scale = Math.min(heightMm / wordLogo.height, (heightMm * 6) / wordLogo.width)
    return drawing(logoRid, Math.round(wordLogo.width * scale * MM_EMU), Math.round(wordLogo.height * scale * MM_EMU), false)
  }
  const caption = text => (text ? para(run(text, { italic: true, color: '5D6475', size: 18 }), { align: 'center', spacing: 'w:after="160"' }) : '')

  // Markdown blocks as Word paragraphs; links become hyperlinks
  const inlines = list => list.map(i => {
    const r = run(i.text, { bold: i.bold, italic: i.italic, code: i.code, color: i.href ? accent : null })
    if (!i.href) return r
    links.push(i.href)
    return `<w:hyperlink r:id="rIdLink${links.length}">${r}</w:hyperlink>`
  }).join('')
  const markdown = (md, opts = {}) => parseMarkdown(md).map(b => {
    if (b.type === 'p') return para(inlines(b.inlines), opts)
    if (b.type === 'h') return para(inlines(b.inlines), { ...opts, style: `Heading${Math.min(3, b.level + 1)}`, keepNext: true })
    return b.items.map((item, i) => para(run(b.type === 'ol' ? `${i + 1}. ` : '• ') + inlines(item), { ...opts, indent: 360 })).join('')
  }).join('')

  const table = e => {
    const cell = (text, head) => `<w:tc><w:tcPr>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F5F6F9"/>' : ''}</w:tcPr>${para(run(text, { bold: head, size: 20 }))}</w:tc>`
    const border = side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="E3E5EC"/>`
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${e.columns.map(c => cell(c, true)).join('')}</w:tr>` +
      `${e.rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${e.columns.map((_, i) => cell(r[i] ?? '', false)).join('')}</w:tr>`).join('')}</w:tbl>${caption(e.caption)}`
  }

  const gallery = e => {
    const cols = Math.max(1, Math.min(6, Number(e.columns) || 3))
    const width = (contentMm - (cols - 1) * 4) / cols
    const rows = []
    for (let i = 0; i < e.items.length; i += cols) rows.push(e.items.slice(i, i + cols))
    const cell = item => `<w:tc><w:tcPr><w:tcW w:w="${Math.round(width * MM_TWIP)}" w:type="dxa"/></w:tcPr>` +
      `${para(item ? picture(item.image, width, 110) : '', { align: 'center' })}${item ? caption(item.caption) : para('')}</w:tc>`
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
      rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: cols }, (_, i) => cell(r[i])).join('')}</w:tr>`).join('') + '</w:tbl>'
  }

  const body = []
  // The cover: title, subtitle, how many steps, the contents; then a new page
  if (document.cover !== 'none') {
    const steps = entries.filter(e => e.kind === 'step').length
    body.push(wordLogo ? para(logoDrawing(16), { spacing: 'w:before="600" w:after="1800"' }) : para('', { spacing: 'w:before="2400"' }))
    body.push(para(run(title), { style: 'Title' }))
    if (document.subtitle) body.push(para(run(document.subtitle, { color: '5D6475', size: 32 })))
    body.push(steps ? para(run(words.steps(steps), { color: '5D6475' }), { spacing: 'w:after="600"' }) : para('', { spacing: 'w:after="600"' }))
    if ((document.toc ?? toc.length > 1) && toc.length) {
      body.push(para(run(words.contents, { bold: true })))
      toc.forEach((s, i) => body.push(para(run(`${i + 1}. ${s.text}`), { indent: 360 })))
    }
    body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
  } else body.push(para(run(title), { style: 'Title' }))

  for (const e of entries) {
    switch (e.kind) {
      case 'section': body.push(para(run(e.text), { style: 'Heading1', keepNext: true })); break
      case 'step': {
        const text = [e.text, e.detail].filter(Boolean).join(' ')
        body.push(para(run(`${e.n}  `, { bold: true, color: accent }) + run(text), { keepNext: Boolean(e.image), spacing: 'w:before="200" w:after="80"' }))
        if (e.image) body.push(para(picture(e.image), { indent: 0 }))
        break
      }
      case 'text':
        if (e.text) body.push(para(run(e.text, { color: '5D6475' }), { keepNext: Boolean(e.image) }))
        if (e.image) body.push(para(picture(e.image)))
        break
      case 'md': body.push(markdown(e.md)); break
      case 'note': {
        const fill = { ok: '16A34A', warn: 'D97706' }[e.tone] ?? accent
        body.push(markdown(e.md, { shade: 'F5F6F9', border: fill }))
        break
      }
      case 'table': body.push(table(e)); break
      case 'shot': body.push(para(picture(e.image), { align: 'center', keepNext: Boolean(e.caption) }), caption(e.caption)); break
      case 'gallery': body.push(gallery(e)); break
      case 'break': body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); break
    }
  }

  const margin = Math.round(MARGIN_MM * MM_TWIP)
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body.join('')}` +
    `<w:sectPr>${document.header !== false ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ''}<w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${paper.w}" w:h="${paper.h}"/>` +
    `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="567" w:footer="510" w:gutter="0"/>` +
    `${document.cover !== 'none' ? '<w:titlePg/>' : ''}</w:sectPr></w:body></w:document>`
  // The header (the logo, the title, a line in the accent) and the footer (the footer text, «page N of M» from
  // Word's own fields, a light line), on every page but the cover
  const field = name => `<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5D6475"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5D6475"/></w:rPr><w:instrText xml:space="preserve"> ${name} </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5D6475"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5D6475"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5D6475"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`
  const right = `<w:tabs><w:tab w:val="right" w:pos="${Math.round(contentMm * MM_TWIP)}"/></w:tabs>`
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${ns}><w:p><w:pPr>${right}` +
    `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="${accent}"/></w:pBdr></w:pPr>` +
    `${wordLogo ? logoDrawing(6) : run(title, { bold: true, color: accent, size: 18 })}<w:r><w:tab/></w:r>${wordLogo ? run(title, { color: '5D6475', size: 16 }) : ''}</w:p></w:hdr>`
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${ns}><w:p><w:pPr>${right}` +
    '<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="D5D8E0"/></w:pBdr></w:pPr>' +
    `${run(document.footer ?? title, { color: '5D6475', size: 16 })}<w:r><w:tab/></w:r>${run(`${words.page} `, { color: '5D6475', size: 16 })}${field('PAGE')}${run(` ${words.of} `, { color: '5D6475', size: 16 })}${field('NUMPAGES')}</w:p></w:ftr>`
  const heading = (id, name, size, color) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="${id === 'Title' ? 0 : Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${x(font)}" w:hAnsi="${x(font)}" w:cs="${x(font)}"/><w:sz w:val="22"/><w:color w:val="1F2330"/><w:lang w:val="${x(language)}"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading('Title', 'Title', 56, '1F2330') + heading('Heading1', 'heading 1', 36, accent) + heading('Heading2', 'heading 2', 28, '1F2330') + heading('Heading3', 'heading 3', 24, '1F2330') +
    '</w:styles>'
  const rels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
    ...media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.${m.ext}"/>`),
    ...links.map((href, i) => `<Relationship Id="rIdLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${x(href)}" TargetMode="External"/>`),
  ]
  const file = zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:title>${x(title)}</dc:title><dc:language>${x(language)}</dc:language></cp:coreProperties>` },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/footer1.xml', data: footerXml },
    { name: 'word/header1.xml', data: headerXml },
    // The header's logo: its own relationship to the same picture
    { name: 'word/_rels/header1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `${logoRid ? `<Relationship Id="${logoRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${logoRid.slice(6)}.${media[Number(logoRid.slice(6)) - 1].ext}"/>` : ''}</Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` },
    ...media.map((m, i) => ({ name: `word/media/image${i + 1}.${m.ext}`, data: m.data })),
  ])
  writeFileSync(out, file)
  return out
}
