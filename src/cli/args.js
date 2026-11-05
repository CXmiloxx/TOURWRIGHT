// The options every command understands, read once: a mistyped one is the user's to fix, said in one line.
import { parseArgs } from 'node:util'
import { UserError } from '#core/util.js'

/** @typedef {{ values: Record<string, any>, positionals: string[], config: Record<string, any>, vars: Record<string, string> }} Cli */

export const OPTIONS = /** @type {const} */ ({
  help: { type: 'boolean', short: 'h' },
  out: { type: 'string', short: 'o' },
  voice: { type: 'string' },
  quality: { type: 'string' },
  capture: { type: 'string' },
  'dry-run': { type: 'boolean' },
  safe: { type: 'boolean' },
  keep: { type: 'boolean' },
  'no-vars': { type: 'boolean' },
  'no-clicks': { type: 'boolean' },
  polish: { type: 'string' },
  timeout: { type: 'string' },
  json: { type: 'boolean' },
  worker: { type: 'boolean' },
  width: { type: 'string' },
  height: { type: 'string' },
  port: { type: 'string' },
  host: { type: 'string' },
  var: { type: 'string', multiple: true },
  voices: { type: 'string' },
  'no-edge': { type: 'boolean' },
  'no-chromium': { type: 'boolean' },
  'no-video': { type: 'boolean' },
  plain: { type: 'boolean' },
  'voice-cache': { type: 'boolean' },
  pocket: { type: 'boolean' },
  whisper: { type: 'boolean' },
  open: { type: 'boolean' },
  fresh: { type: 'boolean' },
  draft: { type: 'string' },
  login: { type: 'string' },
  pages: { type: 'string' },
  export: { type: 'string' },
  // Retired in 1.2 (the voices come calibrated); still accepted so commands that pass them keep working
  check: { type: 'boolean' },
  samples: { type: 'boolean' },
  text: { type: 'string' },
  lock: { type: 'string' },
  step: { type: 'string' },
  language: { type: 'string' },
  to: { type: 'string' },
  plan: { type: 'boolean' },
  report: { type: 'string' },
  write: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
})

// A mistyped option is the user's to fix: a short message, not a stack trace
/**
 * @template {import('node:util').ParseArgsConfig} T
 * @param {T} options
 * @returns {ReturnType<typeof parseArgs<T>>}
 */
export const parseCliArgs = options => {
  try {
    return parseArgs(options)
  } catch (error) {
    if (String(error.code).startsWith('ERR_PARSE_ARGS_')) throw new UserError(`${error.message.split('. ')[0]} — tourwright help`)
    throw error
  }
}

/** --var name=value (repeatable): values for the script's `vars` */
export const varsFrom = (pairs = []) =>
  Object.fromEntries(pairs.map(pair => {
    const i = pair.indexOf('=')
    if (i < 1) throw new UserError(`--var ${pair}: use --var name=value`)
    return [pair.slice(0, i), pair.slice(i + 1)]
  }))
