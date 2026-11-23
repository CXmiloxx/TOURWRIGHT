// The small Markdown of a script's `md` and `note` steps: paragraphs, headings, lists, bold, italics, inline
// code and links. Parsed into a tree that the HTML guide and the Word document both write; anything else is
// plain text (the text comes from scripts sent to the API: no raw HTML ever reaches a page).
import { escapeHtml } from '#core/util.js'

/** @typedef {{ text: string, bold?: boolean, italic?: boolean, code?: boolean, href?: string }} Inline */
/** @typedef {{ type: 'p', inlines: Inline[] }} Paragraph */
/** @typedef {{ type: 'h', level: number, inlines: Inline[] }} Heading */
/** @typedef {{ type: 'ul' | 'ol', items: Inline[][] }} List */
/** @typedef {Paragraph | Heading | List} Block */

// Only links a reader can follow safely: never javascript:, data: or a relative path
const SAFE_LINK = /^(https?:\/\/|mailto:)/i

/**
 * The inline marks of one line: **bold**, *italic* or _italic_ (never inside a word: `user_name_id` stays), `code`,
 * [text](url).
 * @param {string} line @returns {Inline[]}
 */
export const parseInline = line => {
  /** @type {Inline[]} */
  const out = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|(?<!\w)_[^_\s][^_]*_(?!\w))|(\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g
  let last = 0
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) })
    const [all] = m
    if (m[1]) out.push({ text: all.slice(1, -1), code: true })
    else if (m[2]) out.push({ text: all.slice(2, -2), bold: true })
    else if (m[3]) out.push({ text: all.slice(1, -1), italic: true })
    else {
      const [, text, href] = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/.exec(all) ?? []
      out.push(SAFE_LINK.test(href) ? { text, href } : { text })
    }
    last = m.index + all.length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out.filter(i => i.text)
}

/**
 * Markdown → blocks. Lines that follow each other make one paragraph; a blank line ends it.
 * @param {string} md @returns {Block[]}
 */
export const parseMarkdown = md => {
  /** @type {Block[]} */
  const blocks = []
  /** @type {string[]} */
  let para = []
  /** @type {{ type: 'ul' | 'ol', items: Inline[][] } | null} */
  let list = null
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', inlines: parseInline(para.join(' ')) })
    para = []
    list = null
  }
  for (const raw of String(md ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'h', level: heading[1].length, inlines: parseInline(heading[2]) })
      continue
    }
    const item = /^(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line)
    if (item) {
      const type = item[1] ? 'ul' : 'ol'
      if (para.length) flush()
      if (!list || list.type !== type) {
        list = { type, items: [] }
        blocks.push(list)
      }
      list.items.push(parseInline(item[3]))
      continue
    }
    // A line after a list item continues the paragraph, not the list
    if (list) list = null
    para.push(line)
  }
  flush()
  return blocks
}

/** @param {Inline[]} inlines */
const inlineHtml = inlines =>
  inlines.map(i => {
    let h = escapeHtml(i.text)
    if (i.code) h = `<code>${h}</code>`
    if (i.bold) h = `<strong>${h}</strong>`
    if (i.italic) h = `<em>${h}</em>`
    if (i.href) h = `<a href="${escapeHtml(i.href)}">${h}</a>`
    return h
  }).join('')

/**
 * The blocks as HTML: headings start at <h3> (the guide's sections are <h2>).
 * @param {string} md
 */
export const markdownHtml = md =>
  parseMarkdown(md).map(b => {
    if (b.type === 'p') return `<p>${inlineHtml(b.inlines)}</p>`
    if (b.type === 'h') return `<h${b.level + 2}>${inlineHtml(b.inlines)}</h${b.level + 2}>`
    return `<${b.type}>${b.items.map(i => `<li>${inlineHtml(i)}</li>`).join('')}</${b.type}>`
  }).join('\n')

// What Markdown would read as a mark, escaped: the text stays text in any tool that renders the file
const mdEscape = text => String(text).replace(/[\\`*_[\]<>!|#]/g, c => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : `\\${c}`))

/** @param {Inline[]} inlines */
const inlineMarkdown = inlines =>
  inlines.map(i => {
    let m = i.code ? `\`${i.text.replace(/`/g, "'")}\`` : mdEscape(i.text)
    if (i.bold) m = `**${m}**`
    if (i.italic) m = `*${m}*`
    if (i.href) m = `[${m}](<${i.href.replace(/[<>\s]/g, encodeURIComponent)}>)`
    return m
  }).join('')

/**
 * The blocks written again as Markdown: only what the subset allows survives, so a link that is not http, https
 * or mailto, an image or raw HTML in the script comes out as plain text.
 * @param {string} md
 */
export const markdownText = md =>
  parseMarkdown(md).map(b => {
    if (b.type === 'p') return inlineMarkdown(b.inlines)
    if (b.type === 'h') return `${'#'.repeat(b.level + 2)} ${inlineMarkdown(b.inlines)}`
    return b.items.map((item, n) => `${b.type === 'ol' ? `${n + 1}.` : '-'} ${inlineMarkdown(item)}`).join('\n')
  }).join('\n\n')
