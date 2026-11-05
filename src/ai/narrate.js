// `tourwright narrate <script>`: the plain first narration (recorded, or written by `explore`) rewritten by the AI the
// person brings (src/ai.js), from what each screen shows. The script runs fast to capture each step; the AI gets
// the steps in order with their pictures and answers one line per step. Every line is checked before it is
// proposed: the {word} the focus lands on is kept, nothing secret is written, and a line that breaks a rule keeps
// the old one. Nothing is saved without --write, and then a copy of the script is kept first.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { askAi } from './client.js'
import { render } from '#render/index.js'
import { holdsSecret, UserError } from '#core/util.js'

const nameOf = t => (t && typeof t === 'object' ? (t.name ?? t.label ?? t.placeholder ?? t.text ?? '') : '')
const MARK = /\{([^{}]+)\}/g

/** The lines a script says, step by step: what can be rewritten */
export const narratable = steps => {
  const lines = []
  for (const [i, step] of steps.entries()) {
    const [action, arg] = Object.entries(step)[0]
    const at = i + 1
    if (action === 'say' && typeof arg === 'string' && arg.trim()) lines.push({ step: at, kind: 'say', before: arg })
    else if (action === 'focus' && arg.say) lines.push({ step: at, kind: 'focus', before: arg.say, element: nameOf(arg.target), click: Boolean(arg.click) })
    else if (action === 'title' && typeof arg === 'object' && arg.say) lines.push({ step: at, kind: 'title', before: arg.say, element: arg.text })
  }
  return lines
}

// What happens at a step, in a few words, for the AI's context
const describe = step => {
  const [action, arg] = Object.entries(step)[0]
  const target = arg && typeof arg === 'object' && 'target' in arg ? arg.target : arg
  switch (action) {
    case 'chapter': return `screen "${arg}"`
    case 'goto': return `opens ${arg}`
    case 'type': case 'fill': return `types in "${nameOf(arg.target)}"${holdsSecret(arg.text) || /\$\{|⟦/.test(arg.text) ? ' (a secret)' : ''}`
    case 'click': return `clicks "${nameOf(target)}"`
    case 'select': return `chooses "${arg.value}" in "${nameOf(arg.target)}"`
    case 'upload': return `uploads a file in "${nameOf(arg.target)}"`
    case 'wait': return 'waits'
    case 'press': return `presses ${arg}`
    default: return action
  }
}

const SYSTEM = language => `You write the spoken narration of a short video that shows how to use a web app. The viewer is a new user, not a programmer.

For each step marked REWRITE, write what is said at that step, in ${language === 'en' ? 'English' : `the language "${language}" (Spanish: tú, neutral Latin American)`}:
- One or two short sentences, at most 25 words, easy to say aloud. Warm and plain: say what the screen or the element is for, then what to do.
- Use what the screenshots show and the names in the steps. Never invent buttons, numbers, menus or features that are not visible or named.
- Follow the order: each line continues from the previous one without repeating it. The first line welcomes and says what the video shows.
- A current line with a word in {braces} marks the element the camera focuses on when that word is heard. Your line must contain exactly one pair of braces, around the name of that same element as the viewer sees it on screen.
- Never write a password, a code, an email or any value typed into a field.

Answer one entry per REWRITE step, with the same step number.`

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { step: { type: 'integer' }, say: { type: 'string' } },
        required: ['step', 'say'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
}

/**
 * Checks one line from the AI against the rules. Returns the line to use and why the old one was kept, if it was.
 * @returns {{ after: string, kept?: string }}
 */
