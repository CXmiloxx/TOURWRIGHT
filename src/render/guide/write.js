// `tourwright guide <script>`: the same script as a step-by-step guide with screenshots, for a help center, an
// email or a PDF. The script runs fast (like a dry run); before each action the page is captured with the
// element marked, and the narration becomes the text. Chapters and title cards become sections.
// Secrets never show: typed values that hold one are written as "•••", and secret fields are blurred.
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { escapeHtml, holdsSecret, plainText } from '#core/util.js'
import { stripMarks } from '#voice/index.js'

const WORDS = {
  es: { click: n => `Haz clic en «${n}».`, type: (n, v) => (v ? `Escribe «${v}» en «${n}».` : `Escribe en «${n}».`), secret: n => `Escribe en «${n}» (el valor no se muestra).`, select: (n, v) => `En «${n}», elige «${v}».`, check: n => `Marca «${n}».`, uncheck: n => `Desmarca «${n}».`, upload: n => `Sube el archivo en «${n}».`, press: k => `Pulsa ${k === 'Enter' ? 'Enter' : k}.`, example: v => `Por ejemplo: «${v}».`, step: 'Paso', made: 'Guía hecha con Tourwright' },
  en: { click: n => `Click "${n}".`, type: (n, v) => (v ? `Type "${v}" in "${n}".` : `Type in "${n}".`), secret: n => `Type in "${n}" (the value is not shown).`, select: (n, v) => `In "${n}", choose "${v}".`, check: n => `Tick "${n}".`, uncheck: n => `Untick "${n}".`, upload: n => `Upload the file in "${n}".`, press: k => `Press ${k}.`, example: v => `For example: "${v}".`, step: 'Step', made: 'Guide made with Tourwright' },
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
  if (['highlight', 'spotlight', 'zoom', 'callout', 'scrollTo'].includes(action)) {
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
 * Writes the guide: <out>.guide.html (one file, images inside, to send or print as PDF) and <out>.guide.md with
 * its images in <out>.guide/.
 * @param {{ title: string, language?: string, entries: { kind: string, text: string, image?: Buffer, detail?: string }[], out: string }} guide
 */
export const writeGuide = ({ title, language = 'es', entries, out }) => {
  const w = WORDS[language === 'en' ? 'en' : 'es']
  const imagesDir = `${out}.guide`
  mkdirSync(imagesDir, { recursive: true })
  const md = [`# ${title}`, '']
  const html = []
  let n = 0
  for (const e of entries) {
    if (e.kind === 'section') {
      md.push(`## ${e.text}`, '')
      html.push(`<h2>${escapeHtml(e.text)}</h2>`)
      continue
    }
    if (e.kind === 'text') {
      if (!e.text && !e.image) continue
      if (e.text) md.push(e.text, '')
      let shot = ''
      if (e.image) {
        const file = `look-${String(entries.indexOf(e)).padStart(2, '0')}.jpg`
        writeFileSync(join(imagesDir, file), e.image)
        md.push(`![](${basename(imagesDir)}/${file})`, '')
        shot = `<img src="data:image/jpeg;base64,${e.image.toString('base64')}" alt="">`
      }
      html.push(`<div class="look">${e.text ? `<p class="text">${escapeHtml(e.text)}</p>` : ''}${shot}</div>`)
      continue
    }
    n++
    const text = [e.text, e.detail].filter(Boolean).join(' ')
    md.push(`**${n}.** ${text}`, '')
    let img = ''
    if (e.image) {
      const file = `${String(n).padStart(2, '0')}.jpg`
      writeFileSync(join(imagesDir, file), e.image)
      md.push(`![${w.step} ${n}](${basename(imagesDir)}/${file})`, '')
      img = `<img src="data:image/jpeg;base64,${e.image.toString('base64')}" alt="${w.step} ${n}">`
    }
    html.push(`<section class="step"><div class="n">${n}</div><div><p>${escapeHtml(text)}</p>${img}</div></section>`)
  }
  const page = `<!doctype html>
<html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink: #1f2330; --muted: #5d6475; --line: #e3e5ec; --accent: #4f46e5; --bg: #fff }
  @media (prefers-color-scheme: dark) { :root { --ink: #eceef4; --muted: #a3a9b8; --line: #30343f; --accent: #8b85ff; --bg: #15171c } }
  body { font: 17px/1.6 system-ui, sans-serif; color: var(--ink); background: var(--bg); max-width: 860px; margin: 0 auto; padding: 32px 16px 64px }
  h1 { font-size: 30px; margin: 0 0 24px } h2 { font-size: 22px; margin: 40px 0 12px; padding-top: 16px; border-top: 1px solid var(--line) }
  .text { color: var(--muted) }
  .look { margin: 18px 0 18px 50px }
  .step { display: grid; grid-template-columns: 36px 1fr; gap: 14px; margin: 22px 0 }
  .n { width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 15px }
  .step p { margin: 3px 0 10px }
  img { width: 100%; border: 1px solid var(--line); border-radius: 10px; display: block }
  footer { margin-top: 48px; color: var(--muted); font-size: 13px }
  @media print { .step { break-inside: avoid } body { padding: 0 } }
</style>
<h1>${escapeHtml(title)}</h1>
${html.join('\n')}
<footer>${w.made}</footer>
</html>
`
  writeFileSync(`${out}.guide.html`, page)
  writeFileSync(`${out}.guide.md`, `${md.join('\n')}\n`)
  return { html: `${out}.guide.html`, markdown: `${out}.guide.md`, images: imagesDir, steps: n, dir: dirname(out) }
}
