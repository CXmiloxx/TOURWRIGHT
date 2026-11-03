// `tourwright translate <script> --to en`: the same video in another language. Only what the viewer reads or
// hears is translated (narration, captions, titles, bubbles); the targets stay as they are, because the app keeps
// its own language, and so does what is typed into it. The voice is left to the render, which picks the most
// natural one for the new language; the pronunciations of the old language go.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import YAML, { isMap, isScalar, isSeq } from 'yaml'
import { askAi } from './ai.js'
import { UserError } from './util.js'

export const LANGUAGE_NAMES = { es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian' }

// Never translated: what finds an element, what is typed, the data of the script
const SKIP = new Set(['target', 'from', 'to', 'type', 'fill', 'press', 'select', 'upload', 'wait', 'if', 'mask', 'hosts', 'vars',
  'pronounce', 'voices', 'theme', 'audio', 'music', 'session', 'setup', 'warmup', 'dismiss', 'goto', 'baseUrl', 'html', 'image', 'blur'])
// What is read or heard, wherever it is
const SPOKEN = new Set(['say', 'caption', 'speak', 'chapter'])
// Text of a title card, a focus bubble, a callout or a slide
const SHOWN = new Set(['text', 'subtitle', 'kicker'])
const SHOWN_IN = new Set(['title', 'focus', 'callout'])

/**
 * The texts to translate, with the YAML node each one is in.
 * @returns {{ id: number, path: (string | number)[], node: any }[]}
 */
export const translatable = doc => {
  const found = []
  const walk = (node, path) => {
    if (isSeq(node)) return node.items.forEach((item, i) => walk(item, [...path, i]))
    if (!isMap(node)) return
    for (const pair of node.items) {
      const key = String(isScalar(pair.key) ? pair.key.value : pair.key)
      if (SKIP.has(key)) continue
      const here = [...path, key]
      const parent = path.at(-1)
      const value = pair.value
      if (isScalar(value) && typeof value.value === 'string') {
        // `title` is the video's title, a step's title card or a slide's: always read
        const read = SPOKEN.has(key) || key === 'title' || (SHOWN.has(key) && (SHOWN_IN.has(String(parent)) || typeof parent === 'number'))
        if (read && value.value.trim()) found.push({ id: found.length + 1, path: here, node: value })
      } else walk(value, here)
    }
  }
  walk(doc.contents, [])
  return found
}

// What must come back exactly as it was: {{variables}}, ${secrets} and HTML tags; and the {word} the focus
// lands on must still be marked once
const fixed = text => [...String(text).matchAll(/\{\{[^}]*\}\}|\$\{[^}]*\}|<\/?[a-z][^>]*>/gi)].map(m => m[0]).sort()
const marks = text => (String(text).replace(/\{\{[^}]*\}\}|\$\{[^}]*\}/g, '').match(/\{[^{}]+\}/g) ?? []).length

/** Why a translated line cannot be used, or null */
export const checkTranslation = (before, after) => {
  if (typeof after !== 'string' || !after.trim()) return 'it came back empty'
  if (JSON.stringify(fixed(before)) !== JSON.stringify(fixed(after))) return 'it changed a {{variable}}, a ${secret} or an HTML tag'
  if (marks(before) !== marks(after)) return 'it lost or added the {marked} word'
  return null
}

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false },
    },
  },
  required: ['lines'],
  additionalProperties: false,
}

const SYSTEM = (from, to) => `You translate the narration and on-screen texts of a product tour video from ${from} to ${to}.
- Natural, spoken ${to}, as a narrator would say it: short and clear, the same meaning and tone. Not word by word.
- Keep exactly as they are: {{variables}}, \${secrets}, HTML tags like <b>…</b>, numbers, prices, and the names of
  products and companies.
- A word in {braces} marks where the video points at an element: keep the braces around the word that means the
  same in ${to} (one pair, as in the original).
- Names of buttons, links or menus of the app (usually in the braces) stay in ${from}, as the app shows them.
Answer with every id and its translation.`

const askTranslation = async (texts, { from, to }, config) => {
  const answer = await askAi({
    system: SYSTEM(LANGUAGE_NAMES[from] ?? from, LANGUAGE_NAMES[to] ?? to),
    parts: [{ text: JSON.stringify(texts.map(t => ({ id: t.id, text: t.text }))) }],
    schema: SCHEMA,
  }, config)
  return new Map((answer?.lines ?? []).map(l => [Number(l.id), l.text]))
}

/**
 * The script in another language, as YAML text with its comments.
 * @param {string} source  the YAML text
 * @param {{ to: string, translate?: (texts: { id: number, text: string }[], langs: { from: string, to: string }) => Promise<Map<number, string>> }} options
 * @returns {Promise<{ text: string, translated: number, kept: { text: string, why: string }[] }>}
 */
export const translateScript = async (source, { to, translate }, config = undefined) => {
  const lang = String(to ?? '').slice(0, 2).toLowerCase()
  if (!LANGUAGE_NAMES[lang]) throw new UserError(`--to: one of ${Object.keys(LANGUAGE_NAMES).join(', ')}`)
  const doc = YAML.parseDocument(source)
  if (doc.errors.length) throw new UserError(`the script is not valid YAML: ${doc.errors[0].message}`)
  const from = String(doc.get('language') ?? 'es').slice(0, 2).toLowerCase()
  if (from === lang) throw new UserError(`the script is already in ${LANGUAGE_NAMES[lang]}`)
  const items = translatable(doc).map(t => ({ ...t, text: String(t.node.value) }))
  if (!items.length) throw new UserError('nothing to translate: the script has no narration, captions or titles')
  const answers = await (translate ?? ((texts, langs) => askTranslation(texts, langs, config)))(items, { from, to: lang })
  let translated = 0
  const kept = []
  for (const item of items) {
    const after = answers.get(item.id)
    const why = checkTranslation(item.text, after)
    if (why) {
      kept.push({ text: item.text, why: after === undefined ? 'the AI did not translate it' : why })
      continue
    }
    item.node.value = after
    translated++
  }
  doc.set('language', lang)
  // The render picks the most natural voice for the new language; the old language's pronunciations do not apply
  doc.delete('voice')
  doc.delete('pronounce')
  return { text: doc.toString({ lineWidth: 0 }), translated, kept }
}

/** `<name>.<lang>.yaml` next to the script */
export const translatedPath = (file, lang) => file.replace(/(\.[a-z]{2})?\.ya?ml$/i, '') + `.${lang}.yaml`

export const translateFile = async (file, { to, out, yes = false }, config) => {
  if (!/\.ya?ml$/i.test(file)) throw new UserError(`translate works on YAML scripts; ${file} is not one`)
  const target = out ?? translatedPath(file, String(to).slice(0, 2).toLowerCase())
  if (existsSync(target) && !yes) throw new UserError(`${target} already exists: choose another --out (or --yes to replace it)`)
  const result = await translateScript(readFileSync(file, 'utf8'), { to }, config)
  writeFileSync(target, result.text)
  return { ...result, out: target }
}
