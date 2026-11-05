// Commands about this machine: its checks, settings, disk, credentials and the servers.
// Each command gets the parsed options (`values`, `positionals`), the config and the script variables (--var).
import { reloadConfig, userConfigFile } from '#core/config.js'
import { clearSessions } from '#render/browser/session.js'
import { listSettings, setSetting, unsetSetting } from '#cli/settings.js'
import { clearSecrets, deleteSecret, listSecrets, promptHidden, secretName, setSecret } from '#core/secrets.js'
import { log, UserError } from '#core/util.js'
import { doctor } from '#cli/doctor.js'

/** @type {Record<string, (cli: import('#cli/args.js').Cli) => Promise<void>>} */
export const machineCommands = {
  doctor: async ({ values, config }) => {
    const checks = await doctor(config)
    if (values.json) return void process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`)
    for (const c of checks) process.stdout.write(`${c.ok ? '✔' : '✘'} ${c.name.padEnd(22)} ${c.detail}\n`)
    if (checks.some(c => !c.ok && ['ffmpeg', 'ffprobe', 'Chromium'].includes(c.name))) process.exitCode = 1
  },
  config: async ({ values, positionals }) => {
    const [sub, key, ...value] = positionals
    if (sub === 'set') {
      if (!key || !value.length) throw new UserError('usage: tourwright config set <setting> <value>')
      const saved = setSetting(key, value.join(' '))
      log.info(`${key} = ${saved} (in ${userConfigFile()})`)
      return
    }
    if (sub === 'unset') {
      if (!key) throw new UserError('usage: tourwright config unset <setting>')
      unsetSetting(key)
      log.info(`${key}: back to its default`)
      return
    }
    if (sub === 'path') return void process.stdout.write(`${userConfigFile()}\n`)
    if (sub) throw new UserError(`unknown: tourwright config ${sub} (use set, unset or path)`)
    const settings = listSettings(reloadConfig())
    if (values.json) return void process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`)
    for (const s of settings) {
      const value = s.value === undefined || s.value === null ? '—' : String(s.value)
      process.stdout.write(`${s.key.padEnd(14)} ${value.padEnd(28)} ${s.from === 'default' ? '' : `(${s.from})`}\n`)
    }
    process.stdout.write(`\nChange one: tourwright config set quality fullhd · back to default: tourwright config unset quality\n`)
  },
  clean: async ({ values, config }) => {
    const { clean, diskUsage, human } = await import('#install/clean.js')
    const show = async title => {
      const parts = await diskUsage(config)
      if (values.json) return parts
      process.stdout.write(`\n${title}\n`)
      for (const p of parts) process.stdout.write(`  ${human(p.bytes).padStart(8)}  ${p.name.padEnd(50)} ${p.remove && p.remove !== 'always' ? `${p.remove}: ` : ''}${p.note ?? ''}\n`)
      return parts
    }
    const before = await show('Tourwright on this disk:')
    const removed = await clean(reloadConfig(), { voiceCache: values['voice-cache'], pocket: values.pocket, whisper: values.whisper })
    const freed = removed.reduce((a, r) => a + r.bytes, 0)
    if (values.json) return void process.stdout.write(`${JSON.stringify({ before, removed, freed }, null, 2)}\n`)
    process.stdout.write(`\n${freed ? `Removed ${human(freed)}: ${removed.map(r => `${r.name} (${human(r.bytes)})`).join(', ')}` : 'Nothing to remove'}\n`)
    if (!values['voice-cache'] && !values.pocket && !values.whisper) process.stdout.write('More with --voice-cache, --pocket or --whisper (see the list above)\n')
  },
  secret: async ({ values, positionals, config }) => {
    const [action, name] = positionals
    if (action === 'set') {
      if (!name) throw new UserError('usage: tourwright secret set <NAME>')
      const saved = setSecret(config, name, await promptHidden(`value of ${secretName(name)} (not shown): `))
      log.info(`${saved} saved. In a script: "\${secret:${saved}}"`)
    } else if (action === 'list') {
      const all = listSecrets(config)
      if (values.json) return void process.stdout.write(`${JSON.stringify(all, null, 2)}\n`)
      if (!all.length) process.stdout.write('no secrets saved (tourwright secret set <NAME>)\n')
      for (const s of all) process.stdout.write(`${s.name.padEnd(28)} ${s.source === 'saved' ? `saved ${s.savedAt.slice(0, 16).replace('T', ' ')}` : 'from the environment'}\n`)
    } else if (action === 'delete') {
      if (!name) throw new UserError('usage: tourwright secret delete <NAME>')
      log.info(deleteSecret(config, name) ? `${secretName(name)} deleted` : `${secretName(name)} was not saved`)
    } else throw new UserError('usage: tourwright secret set|list|delete [NAME]')
  },
  forget: async ({ config }) => {
    const secrets = clearSecrets(config)
    const sessions = clearSessions(config)
    log.info(`deleted ${secrets} secret${secrets === 1 ? '' : 's'} and ${sessions} session${sessions === 1 ? '' : 's'}`)
    if (listSecrets(config).length) log.warn('TOURWRIGHT_SECRET_* variables are still set in the environment: remove them where they were set')
  },
  serve: async ({ values, config }) => {
    if (values.port) config.api.port = Number(values.port)
    if (values.host) config.api.host = values.host
    const { startServer } = await import('#server/http.js')
    await startServer(config, { worker: values.worker })
  },
  worker: async ({ config }) => {
    const { startWorker } = await import('#server/worker.js')
    await startWorker(config)
  },
  mcp: async ({ config }) => {
    const { startMcp } = await import('#server/mcp.js')
    await startMcp(config)
  },
}
