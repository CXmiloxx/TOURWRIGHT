// tourwright <command> — see `tourwright help`.
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig, reloadConfig } from './config.js'
import { DEFAULT_VOICES, installAll, installVoice } from './install.js'
import { loadPlugins } from './plugins.js'
import { render } from './render/index.js'
import { clearSessions, deleteSession, listSessions } from './render/session.js'
import { loadFile, missingSecretsMessage, secretsIn } from './script/load.js'
import { jsonSchema } from './script/schema.js'
import { clearSecrets, deleteSecret, getSecret, listSecrets, promptHidden, secretName, setSecret } from './secrets.js'
import { log, UserError } from './util.js'
import { listVoices, narrate } from './voice/index.js'

const HELP = `tourwright — scripts into narrated videos

Usage:
  tourwright render <script> [options]        render a video (.yaml, .json, .js)
      --out <file.mp4|dir>                    where to write it (default: ./videos/<script>.mp4)
      --voice <voice>                         engine:id or alias (see \`tourwright voices\`); "none" = silent
      --quality sd|hd|fullhd|vertical|square
      --capture auto|screen|screencast|playwright
      --dry-run                               run the script fast, without voice or video (tests selectors)
      --fresh                                 log in again instead of reusing the saved session
      --timeout <s>                           maximum seconds
      --var name=value                        set a script variable ({{name}}); repeatable
      --json                                  print the manifest as JSON on stdout
  tourwright explore <url|script> [options]   the sections of a site and the targets to write a script
      --draft <file.yaml>                     write a first script that goes through every section
      --pages /a,/b                           these pages instead of the site's navigation
      --fresh                                 log in again instead of reusing the saved session
      --json                                  the report as JSON on stdout
  tourwright validate <script> [--var n=v]    check a script without running it (and its secrets)
  tourwright voices [--json]                  voices and engines available on this server
  tourwright say "<text>" [--voice v] [--out file.wav]
                                              say one text ([[1s]] = exact pause; voice?rate=+10%&pitch=+2st)
  tourwright install [options]                ffmpeg, Piper, voices, edge-tts and Chromium into TOURWRIGHT_HOME
                                              (Linux, macOS, Windows; no root, no Docker)
      --voices a,b                            Piper voices (default: ${DEFAULT_VOICES.join(',')})
      --no-edge                               skip edge-tts (Microsoft voices, online)
      --no-chromium                           skip Chromium
  tourwright install-voice <piper-voice>      download a Piper voice (es_MX-claude-high, en_US-lessac-medium…)
  tourwright doctor                           check ffmpeg, Xvfb, Chromium and TTS engines
  tourwright init [file]                      write an example script
  tourwright schema                           print the JSON Schema of declarative scripts
  tourwright serve [--port 4700] [--host h]   HTTP API (+ an embedded worker with --worker)
  tourwright worker                           process queued jobs
  tourwright mcp                              MCP server over stdio, for AI agents

Credentials and sessions (kept in TOURWRIGHT_HOME, readable only by you):
  tourwright secret set <NAME>                save a credential; the value is asked for and never shown.
                                              A script uses it as "\${secret:NAME}"
  tourwright secret list                      the names saved (never the values)
  tourwright secret delete <NAME>
  tourwright session list                     logins saved by \`session:\` in scripts
  tourwright session delete <name>
  tourwright forget                           delete every saved credential and session

Configuration: environment variables TOURWRIGHT_* or tourwright.config.json (see docs/CONFIGURATION.md).
`

const EXAMPLE = `# Tourwright script — https://github.com/CXmiloxx/tourwright
title: My first video
voice: piper:es_MX-claude-high
baseUrl: https://example.com
steps:
  - goto: /
  - title: { text: "Example Domain", subtitle: "A narrated walkthrough" }
  - say: "This is <b>example.com</b>, a page reserved for documentation."
  - highlight: h1
  - say: "Below the title there is a link with more information."
  - zoom: a
  - say: null
`

