// Plugins: new step actions, TTS engines and voice names, without touching Tourwright itself.
//
//   tourwright.config.json  { "plugins": ["./my-plugin.js", "tourwright-plugin-confetti"] }
//   or                  TOURWRIGHT_PLUGINS=./my-plugin.js,tourwright-plugin-confetti
//
// A plugin is an ES module whose default export is an object (or a function returning one, sync or async):
//
//   export default {
//     name: 'banner',
//     steps: {
//       banner: {
//         description: 'A banner at the top of the page',
//         schema: z => z.object({ text: z.string(), ms: z.number().optional() }),   // zod, Tourwright's own copy
//         run: async (arg, { page, v, locate, dryRun }) => { … },
//       },
//     },
//     engines: { mytts: { native: [], available: async config => ({ ok: true }), synthesize: async ({ text, voice, out, config }) => {} } },
//     voices: { robot: 'mytts:robot-1' },
//   }
//
// Plugins are code chosen by whoever runs the server, never by a script: the API cannot load one. Their
// steps are available to every script, including API jobs, so a plugin must treat its arguments as untrusted.
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { loadConfig } from './config.js'
import { PLUGIN_STEPS, STEPS } from './script/schema.js'
import { log, UserError } from './util.js'
import { ENGINES } from './voice/engines.js'
import { ALIASES } from './voice/index.js'

const loaded = new Map()

// A path (./x.js, /abs/x.js) next to the working directory, or a package installed there
const specifierOf = ref => {
  if (ref.startsWith('.') || isAbsolute(ref)) return pathToFileURL(resolve(ref)).href
  return pathToFileURL(createRequire(join(process.cwd(), 'noop.js')).resolve(ref)).href
}

export const registerPlugin = (plugin, source = 'inline') => {
  if (!plugin || typeof plugin !== 'object') throw new UserError(`plugin ${source}: the default export is not an object`)
  const name = plugin.name ?? source
  for (const [action, def] of Object.entries(plugin.steps ?? {})) {
    if (!/^[a-z][\w]*$/i.test(action)) throw new UserError(`plugin ${name}: invalid action name "${action}"`)
    if (STEPS[action] && !PLUGIN_STEPS.has(action)) throw new UserError(`plugin ${name}: "${action}" is a built-in action`)
    if (typeof def?.run !== 'function') throw new UserError(`plugin ${name}: step "${action}" has no run function`)
    const schema = typeof def.schema === 'function' ? def.schema(z) : (def.schema ?? z.unknown())
    STEPS[action] = def.description ? schema.describe(def.description) : schema
    PLUGIN_STEPS.set(action, { run: def.run, plugin: name })
  }
  for (const [engine, def] of Object.entries(plugin.engines ?? {})) {
    if (!/^[a-z][a-z0-9]*$/.test(engine)) throw new UserError(`plugin ${name}: invalid engine name "${engine}" (lowercase letters and digits)`)
    if (typeof def?.synthesize !== 'function') throw new UserError(`plugin ${name}: engine "${engine}" has no synthesize function`)
    ENGINES[engine] = { native: [], available: async () => ({ ok: true }), ...def }
  }
  Object.assign(ALIASES, plugin.voices ?? {})
  log.debug(`plugin ${name}: ${Object.keys(plugin.steps ?? {}).length} steps, ${Object.keys(plugin.engines ?? {}).length} engines`)
  return name
}

// Loads the plugins of the config once per process. Every entry point (CLI, API, worker, MCP) calls it.
export const loadPlugins = async (config = loadConfig()) => {
  for (const ref of config.plugins ?? []) {
    if (loaded.has(ref)) continue
    let mod
    try {
      mod = await import(specifierOf(ref))
    } catch (error) {
      throw new UserError(`cannot load plugin ${ref}: ${error.message}`)
    }
    const plugin = typeof mod.default === 'function' ? await mod.default({ z, config }) : mod.default
    loaded.set(ref, registerPlugin(plugin, ref))
  }
  return [...loaded.values()]
}
