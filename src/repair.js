// `tourwright check` and `tourwright fix`: run scripts as a dry run, report every broken step, and propose the
// element on the page that most likely is the one a step meant (a renamed label, a button that changed its
// text). `fix --write` puts the new targets in the file, keeping its comments and layout.
import { readFileSync, writeFileSync } from 'node:fs'
import YAML, { isScalar, visit } from 'yaml'
import { render } from './render/index.js'
import { asTarget, describeTarget } from './render/targets.js'
import { UserError } from './util.js'

// Words that say nothing about which element it is
const FILLER = new Set(['o', 'y', 'de', 'del', 'la', 'el', 'los', 'las', 'tu', 'su', 'un', 'una', 'a', 'en', 'the', 'an', 'or', 'and', 'of', 'your', 'to'])
export const words = s =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w && !FILLER.has(w))

// How alike two texts are, from 0 to 1: shared words, and a word that starts another counts as shared
export const likeness = (a, b) => {
  const A = new Set(words(a))
  const B = new Set(words(b))
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const w of A) if (B.has(w) || [...B].some(x => (x.length > 3 && w.startsWith(x)) || (w.length > 3 && x.startsWith(w)))) shared++
  return shared / Math.max(A.size, B.size)
}

const textOf = t => (typeof t === 'string' ? '' : (t.name ?? t.label ?? t.placeholder ?? t.text ?? t.testId ?? ''))
const kindOf = t => {
  if (typeof t === 'string' || t.css || t.text || t.testId) return null
  if (t.label || t.placeholder || ['textbox', 'searchbox', 'combobox'].includes(t.role)) return 'field'
  if (t.role === 'link') return 'link'
  if (t.role === 'button') return 'button'
  return null
}

/**
 * The element on the page that most likely is the one the step meant, or null when nothing is close enough
 * @param {{ target: any, elements?: { target: Record<string, string>, kind: string, hint: string }[] }} failure
 */
export const suggestFix = failure => {
  if (!failure?.target || !failure.elements?.length) return null
  const wanted = textOf(failure.target)
  if (!wanted) return null
  const kind = kindOf(failure.target)
  let best = null
  const sameKind = failure.elements.filter(e => !kind || e.kind === kind)
  for (const e of sameKind) {
    const score = Math.max(likeness(wanted, e.hint), ...Object.values(e.target).map(v => likeness(wanted, v)))
    if (score > (best?.score ?? 0)) best = { from: failure.target, to: e.target, score: Number(score.toFixed(2)) }
  }
  if (best && best.score >= 0.34) return best
  // Nothing alike, but only one element of that kind on the page (one button: "Entrar" became "Ingresar")
  const distinct = [...new Map(sameKind.map(e => [JSON.stringify(e.target), e])).values()]
  if (kind && distinct.length === 1) return { from: failure.target, to: distinct[0].target, score: 0.3, only: true }
  return null
}

/**
 * Runs one script as a dry run and returns what broke, with a proposed fix for each step it can
 * @param {any} loaded  a script from loadFile / fromData
 */
export const checkScript = async (loaded, options = {}, config) => {
  try {
    const result = await render(loaded, { ...options, dryRun: true }, config)
    return { name: loaded.name, ok: true, seconds: result.seconds, failures: [] }
  } catch (caught) {
    // Anything that stops the run is a broken script for `check`: reported, and the next script still runs
    const error = /** @type {any} */ (caught)
    const list = error.failures ?? (error.failure ? [error.failure] : [{ message: String(error.message).split('\n')[0] }])
    const failures = list.map(f => ({
      step: f.step,
      action: f.action,
      target: f.target,
      url: f.url,
      message: f.message,
      fix: suggestFix(f),
    }))
    return { name: loaded.name, ok: false, failures, screenshot: error.screenshot }
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Puts the proposed targets in a YAML text, wherever the old target is written (also inside blocks).
 * Comments and layout stay. @returns {{ text: string, applied: number }}
 */
export const applyFixes = (source, fixes) => {
  const doc = YAML.parseDocument(source)
  let applied = 0
  for (const { from, to } of fixes) {
    visit(doc, {
      Map: (_, node) => {
        if (!same(node.toJSON(), from)) return undefined
        applied++
        const next = /** @type {any} */ (doc.createNode(to))
        next.flow = node.flow
        return next
      },
      Scalar: (key, node) => {
        // A target written as a selector string, as the value of `target:` or of the action itself
        if (key !== 'value' || typeof from !== 'string' || !isScalar(node) || node.value !== from) return undefined
        applied++
        const next = /** @type {any} */ (doc.createNode(to))
        if (typeof to === 'object') next.flow = true
        return next
      },
    })
  }
  return { text: doc.toString({ lineWidth: 0 }), applied }
}

/** `fix --write`: the proposed targets go into the file */
export const writeFixes = (file, fixes) => {
  if (!/\.ya?ml$/i.test(file)) throw new UserError(`fix --write edits YAML scripts; ${file} is not one (apply the fixes by hand)`)
  const { text, applied } = applyFixes(readFileSync(file, 'utf8'), fixes)
  if (applied) writeFileSync(file, text)
  return applied
}

/** The result of `check` as Markdown (for a pull request, or GitHub's job summary) */
export const markdownReport = results => {
  const broken = results.filter(r => !r.ok)
  const lines = [`## Tourwright: ${broken.length ? `${broken.length} of ${results.length} scripts broken` : `${results.length} scripts OK`}`, '']
  for (const r of results) {
    lines.push(`- ${r.ok ? '✅' : '❌'} **${r.name}**${r.ok ? '' : ` — ${r.failures.length} step${r.failures.length > 1 ? 's' : ''}`}`)
    for (const f of r.failures) {
      const what = f.target ? `cannot find ${describeTarget(f.target)}` : f.message.split('\n')[0]
      lines.push(`  - ${f.step ? `step ${f.step} (${f.action}): ` : ''}${what}${f.fix ? ` → try \`${asTarget(f.fix.to)}\`` : ''}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** The result of `check` for a terminal */
export const textReport = results => {
  const lines = []
  for (const r of results) {
    lines.push(`${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ` — ${r.failures.length} broken`}`)
    for (const f of r.failures) {
      lines.push(`    ${f.message.split('\n')[0]}`)
      if (f.fix) lines.push(`      fix: ${asTarget(f.fix.from)} → ${asTarget(f.fix.to)}`)
    }
  }
  return `${lines.join('\n')}\n`
}
