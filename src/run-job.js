// Renders one job in its own process (the worker spawns it): a crash, a leak or a hung browser never
// takes the worker down, and the worker can kill it at the time limit.
//
//   node src/run-job.js <input dir> <output dir> <options JSON>
//
// Progress lines go to stdout as JSON: {"progress":{…}} and, at the end, {"result":{…}} or {"error":"…"}.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { loadPlugins } from './plugins.js'
import { render } from './render/index.js'
import { fromData } from './script/load.js'
import { redact, UserError } from './util.js'

const [input, output, rawOptions] = process.argv.slice(2)
const options = JSON.parse(rawOptions ?? '{}')
const say = message => process.stdout.write(`${JSON.stringify(message)}\n`)

try {
  await loadPlugins(loadConfig())
  const script = JSON.parse(readFileSync(join(input, 'script.json'), 'utf8'))
  const loaded = fromData(script, { name: 'video', dir: input, sandboxed: options.sandboxed !== false, expand: false })
  const result = await render(loaded, { ...options, out: join(output, 'video.mp4'), failureDir: output, onProgress: progress => say({ progress }) }, loadConfig())
  say({ result })
  process.exit(0)
} catch (error) {
  // Playwright colors its call logs: plain text for API clients
  const message = redact(String(error.message ?? error).replace(/\u001b\[[0-9;]*m/g, ''))
  say({ error: message, user: error instanceof UserError })
  process.exit(error instanceof UserError ? 2 : 1)
}
