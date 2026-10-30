// Loads a script from a file (.json, .yaml, .yml, .js, .mjs) or from data (API, MCP).
//
// JS scripts are modules: `export default async ({ page, context, v }) => {}` plus `export const options = {…}`
// (the same keys as a declarative browser script, except `steps`). They run arbitrary code, so the API and
// MCP accept them only with TOURWRIGHT_ALLOW_JS=true.
import { readFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { UserError } from '../util.js'
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

// Secrets in declarative scripts: "${env:TOURWRIGHT_SECRET_PASSWORD}". Only variables that start with
// TOURWRIGHT_SECRET_ can be read, so a script sent through the API cannot read the worker's other variables.
/**
 * Same shape in, same shape out.
 * @template T @param {T} value @param {{ allowed?: boolean }} [options] @returns {T}
 */
export const interpolate = (value, options = {}) => replaceSecrets(value, options)

const replaceSecrets = (value, { allowed = true } = {}) => {
  if (typeof value === 'string') {
    return value.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, name) => {
      if (!allowed) throw new UserError(`\${env:${name}}: secrets are disabled for this job (TOURWRIGHT_ALLOW_SECRETS=true)`)
      if (!name.startsWith('TOURWRIGHT_SECRET_')) throw new UserError(`\${env:${name}}: only TOURWRIGHT_SECRET_* variables can be used in scripts`)
      const v = process.env[name]
      if (v === undefined) throw new UserError(`\${env:${name}} is not set`)
      return v
    })
  }
  if (Array.isArray(value)) return value.map(v => replaceSecrets(v, { allowed }))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceSecrets(v, { allowed })]))
  return value
}
