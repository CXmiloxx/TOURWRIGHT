// Each entry of a guide as HTML and as Markdown: a numbered step, a paragraph with its picture, a Markdown
// text, a note, a table, a picture, a gallery or a page break. Pictures are already saved: `file` is their
// name next to the Markdown, `image` the bytes put inside the HTML.
import { escapeHtml } from '#core/util.js'
import { markdownHtml, markdownText } from '#script/markdown.js'

const dataUrl = image => `data:image/jpeg;base64,${image.toString('base64')}`
const img = (image, alt = '') => (image ? `<img class="shot" src="${dataUrl(image)}" alt="${escapeHtml(alt)}">` : '')
const figure = (image, caption) =>
  image ? `<figure>${img(image, caption)}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>` : ''

// Markdown read by other tools may render raw HTML: what came from the script is never left as markup
const mdText = text => String(text ?? '').replace(/</g, '&lt;')
const mdCell = text => mdText(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * @param {Record<string, any>} e  the entry
 * @param {{ n: number, words: Record<string, any> }} ctx  n: the number of this step (steps only)
 * @returns {string}
 */
export const entryHtml = (e, { n, words }) => {
  switch (e.kind) {
    case 'step': {
      const text = [e.text, e.detail].filter(Boolean).join(' ')
      return `<section class="step"><div class="n">${n}</div><div><p>${escapeHtml(text)}</p>${img(e.image, `${words.step} ${n}`)}</div></section>`
    }
    case 'text': return `<div class="look">${e.text ? `<p class="text">${escapeHtml(e.text)}</p>` : ''}${img(e.image)}</div>`
    case 'md': return `<div class="md">${markdownHtml(e.md)}</div>`
    case 'note': return `<aside class="note note-${escapeHtml(e.tone)}">${markdownHtml(e.md)}</aside>`
    case 'table':
      return `<figure class="table"><table><thead><tr>${e.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${e.rows.map(r => `<tr>${e.columns.map((_, i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>` +
        `${e.caption ? `<figcaption>${escapeHtml(e.caption)}</figcaption>` : ''}</figure>`
    case 'shot': return figure(e.image, e.caption)
    case 'gallery':
      return `<div class="gallery" style="--cols:${Number(e.columns) || 3}">${e.items.map(i => figure(i.image, i.caption)).join('')}</div>`
    case 'break': return '<div class="break"></div>'
    default: return ''
  }
}

/**
 * The same entry as Markdown lines, its pictures linked from `dir`.
 * @param {Record<string, any>} e @param {{ n: number, words: Record<string, any>, dir: string }} ctx
 * @returns {string[]}
 */
export const entryMarkdown = (e, { n, words, dir }) => {
  const pic = (file, alt = '') => (file ? [`![${mdText(alt)}](${dir}/${file})`, ''] : [])
  const caption = text => (text ? [`*${mdText(text)}*`, ''] : [])
  switch (e.kind) {
    case 'step': return [`**${n}.** ${mdText([e.text, e.detail].filter(Boolean).join(' '))}`, '', ...pic(e.file, `${words.step} ${n}`)]
    case 'text': return [...(e.text ? [mdText(e.text), ''] : []), ...pic(e.file)]
    case 'md': return [markdownText(e.md), '']
    case 'note': return [...markdownText(e.md).split('\n').map((l, i) => `> ${i === 0 ? `**${words.tones[e.tone] ?? words.tones.info}:** ` : ''}${l}`), '']
    case 'table':
      return [`| ${e.columns.map(mdCell).join(' | ')} |`, `|${e.columns.map(() => ' --- |').join('')}`,
        ...e.rows.map(r => `| ${e.columns.map((_, i) => mdCell(r[i] ?? '')).join(' | ')} |`), '', ...caption(e.caption)]
    case 'shot': return [...pic(e.file, e.caption), ...caption(e.caption)]
    case 'gallery': return e.items.flatMap(i => [...pic(i.file, i.caption), ...caption(i.caption)])
    default: return []
  }
}

/** Whether an entry holds a picture or a table: a section's title stays on the page of the first one */
export const isSolid = e => Boolean(e.image) || e.kind === 'table' || (e.kind === 'gallery' && e.items.length > 0)
