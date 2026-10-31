// Loads a script from a file (.json, .yaml, .yml, .js, .mjs) or from data (API, MCP).
//
// JS scripts are modules: `export default async ({ page, context, v }) => {}` plus `export const options = {…}`
// (the same keys as a declarative browser script, except `steps`). They run arbitrary code, so the API and
// MCP accept them only with TOURWRIGHT_ALLOW_JS=true.
import { readFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { loadConfig } from '../config.js'
import { getSecret, secretName } from '../secrets.js'
import { hideSecret, UserError } from '../util.js'
import { expandScript } from './expand.js'
import { validateScript } from './schema.js'

/**
 * A script ready to render: `kind` tells which script it holds.
 * @typedef {object} LoadedBase
 * @property {string} name        output name (the file name without extension)
 * @property {string} dir         relative paths in the script resolve here
 * @property {boolean} sandboxed  from the API/MCP: data only, files inside `dir`, network guard
 * @property {Function} [run]     JavaScript scripts: the default export
 * @property {Function} [setupFn] JavaScript scripts: `export const setup`
 * @typedef {LoadedBase & ({ kind: 'browser', script: import('./schema.js').BrowserScript } | { kind: 'slides', script: import('./schema.js').SlidesScript })} Loaded
 */

export const parseText = (text, format = 'yaml') => {
  try {
    return format === 'json' ? JSON.parse(text) : YAML.parse(text)
  } catch (error) {
    throw new UserError(`script is not valid ${format.toUpperCase()}: ${error.message}`)
  }
}

// `vars` override the script's own variables. `expand: false` for a script that was already expanded
// (a queued job): its texts may hold "{{" that came from a variable's value.
/**
 * @param {any} data
 * @param {{ name?: string, dir?: string, sandboxed?: boolean, vars?: Record<string, unknown>, expand?: boolean }} [options]
 * @returns {Loaded}
 */
export const fromData = (data, { name = 'video', dir = process.cwd(), sandboxed = false, vars, expand = true } = {}) => {
  const r = validateScript(expand ? expandScript(data, { vars }) : data)
  if (!r.ok) throw new UserError(`invalid script:\n  ${r.errors.join('\n  ')}`)
  const base = { name, dir, sandboxed }
  return r.script.type === 'slides' ? { ...base, kind: 'slides', script: r.script } : { ...base, kind: 'browser', script: r.script }
}

/** @param {string} file @param {{ allowJs?: boolean, vars?: Record<string, unknown> }} [options] @returns {Promise<Loaded>} */
export const loadFile = async (file, { allowJs = true, vars = undefined } = {}) => {
  const path = resolve(file)
  const ext = extname(path).toLowerCase()
  const name = basename(path).replace(/\.(m?js|json|ya?ml)$/i, '')
  if (ext === '.js' || ext === '.mjs') {
    if (!allowJs) throw new UserError('JavaScript scripts are disabled here (TOURWRIGHT_ALLOW_JS=true to allow them)')
    const mod = await import(pathToFileURL(path).href)
    if (typeof mod.default !== 'function') throw new UserError(`${file}: a JS script exports a default async function`)
    const { steps, ...rest } = mod.options ?? {}
    const r = validateScript({ ...rest, steps: [{ pause: 0 }] })
    if (!r.ok) throw new UserError(`invalid options in ${file}:\n  ${r.errors.join('\n  ')}`)
    const { steps: _ignored, ...options } = /** @type {any} */ (r.script)
    return { kind: 'browser', name, dir: dirname(path), sandboxed: false, script: { ...options, steps: [] }, run: mod.default, setupFn: mod.setup }
  }
  const text = readFileSync(path, 'utf8')
  return fromData(parseText(text, ext === '.json' ? 'json' : 'yaml'), { name, dir: dirname(path), vars })
}

// Secrets in declarative scripts: "${secret:PASSWORD}" (saved with `tourwright secret set PASSWORD`, or the
// TOURWRIGHT_SECRET_PASSWORD variable) and the older "${env:TOURWRIGHT_SECRET_PASSWORD}". Nothing else can be
// read, so a script sent through the API cannot read the worker's other variables.
const SECRET = /\$\{(secret|env):([A-Za-z0-9_]+)\}/g

const nameOf = (kind, name) => {
  if (kind === 'env' && !name.startsWith('TOURWRIGHT_SECRET_')) throw new UserError(`\${env:${name}}: only TOURWRIGHT_SECRET_* variables can be used in scripts`)
  return secretName(name)
}

const mapStrings = (value, fn) => {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map(v => mapStrings(v, fn))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]))
  return value
}

// The names of the secrets a script (or a part of it) uses
/** @param {unknown} value @returns {string[]} */
export const secretsIn = value => {
  const names = new Set()
  mapStrings(value, s => {
    for (const [, kind, name] of s.matchAll(SECRET)) names.add(nameOf(kind, name))
    return s
  })
  return [...names]
}

// The secrets someone watching could see or hear: what `type` and `fill` write is kept off the screen as it
// is typed (password dots, or the field blurred), anything else in the steps (a narration, a caption) is not
const untyped = value => {
  if (Array.isArray(value)) return value.map(untyped)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, (k === 'type' || k === 'fill') && v && typeof v === 'object' ? { ...v, text: '' } : untyped(v)]))
}
/** @param {unknown} steps @returns {string[]} */
export const secretsShown = steps => secretsIn(untyped(steps))

// Every missing secret at once, with the command that saves it: not one error per render attempt
export const missingSecretsMessage = missing =>
  `missing secret${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}\n` +
  `  save ${missing.length > 1 ? 'each one' : 'it'} (the value is asked for and never shown):\n` +
  missing.map(n => `    tourwright secret set ${n}\n`).join('') +
  `  or set ${missing.map(n => `TOURWRIGHT_SECRET_${n}`).join(', ')} in the environment`

/**
 * Same shape in, same shape out. The values used are hidden from every log and error from now on.
 * @template T @param {T} value @param {{ allowed?: boolean, config?: any }} [options] @returns {T}
 */
export const interpolate = (value, { allowed = true, config = loadConfig() } = {}) => {
  const names = secretsIn(value)
  if (!names.length) return value
  if (!allowed) throw new UserError(`secrets are disabled for this job (TOURWRIGHT_ALLOW_SECRETS=true): ${names.join(', ')}`)
  const values = Object.fromEntries(names.map(n => [n, getSecret(config, n)]))
  const missing = names.filter(n => values[n] === undefined)
  if (missing.length) throw new UserError(missingSecretsMessage(missing))
  for (const v of Object.values(values)) hideSecret(v)
  return mapStrings(value, s => s.replace(SECRET, (_, kind, name) => values[nameOf(kind, name)]))
}
