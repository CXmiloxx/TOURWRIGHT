// `tourwright guide <script>`: the same script as a step-by-step guide with screenshots, for a help center, an
// email or a PDF. The script runs fast (like a dry run); before each action the page is captured with the
// element marked, and the narration becomes the text. Chapters and title cards become sections.
// Secrets never show: typed values that hold one are written as "•••", and secret fields are blurred.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { escapeHtml, holdsSecret, plainText } from '#core/util.js'
import { stripMarks } from '#voice/index.js'
import { entryHtml, entryMarkdown, isSolid } from './blocks.js'
import { writeDocx } from './docx.js'
import { guidePage } from './layout.js'

const WORDS = {
  es: { click: n => `Haz clic en «${n}».`, type: (n, v) => (v ? `Escribe «${v}» en «${n}».` : `Escribe en «${n}».`), secret: n => `Escribe en «${n}» (el valor no se muestra).`, select: (n, v) => `En «${n}», elige «${v}».`, check: n => `Marca «${n}».`, uncheck: n => `Desmarca «${n}».`, upload: n => `Sube el archivo en «${n}».`, press: k => `Pulsa ${k === 'Enter' ? 'Enter' : k}.`, example: v => `Por ejemplo: «${v}».`, step: 'Paso', made: 'Guía hecha con Tourwright', contents: 'Contenido', steps: n => `${n} paso${n === 1 ? '' : 's'}`, tones: { info: 'Nota', ok: 'Listo', warn: 'Atención' }, page: 'Página', of: 'de' },
  en: { click: n => `Click "${n}".`, type: (n, v) => (v ? `Type "${v}" in "${n}".` : `Type in "${n}".`), secret: n => `Type in "${n}" (the value is not shown).`, select: (n, v) => `In "${n}", choose "${v}".`, check: n => `Tick "${n}".`, uncheck: n => `Untick "${n}".`, upload: n => `Upload the file in "${n}".`, press: k => `Press ${k}.`, example: v => `For example: "${v}".`, step: 'Step', made: 'Guide made with Tourwright', contents: 'Contents', steps: n => `${n} step${n === 1 ? '' : 's'}`, tones: { info: 'Note', ok: 'Done', warn: 'Warning' }, page: 'Page', of: 'of' },
}

const nameOf = t => (typeof t === 'string' ? t : (t.name ?? t.label ?? t.placeholder ?? t.text ?? t.testId ?? t.css ?? ''))
// A narration as plain text: no {marks}, no HTML, no [[pauses]]
const plain = text => plainText(stripMarks(String(text))).replace(/\[\[[^\]]*\]\]/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()

/**
 * What a step adds to the guide: a section, a paragraph, or a numbered step (with its screenshot).
 * `look`: a step that only shows something (highlight, zoom…): its screenshot goes with the paragraph before it.
 * `example`: the value typed, when it can be shown, for a focus on that field just before.
 * @returns {{ kind: 'section' | 'text' | 'step' | 'look', text: string, target?: any, merge?: boolean, image?: Buffer, detail?: string, example?: string, step?: number } | null}
 */