export const checkLine = (line, said) => {
  let after = String(said ?? '').replace(/\s+/g, ' ').trim()
  if (!after) return { after: line.before, kept: 'empty answer' }
  if (after.length > 320) return { after: line.before, kept: 'too long' }
  if (holdsSecret(after)) return { after: line.before, kept: 'it held a secret' }
  if (/\$\{|⟦/.test(after)) return { after: line.before, kept: 'it held a placeholder' }
  const needsMark = MARK.test(line.before)
  MARK.lastIndex = 0
  const marks = after.match(MARK) ?? []
  if (needsMark && marks.length !== 1) {
    // The element's name is in the line without braces: they are put around it
    const name = line.before.match(/\{([^{}]+)\}/)?.[1] ?? line.element ?? ''
    const plain = after.replace(/[{}]/g, '')
    const at = name ? plain.toLowerCase().indexOf(name.toLowerCase()) : -1
    if (at < 0) return { after: line.before, kept: 'the focus word was lost' }
    after = `${plain.slice(0, at)}{${plain.slice(at, at + name.length)}}${plain.slice(at + name.length)}`
  }
  if (!needsMark && marks.length) after = after.replace(/[{}]/g, '')
  return { after }
}

/**
 * The new narration of a script: one proposal per line it says.
 * @param {any} loaded  a browser script from loadFile
 */
export const proposeNarration = async (loaded, config) => {
  if (loaded.kind !== 'browser') throw new UserError('narrate works on browser walkthroughs')
  const lines = narratable(loaded.script.steps)
  if (!lines.length) throw new UserError('this script says nothing yet: add say or focus lines, or record it with tourwright record')
  // The script runs fast; each step's picture comes back with its number
  const run = await render(loaded, { guide: 'collect' }, config)
  const language = run.language ?? loaded.script.language ?? 'es'
  const pictures = new Map(run.entries.filter(e => e.image).map(e => [e.step, e.image]))
  const rewrite = new Set(lines.map(l => l.step))
  /** @type {({ text: string } | { image: Buffer })[]} */
  const parts = [{ text: `App: ${loaded.script.title ?? loaded.name}. The steps of the video, in order:` }]
  let images = 0
  for (const [i, step] of loaded.script.steps.entries()) {
    const at = i + 1
    const line = lines.find(l => l.step === at)
    const text = line
      ? `[${at}] REWRITE ${line.kind}${line.element ? ` on "${line.element}"` : ''}${line.click ? ' (then clicks it)' : ''}. Current line: "${line.before}"`
      : `[${at}] ${describe(step)}`
    parts.push({ text })
    // Pictures of the steps to rewrite, up to 20: enough to see every screen without a huge request
    if (rewrite.has(at) && pictures.has(at) && images < 20) {
      parts.push({ image: pictures.get(at) })
      images++
    }
  }
  const answer = await askAi({ system: SYSTEM(language), parts, schema: SCHEMA }, config)
  const said = new Map((answer?.lines ?? []).map(l => [Number(l.step), l.say]))
  return lines.map(line => ({ ...line, ...checkLine(line, said.get(line.step)) }))
}

/**
 * Puts the new lines in the YAML text, keeping its comments and layout. Lines written with {{variables}} are left
 * as they are. @returns {{ text: string, applied: number }}
 */
export const applyNarration = (source, proposals) => {
  const doc = YAML.parseDocument(source)
  const steps = doc.get('steps')
  const items = /** @type {any} */ (steps)?.items ?? []
  // `use` and `repeat` expand into several steps: the numbers would not match the file
  if (items.some(item => item?.has?.('use') || item?.has?.('repeat'))) {
    throw new UserError('this script inserts blocks (use/repeat) among its steps: copy the new lines by hand from the list above')
  }
  let applied = 0
  for (const p of proposals) {
    if (p.kept || p.after === p.before) continue
    const i = p.step - 1
    const path = p.kind === 'say' ? ['steps', i, 'say'] : ['steps', i, p.kind, 'say']
    const now = doc.getIn(path)
    if (typeof now !== 'string' || now.includes('{{')) continue
    doc.setIn(path, p.after)
    applied++
  }
  return { text: doc.toString({ lineWidth: 0 }), applied }
}

/** `narrate --write`: the new lines into the file; the old file is kept next to it */
export const writeNarration = (file, proposals) => {
  if (!/\.ya?ml$/i.test(file)) throw new UserError(`narrate --write edits YAML scripts; ${file} is not one`)
  const { text, applied } = applyNarration(readFileSync(file, 'utf8'), proposals)
  if (!applied) return { applied, backup: null }
  const backup = file.replace(/\.ya?ml$/i, m => `.before-narrate${m}`)
  copyFileSync(file, backup)
  writeFileSync(file, text)
  return { applied, backup }
}