export const doctor = async (config = loadConfig()) => {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
  add('ffmpeg', config.ffmpeg, config.ffmpeg ?? 'missing: tourwright install, or TOURWRIGHT_FFMPEG')
  add('ffprobe', config.ffprobe, config.ffprobe ?? 'missing: comes with ffmpeg, or TOURWRIGHT_FFPROBE')
  add('Xvfb (best capture)', config.xvfb, config.xvfb ?? (process.platform === 'linux' ? 'optional: apt install xvfb — without it, screencast capture is used' : 'Linux only — screencast capture is used'))
  try {
    if (config.browsersPath) process.env.PLAYWRIGHT_BROWSERS_PATH ??= config.browsersPath
    const { chromium } = await import('playwright')
    const path = config.chromium ?? chromium.executablePath()
    add('Chromium', existsSync(path), existsSync(path) ? path : 'missing: tourwright install (or TOURWRIGHT_CHROMIUM)')
  } catch (error) {
    add('Chromium', false, error.message)
  }
  const voices = await listVoices(config)
  for (const [engine, state] of Object.entries(voices.engines)) add(`TTS ${engine}`, state.ok, state.ok ? JSON.stringify(state) : state.reason)
  const usable = voices.voices.filter(v => v.available)
  add('voices', usable.length, usable.length ? `${usable.length} usable · default ${voices.default}` : 'none: tourwright install-voice es_MX-claude-high')
  add('data dir', true, config.dataDir)
  return checks
}

// A mistyped option is the user's to fix: a short message, not a stack trace
/**
 * @template {import('node:util').ParseArgsConfig} T
 * @param {T} options
 * @returns {ReturnType<typeof parseArgs<T>>}
 */
const parseCliArgs = options => {
  try {
    return parseArgs(options)
  } catch (error) {
    if (String(error.code).startsWith('ERR_PARSE_ARGS_')) throw new UserError(`${error.message.split('. ')[0]} — tourwright help`)
    throw error
  }
}