export const guideEntry = (step, language = 'es') => {
  const w = WORDS[language === 'en' ? 'en' : 'es']
  const [action, arg] = Object.entries(step)[0]
  const target = arg && typeof arg === 'object' && 'target' in arg ? arg.target : arg
  // Scrolling only moves the page: what it shows comes with the next step or a `shot`
  if (['highlight', 'spotlight', 'zoom', 'callout'].includes(action)) {
    return { kind: 'look', text: action === 'callout' ? plain(arg.text ?? '') : '', target }
  }
  if (action === 'type' || action === 'fill') {
    // A secret or a one-time code is never written in the guide
    const secret = holdsSecret(arg.text) || /\$\{(secret|totp):|⟦totp:/.test(arg.text)
    const name = nameOf(arg.target)
    return { kind: 'step', text: secret ? w.secret(name) : w.type(name, arg.text), target: arg.target, example: secret ? '' : w.example(arg.text) }
  }
  switch (action) {
    case 'chapter': return { kind: 'section', text: String(arg) }
    case 'title': return { kind: 'section', text: typeof arg === 'string' ? arg : arg.text }
    case 'say':
      if (arg === null) return null
      return { kind: 'text', text: plain(typeof arg === 'string' ? arg : (arg.speak ?? arg.caption ?? '')) }
    case 'focus': return { kind: 'step', text: arg.say ? plain(arg.say) : arg.click ? w.click(nameOf(arg.target)) : plain(arg.text ?? nameOf(arg.target)), target: arg.target, merge: !arg.click }
    case 'click': case 'dblclick': case 'rightClick': return { kind: 'step', text: w.click(nameOf(target)), target }
    case 'select': return { kind: 'step', text: w.select(nameOf(arg.target), arg.value), target: arg.target }
    case 'check': case 'uncheck': return { kind: 'step', text: w[action](nameOf(arg)), target: arg }
    case 'upload': return { kind: 'step', text: w.upload(nameOf(arg.target)), target: arg.target }
    case 'press': return { kind: 'step', text: w.press(arg) }
    default: return null
  }
}

/**
 * Writes the guide: <out>.guide.html (one file, images inside), <out>.guide.md with its images in <out>.guide/,
 * <out>.guide.json (each step's text and picture, for `--compare`) and, with `docx`, <out>.guide.docx.
 * `theme`: the script's brand (accent, font, logo); `document`: its `document` options.
 * @param {{ title: string, language?: string, entries: Record<string, any>[], out: string, theme?: Record<string, any> | null,
 *   document?: Record<string, any>, docx?: boolean }} guide
 */
export const writeGuide = ({ title, language = 'es', entries, out, theme = null, document = {}, docx = false }) => {
  const w = WORDS[language === 'en' ? 'en' : 'es']
  const imagesDir = `${out}.guide`
  mkdirSync(imagesDir, { recursive: true })
  // The pictures of the last run go (a step removed leaves no stale picture); nothing else in the folder is touched
  for (const f of readdirSync(imagesDir)) if (f.endsWith('.jpg')) rmSync(join(imagesDir, f), { force: true })
  // A section with nothing after it before the next one (a closing title card) is left out
  const filled = i => {
    for (const x of entries.slice(i + 1)) {
      if (x.kind === 'section') return false
      if (x.kind !== 'break' && (x.kind !== 'text' || x.text || x.image)) return true
    }
    return false
  }
  const kept = entries.filter((e, i) => (e.kind !== 'section' || filled(i)) && (e.kind !== 'text' || e.text || e.image))
  // Pictures saved next to the Markdown, named by what they are
  let n = 0
  let k = 0
  const save = (image, name) => {
    if (!image) return undefined
    writeFileSync(join(imagesDir, name), image)
    return name
  }
  const used = new Set()
  const unique = base => {
    let name = `${base}.jpg`
    for (let i = 2; used.has(name); i++) name = `${base}-${i}.jpg`
    used.add(name)
    return name
  }
  for (const e of kept) {
    k++
    if (e.kind === 'step') e.n = ++n
    const pad = x => String(x).padStart(2, '0')
    if (e.kind === 'step') e.file = save(e.image, `${pad(e.n)}.jpg`)
    else if (e.kind === 'text') e.file = save(e.image, `look-${pad(k)}.jpg`)
    // A shot's own name never takes a step's picture (01.jpg) or another shot's: shot-<name>, numbered if repeated
    else if (e.kind === 'shot') e.file = save(e.image, unique(`shot-${e.name ?? pad(k)}`))
    else if (e.kind === 'gallery') e.items.forEach((item, j) => (item.file = save(item.image, `gallery-${pad(k)}-${j + 1}.jpg`)))
  }
  const md = [`# ${title}`, '']
  const html = []
  const toc = []
  // A section's title stays on the page of its first picture or table (break-after: avoid alone does not
  // hold it): a title with only a line under it at the foot of a page reads as a mistake
  let open = false
  const close = () => {
    if (open) html.push('</div>')
    open = false
  }
  for (const e of kept) {
    if (e.kind === 'section') {
      close()
      const id = `s${toc.length + 1}`
      toc.push({ id, text: e.text })
      md.push(`## ${e.text}`, '')
      html.push(`<div class="keep"><h2 id="${id}">${escapeHtml(e.text)}</h2>`)
      open = true
      continue
    }
    if (e.kind === 'break') close()
    html.push(entryHtml(e, { n: e.n, words: w }))
    md.push(...entryMarkdown(e, { n: e.n, words: w, dir: basename(imagesDir) }))
    if (isSolid(e)) close()
  }
  close()
  writeFileSync(`${out}.guide.html`, guidePage({ title, language, theme, document, body: html.join('\n'), toc, steps: n, made: w.made, words: w }))
  writeFileSync(`${out}.guide.md`, `${md.join('\n')}\n`)
  // What --compare reads next time: the steps in order, their text and their picture
  const index = kept.filter(e => e.kind === 'step' || e.kind === 'shot').map(e => ({ n: e.n ?? null, text: e.text ?? e.caption ?? e.name ?? '', file: e.file ?? null }))
  writeFileSync(`${out}.guide.json`, `${JSON.stringify({ title, steps: index }, null, 2)}\n`)
  const result = { html: `${out}.guide.html`, markdown: `${out}.guide.md`, json: `${out}.guide.json`, images: imagesDir, steps: n, dir: dirname(out), accent: theme?.accent, footer: document?.footer ?? title, header: document?.header !== false }
  if (docx) result.docx = writeDocx({ title, language, theme, document, entries: kept, toc, words: w, out: `${out}.guide.docx` })
  return result
}
