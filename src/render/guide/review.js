// The review of a guide before it is printed: what a reader of the PDF would notice. Pages left half empty
// (a block that did not fit), pictures taller than a page, an accent too pale on white, a PDF too heavy to
// send. Like the video review, it only warns.
import { contrast, margins } from './layout.js'

// Content height of a page, in CSS pixels (96 per inch): the paper less the margins of layout.js
const PX_MM = 96 / 25.4
const PAGE_MM = { A4: 297, Letter: 279.4 }
const MAX_MB = 20

/**
 * Lays the blocks out on pages the way the print CSS does (a block that does not fit starts the next page;
 * one taller than a page is split into its parts) and reports the pages left mostly empty.
 * @param {{ height: number, forced?: boolean, tall?: boolean, label: string }[]} blocks  heights in px
 * @param {number} page  the height of a page's content, in px
 * @returns {{ kind: string, message: string }[]}
 */
export const layoutFindings = (blocks, page) => {
  const findings = []
  let left = page
  let pageNo = 2 // the cover is page 1
  const newPage = () => {
    pageNo++
    left = page
  }
  for (const b of blocks) {
    if (b.forced) {
      newPage()
      continue
    }
    if (b.tall) findings.push({ kind: 'tall-picture', message: `${b.label}: taller than a page, it is shrunk to fit` })
    const h = Math.min(b.height, page)
    if (h > left) {
      // What stays blank: more than 40% of a page is a gap a reader notices
      if (left > page * 0.4) findings.push({ kind: 'empty-page', message: `about page ${pageNo}: ${Math.round((left / page) * 100)}% left blank before ${b.label} (it did not fit); a shorter picture or a \`pageBreak\` earlier helps` })
      newPage()
    }
    left -= h
  }
  return findings
}

/**
 * Measures the guide in print media and reviews it. Runs in the printing page (pdf.js), before page.pdf().
 * @param {import('playwright').Page} page @param {{ paper?: string, accent?: string, header?: boolean }} doc
 */
export const reviewGuide = async (page, { paper = 'A4', accent, header = true } = {}) => {
  const findings = []
  const ratio = accent ? contrast(accent, '#ffffff') : null
  if (ratio !== null && ratio < 3) findings.push({ kind: 'contrast', message: `the accent ${accent} is pale on white (${ratio.toFixed(1)}:1): step numbers and links use a darker one instead` })
  const m = margins(header)
  const pageHeight = ((PAGE_MM[paper] ?? PAGE_MM.A4) - m.top - m.bottom) * PX_MM
  const blocks = await page.evaluate(pageHeight => {
    const out = []
    const label = el => {
      const n = el.querySelector('.n')?.textContent
      if (n) return `step ${n}`
      const h = el.querySelector('h2, h3')?.textContent
      if (h) return `"${h.trim().slice(0, 40)}"`
      return el.classList.contains('gallery') ? 'a gallery' : el.tagName === 'FIGURE' ? 'a picture' : 'a block'
    }
    const walk = el => {
      const h = el.getBoundingClientRect().height
      if (el.classList.contains('break')) return void out.push({ height: 0, forced: true, label: 'a page break' })
      // A block taller than a page breaks into its parts (a section with its steps)
      if (h > pageHeight && el.children.length > 1 && !el.matches('figure, .gallery, .step')) return void [...el.children].forEach(walk)
      out.push({ height: h, tall: h > pageHeight, label: label(el) })
    }
    for (const el of document.body.children) if (!el.matches('header.cover, footer, style')) walk(el)
    return out
  }, pageHeight)
  findings.push(...layoutFindings(blocks, pageHeight))
  return findings
}

/** A PDF too heavy to send by email */
export const weightFinding = bytes =>
  bytes > MAX_MB * 1024 * 1024 ? [{ kind: 'heavy', message: `the PDF weighs ${Math.round(bytes / 1024 / 1024)} MB: fewer or smaller pictures (a \`shot\` of an element, not the whole page) make it lighter` }] : []