export const main = async argv => {
  const [command, ...rest] = argv
  const { values, positionals } = parseCliArgs({
    args: rest,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      out: { type: 'string', short: 'o' },
      voice: { type: 'string' },
      quality: { type: 'string' },
      capture: { type: 'string' },
      'dry-run': { type: 'boolean' },
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
      fresh: { type: 'boolean' },
      draft: { type: 'string' },
      pages: { type: 'string' },
    },
  })
  if (values.help) return void process.stdout.write(HELP)
  const config = loadConfig()
  await loadPlugins(config)
  // --var name=value (repeatable) overrides the script's `vars`
  const vars = Object.fromEntries((values.var ?? []).map(pair => {
    const i = pair.indexOf('=')
    if (i < 1) throw new UserError(`--var ${pair}: use --var name=value`)
    return [pair.slice(0, i), pair.slice(i + 1)]
  }))
  switch (command) {
    case 'render': {
      if (!positionals[0]) throw new UserError('usage: tourwright render <script>')
      const loaded = await loadFile(positionals[0], { vars })
      const result = await render(loaded, {
        out: values.out,
        voice: values.voice,
        quality: values.quality,
        capture: values.capture,
        dryRun: values['dry-run'],
        timeout: values.timeout ? Number(values.timeout) : undefined,
        width: values.width ? Number(values.width) : undefined,
        height: values.height ? Number(values.height) : undefined,
        fresh: values.fresh,
        onProgress: p => log.info(`${p.stage}…`),
      }, config)
      if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      else if (result.dryRun) log.info(`dry run: script ran to the end in ${result.seconds} s`)
      else log.info(`video: ${result.paths.video} · ${Math.round(result.duration)} s · ${result.chapters.length} chapters · ${result.captions.length} captions`)
      return
    }
    case 'explore': {
      if (!positionals[0]) throw new UserError('usage: tourwright explore <url|script> [--draft file.yaml]')
      const { explore, printReport } = await import('./explore.js')
      const report = await explore(positionals[0], { draft: values.draft, fresh: values.fresh, pages: values.pages?.split(',').map(p => p.trim()).filter(Boolean) }, config)
      if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      else printReport(report)
      return
    }
    case 'validate': {
      if (!positionals[0]) throw new UserError('usage: tourwright validate <script>')
      const loaded = await loadFile(positionals[0], { vars })
      log.info(`${positionals[0]}: valid ${loaded.kind} script${loaded.run ? ' (JavaScript)' : ''}`)
      // Secrets are checked here too: a missing one is found before a render, not during it
      const missing = secretsIn(loaded.script).filter(n => getSecret(config, n) === undefined)
      if (missing.length) log.warn(missingSecretsMessage(missing))
      if (loaded.kind === 'browser' && secretsIn(loaded.script.steps).length) log.warn('a secret is used on camera (in `steps`): use it in `setup`, or blur the field')
      if (missing.length) process.exitCode = 2
      return
    }
    case 'secret': {
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
      return
    }
    case 'session': {
      const [action, name] = positionals
      if (action === 'list') {
        const all = listSessions(config)
        if (values.json) return void process.stdout.write(`${JSON.stringify(all, null, 2)}\n`)
        if (!all.length) process.stdout.write('no sessions saved\n')
        for (const s of all) process.stdout.write(`${s.name.padEnd(36)} saved ${s.savedAt.slice(0, 16).replace('T', ' ')}\n`)
      } else if (action === 'delete') {
        if (!name) throw new UserError('usage: tourwright session delete <name>')
        log.info(deleteSession(config, name) ? `session ${name} deleted: the next render logs in again` : `there is no session ${name}`)
      } else throw new UserError('usage: tourwright session list|delete [name]')
      return
    }
    case 'forget': {
      const secrets = clearSecrets(config)
      const sessions = clearSessions(config)
      log.info(`deleted ${secrets} secret${secrets === 1 ? '' : 's'} and ${sessions} session${sessions === 1 ? '' : 's'}`)
      if (listSecrets(config).length) log.warn('TOURWRIGHT_SECRET_* variables are still set in the environment: remove them where they were set')
      return
    }
    case 'voices': {
      const v = await listVoices(config)
      if (values.json) return void process.stdout.write(`${JSON.stringify(v, null, 2)}\n`)
      process.stdout.write(`default: ${v.default}\n\n`)
      for (const [e, s] of Object.entries(v.engines)) process.stdout.write(`${s.ok ? '✔' : '✘'} ${e.padEnd(8)} ${s.ok ? '' : s.reason}\n`)
      process.stdout.write('\n')
      for (const voice of v.voices) process.stdout.write(`${voice.available ? '✔' : ' '} ${voice.name.padEnd(30)} ${voice.voice}\n`)
      return
    }
    case 'say': {
      const text = positionals.join(' ')
      if (!text) throw new UserError('usage: tourwright say "<text>" [--voice v] [--out file.wav]')
      const n = await narrate(text, values.voice, config)
      const out = resolve(values.out ?? 'say.wav')
      const { ffmpeg } = await import('./compose.js')
      await ffmpeg(['-i', n.file, out], config)
      log.info(`${out} · ${n.duration.toFixed(1)} s · ${n.voice}`)
      return
    }
    case 'install': {
      const voices = values.voices === undefined ? DEFAULT_VOICES : values.voices.split(/[\s,]+/).filter(Boolean)
      await installAll({ voices, edge: !values['no-edge'], chromium: !values['no-chromium'] }, config)
      // A fresh look: what was just installed is found now
      const checks = await doctor(reloadConfig())
      for (const c of checks) process.stdout.write(`${c.ok ? '✔' : '✘'} ${c.name.padEnd(22)} ${c.detail}\n`)
      return
    }
    case 'install-voice': {
      if (!positionals.length) throw new UserError('usage: tourwright install-voice <voice> [voice…]')
      for (const v of positionals) log.info(`installed ${await installVoice(v, config)}`)
      return
    }
    case 'doctor': {
      const checks = await doctor(config)
      if (values.json) return void process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`)
      for (const c of checks) process.stdout.write(`${c.ok ? '✔' : '✘'} ${c.name.padEnd(22)} ${c.detail}\n`)
      if (checks.some(c => !c.ok && ['ffmpeg', 'ffprobe', 'Chromium'].includes(c.name))) process.exitCode = 1
      return
    }
    case 'init': {
      const file = positionals[0] ?? 'video.yaml'
      if (existsSync(file)) throw new UserError(`${file} already exists`)
      writeFileSync(file, EXAMPLE)
      log.info(`${file} written — tourwright render ${file}`)
      return
    }
    case 'schema':
      process.stdout.write(`${JSON.stringify(jsonSchema(), null, 2)}\n`)
      return
    case 'serve': {
      if (values.port) config.api.port = Number(values.port)
      if (values.host) config.api.host = values.host
      const { startServer } = await import('./server/http.js')
      await startServer(config, { worker: values.worker })
      return
    }
    case 'worker': {
      const { startWorker } = await import('./worker.js')
      await startWorker(config)
      return
    }
    case 'mcp': {
      const { startMcp } = await import('./mcp.js')
      await startMcp(config)
      return
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP)
      return
    case '--version':
    case 'version': {
      const { readFileSync } = await import('node:fs')
      process.stdout.write(`${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}\n`)
      return
    }
    default:
      throw new UserError(`unknown command "${command}" — tourwright help`)
  }
}
