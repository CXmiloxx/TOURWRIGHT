// tourwright <command> — see `tourwright help`.
// Reads the options once and hands the command to its module in cli/commands/: videos (render, check, fix…),
// sites (explore, record, session), voices (voices, say, install) and machine (doctor, config, secrets, servers).
import { resolve } from 'node:path'
import { loadConfig } from '#core/config.js'
import { loadPlugins } from '#plugins/index.js'
import { OPTIONS, parseCliArgs, varsFrom } from './args.js'
import { machineCommands } from './commands/machine.js'
import { sitesCommands } from './commands/sites.js'
import { videosCommands } from './commands/videos.js'
import { voicesCommands } from './commands/voices.js'
import { HELP } from './help.js'
import { version } from '#core/paths.js'
import { UserError } from '#core/util.js'

export { doctor } from './doctor.js'

const COMMANDS = { ...videosCommands, ...sitesCommands, ...voicesCommands, ...machineCommands }

export const main = async argv => {
  const [command, ...rest] = argv
  const { values, positionals } = parseCliArgs({ args: rest, allowPositionals: true, options: OPTIONS })
  if (values.help || command === undefined || ['help', '--help', '-h'].includes(command)) return void process.stdout.write(HELP)
  if (command === 'version' || command === '--version') {
    return void process.stdout.write(`${version()}\n`)
  }
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null
  if (!run) throw new UserError(`unknown command "${command}" — tourwright help`)
  // Before the config is read: renders started by a worker inherit it
  if (values.lock) process.env.TOURWRIGHT_BROWSER_LOCK = resolve(String(values.lock))
  const config = loadConfig()
  await loadPlugins(config)
  await run({ values, positionals, config, vars: varsFrom(/** @type {string[] | undefined} */ (values.var)) })
}
