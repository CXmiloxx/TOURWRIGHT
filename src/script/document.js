// What a script adds to its documents (the guide, the PDF, the Word file) and nothing to its video: content
// steps (`md`, `note`, `table`, `shot`, `gallery`, `pageBreak`) and the `document` options. A video skips them.
import { z } from 'zod'

const text = z.string().min(1).max(20_000)
const cell = z.union([z.string().max(500), z.number(), z.boolean()])

/**
 * The content steps; `target` is the schema's (a selector or { role, name }…), passed in to avoid a cycle.
 * @param {z.ZodTypeAny} target
 */
export const documentSteps = target => {
  // The page of a shot: the screen as it is, the whole page, or one element of it
  const framing = {
    caption: z.string().max(500).optional().describe('The text under the picture'),
    target: target.optional().describe('Only this element'),
    fullPage: z.boolean().optional().describe('The whole page, not only what fits on screen'),
  }
  return {
    md: text.describe('Text for the documents, in Markdown: paragraphs, # headings, lists, **bold**, *italics*, `code`, [links](https://…). Not in the video'),
    note: z.union([text, z.object({ md: text, tone: z.enum(['info', 'ok', 'warn']).optional() }).strict()])
      .describe('A note box in the documents ({ md, tone: info | ok | warn }). Not in the video'),
    table: z.object({
      columns: z.array(z.string().max(200)).min(1).max(12),
      rows: z.array(z.array(cell).max(12)).max(500),
      caption: z.string().max(500).optional(),
    }).strict().describe('A table in the documents. Not in the video'),
    shot: z.union([z.literal(true), z.object({ name: z.string().regex(/^[\w-]{1,60}$/).optional(), ...framing }).strict()])
      .describe('A picture of the page now in the documents, with no element marked: { caption, target, fullPage }'),
    gallery: z.object({
      columns: z.number().int().min(1).max(6).optional().describe('Pictures per row (default 3; 4 for phone screens)'),
      shots: z.array(z.object({ goto: z.string().optional().describe('Open this page first'), ...framing }).strict()).min(1).max(24),
    }).strict().describe('Several pictures side by side in the documents: each one opens its page (off camera) and is captured'),
    pageBreak: z.literal(true).describe('What follows starts on a new page of the PDF and the Word file'),
  }
}

export const documentOptions = z.object({
  paper: z.enum(['A4', 'Letter']).optional().describe('Paper of the PDF and the Word file (default A4)'),
  cover: z.enum(['light', 'dark', 'none']).optional().describe('The cover: light (default), dark (the theme accent on a dark page) or none'),
  subtitle: z.string().max(300).optional().describe('A line under the title on the cover'),
  toc: z.boolean().optional().describe('Contents on the cover (default true when there are two sections or more)'),
  marks: z.boolean().optional().describe('Mark the element of each step in its picture (default true)'),
  header: z.boolean().optional().describe('A header on every page but the cover: the theme logo and the title over a line in the accent (default true)'),
  footer: z.string().max(200).optional().describe('The text at the foot of every page, beside «page N of M» (default: the title). E.g. "Acme · acme.com · hola@acme.com"'),
  coverLogo: z.string().optional().describe('Another logo for the cover (a light one on a dark cover); default: the theme logo'),
}).strict().describe('How the documents look: the guide (HTML, Markdown), the PDF and the Word file. Their colors, font and logo come from `theme`')
