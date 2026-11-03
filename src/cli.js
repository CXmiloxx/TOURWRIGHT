// tourwright <command> — see `tourwright help`.
import { existsSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { loadConfig, reloadConfig, userConfigFile } from './config.js'
import { DEFAULT_VOICES, installAll, installVoice, planInstall } from './install.js'
import { loadPlugins } from './plugins.js'
import { findChromium } from './render/chromium.js'
import { render } from './render/index.js'
import { clearSessions, deleteSession, listSessions } from './render/session.js'
import { loadFile, missingSecretsMessage, secretsIn, secretsShown } from './script/load.js'
import { jsonSchema } from './script/schema.js'
import { checkScript, markdownReport, textReport, writeFixes } from './repair.js'
import { listSettings, setSetting, unsetSetting } from './settings.js'
import { clearSecrets, deleteSecret, getSecret, listSecrets, promptHidden, secretName, setSecret } from './secrets.js'
import { log, openPath, setStatus, UserError } from './util.js'
import { autoVoice, listVoices, narrate, recordSamples, SAMPLES_DIR, SAMPLES_URL } from './voice/index.js'

const HELP = `tourwright — scripts into narrated videos

From a site to a video:
  tourwright explore https://app.example.com/login --draft app.yaml
                                              finds the login (asks for the credentials, never shows them),
                                              the sections and their targets, and writes a first script
  tourwright render app.yaml --dry-run        runs every step in seconds: checks the targets
  tourwright render app.yaml --open           records it with narration; opens the video when done

Usage:
  tourwright render <script> [options]        render a video (.yaml, .json, .js)
      --out <file.mp4|dir>                    where to write it (default: ./videos/<script>/<script>.mp4)
      --export video,audio,silent             what to deliver: the narrated video (default), only the sound
                                              (.mp3), the video without sound; subtitles and poster always come
      --open                                  open the video (or its folder) when it is ready
      --voice <voice>                         engine:id or alias (see \`tourwright voices\`); "none" = silent
      --quality sd|hd|fullhd|vertical|square
      --capture auto|screen|screencast|playwright
      --dry-run                               run the script fast, without voice or video (tests selectors)
      --fresh                                 log in again instead of reusing the saved session
      --step <n|a-b>                          film only that step (or range), with its voice: the steps before
                                              run fast off camera. Saved as <name>-step<n>.mp4
      --timeout <s>                           maximum seconds
      --var name=value                        set a script variable ({{name}}); repeatable
      --json                                  print the manifest as JSON on stdout
      --lock <file>                           one browser at a time on this machine: wait for this lock file
                                              (on Linux the same lock as flock <file>; also TOURWRIGHT_BROWSER_LOCK)
  tourwright explore <url|script> [options]   the sections of a site and the targets to write a script
      --draft <file.yaml>                     write a first script that goes through every section
      --pages /a,/b                           these pages instead of the site's navigation
      --login setup|camera                    the draft logs in off camera (setup, default) or on camera
      --fresh                                 log in again instead of reusing the saved session
      --json                                  the report as JSON on stdout
  tourwright record <url> [--out f.yaml]      do the tour by hand in a browser window: each click and field
                                              becomes a step with a first narration (--language es|en)
  tourwright validate <script> [--var n=v]    check a script without running it (and its secrets)
  tourwright guide <script> [--out d] [--open] the script as a step-by-step guide with screenshots: one HTML file
                                              to send or print as PDF, and Markdown with its images
  tourwright narrate <script> [--write]       the narration rewritten by your AI from what each screen shows
                                              (tourwright config set ai anthropic|openai|ollama); --write saves it
  tourwright check <script…> [--json]         dry-run each one: every broken step, with the likely fix; exit 1
      --report <file.md>                      if one broke (CI). In GitHub Actions it also fills the job summary
  tourwright fix <script> [--write]           propose the new target for each broken step; --write saves them
  tourwright voices [--json] [--open]         voices and engines here; --open opens the samples of each voice
  tourwright voices --samples [names] [--text "…"] [--out dir]
                                              record a sample of each voice (default: ./videos/voces/)
  tourwright say "<text>" [--voice v] [--out file.wav]
                                              say one text ([[1s]] = exact pause; voice?rate=+10%&pitch=+2st)
  tourwright install [options]                ffmpeg, Piper, voices, edge-tts and Chromium into TOURWRIGHT_HOME
                                              (Linux, macOS, Windows; no root, no Docker)
      --voices a,b                            Piper voices (default: ${DEFAULT_VOICES.join(',')})
      --no-edge                               skip edge-tts (Microsoft voices, online)
      --no-chromium                           skip Chromium
      --plan                                  only show what is used from this PC and what would be downloaded
      --yes, -y                               download without asking (it asks only in a terminal)
      --pocket                                Pocket TTS: open, natural voices (Spanish: pocket:lola), CPU only;
                                              about 1 GB with PyTorch. Becomes the default voice
  tourwright install-voice <piper-voice>      download a Piper voice (es_MX-claude-high, en_US-lessac-medium…)
  tourwright doctor                           check ffmpeg, Xvfb, Chromium and TTS engines
  tourwright config [--json]                  your defaults (quality, voice, fps…) and where each one comes from
  tourwright config set <setting> <value>     change one for every project on this machine (e.g. quality fullhd)
  tourwright config unset <setting>           back to the default
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
  tourwright session login <script>           log in by hand in a browser window (Google, SSO, a captcha,
                                              a code by SMS) and save it as the script's \`session\`
  tourwright session list                     logins saved by \`session:\` in scripts
  tourwright session delete <name>
  tourwright forget                           delete every saved credential and session

Disk:
  tourwright clean [options]                  what each part takes, and removes downloads and leftovers
      --voice-cache                           also the sentences already said (made again when needed)
      --pocket                                also Pocket TTS and its models (the default voice goes back to Piper)
      --whisper                               also Whisper and its models (installed by Tourwright 1.1, no longer used)

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

// A render's progress on stderr: a line that updates itself in a terminal (stage, step, time so far), one
// line per stage elsewhere (CI logs, pipes)
const progressLine = () => {
  const started = Date.now()
  const live = process.stderr.isTTY && process.env.TOURWRIGHT_LOG_FORMAT !== 'json'
  let stage = ''
  return {
    onProgress: p => {
      if (!live) {
        if (p.stage !== stage) log.info(`${p.stage}…`)
        stage = p.stage
        return
      }
      const s = Math.round((Date.now() - started) / 1000)
      setStatus(`[tourwright] ${p.stage}${p.step ? ` · step ${p.step}/${p.steps}` : ''} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    },
    done: () => live && setStatus(''),
  }
}

export const doctor = async (config = loadConfig()) => {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
  add('ffmpeg', config.ffmpeg, config.ffmpeg ?? 'missing: tourwright install, or TOURWRIGHT_FFMPEG')
  add('ffprobe', config.ffprobe, config.ffprobe ?? 'missing: comes with ffmpeg, or TOURWRIGHT_FFPROBE')
  add('Xvfb (best capture)', config.xvfb, config.xvfb ?? (process.platform === 'linux' ? 'optional: apt install xvfb — without it, screencast capture is used' : 'Linux only — screencast capture is used'))
  try {
    const found = await findChromium(config)
    const { chromium } = await import('playwright')
    const path = found.path ?? chromium.executablePath()
    const ok = found.source !== 'missing' && existsSync(path)
    add('Chromium', ok, ok ? `${path}${found.source === 'system' ? ' (from the system)' : ''}` : 'missing: tourwright install, a Chrome or Edge on the system, or TOURWRIGHT_CHROMIUM')
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
      plan: { type: 'boolean' },
      report: { type: 'string' },
      write: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  })
  if (values.help) return void process.stdout.write(HELP)
  // Before the config is read: renders started by a worker inherit it
  if (values.lock) process.env.TOURWRIGHT_BROWSER_LOCK = resolve(values.lock)
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
      const progress = progressLine()
      const result = await render(loaded, {
        out: values.out,
        voice: values.voice,
        quality: values.quality,
        capture: values.capture,
        dryRun: values['dry-run'],
        steps: values.step,
        timeout: values.timeout ? Number(values.timeout) : undefined,
        width: values.width ? Number(values.width) : undefined,
        height: values.height ? Number(values.height) : undefined,
        fresh: values.fresh,
        export: values.export?.split(',').map(e => e.trim()).filter(Boolean),
        onProgress: progress.onProgress,
      }, config).finally(progress.done)
      if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      else if (result.dryRun) log.info(`dry run: script ran to the end in ${result.seconds} s`)
      else {
        const { video, audio, silent, thumbnail, srt, vtt, manifest } = result.paths
        const row = (label, file) => (file ? `  ${label.padEnd(11)}${file}\n` : '')
        process.stderr.write(`\n  ${Math.round(result.duration)} s · ${result.chapters.length} chapters · ${result.captions.length} captions\n` +
          row('video', video && basename(video)) + row('audio', audio && basename(audio)) + row('silent', silent && basename(silent)) +
          row('subtitles', srt && [srt, vtt].filter(Boolean).map(f => basename(f)).join(', ')) + row('poster', thumbnail && basename(thumbnail)) +
          `  folder     ${dirname(manifest)}\n\n`)
      }
      if (values.open && !result.dryRun) await openPath(result.paths.video ?? dirname(result.paths.manifest)).catch(e => log.warn(`could not open it: ${e.message}`))
      return
    }
    case 'explore': {
      if (!positionals[0]) throw new UserError('usage: tourwright explore <url|script> [--draft file.yaml]')
      const { explore, printReport } = await import('./explore.js')
      const report = await explore(positionals[0], { draft: values.draft, fresh: values.fresh, login: /** @type {any} */ (values.login), pages: values.pages?.split(',').map(p => p.trim()).filter(Boolean) }, config)
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
      const shown = loaded.kind === 'browser' ? secretsShown(loaded.script.steps) : []
      if (shown.length) log.warn(`${shown.join(', ')}: a secret outside \`type\`/\`fill\` in \`steps\` (a narration, a caption…) can be seen or heard in the video`)
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
      } else if (action === 'login') {
        if (!name) throw new UserError('usage: tourwright session login <script>')
        const loaded = await loadFile(name, { allowJs: true })
        if (loaded.kind !== 'browser' || !loaded.script.session) throw new UserError(`${name}: a session is saved under the script's \`session: name\`, add it to the script`)
        const script = loaded.script
        if (!process.stdin.isTTY) throw new UserError('session login needs someone at the keyboard: it opens a browser to log in by hand')
        const { launch, urlResolver } = await import('./render/browser.js')
        const { loginByHand, sessionPath } = await import('./render/session.js')
        const { createInterface } = await import('node:readline/promises')
        const { resolveUrl } = urlResolver(script, loaded.dir, false)
        const start = script.sessionCheck?.goto ?? script.steps.find(s => 'goto' in s)?.goto ?? '/'
        const browser = await launch({ headless: false, display: null, width: 1280, height: 800, locale: script.language === 'en' ? 'en-US' : (script.language ?? 'es-CO') }, config)
        const rl = createInterface({ input: process.stdin, output: process.stderr })
        try {
          await loginByHand({
            browser,
            url: resolveUrl(start),
            sessionFile: sessionPath(config, script.session),
            notUrl: script.sessionCheck?.notUrl,
            done: () => rl.question('log in in the browser window (Google, SSO, a code…), then press Enter here ')
          })
        } finally {
          rl.close()
          await browser.close().catch(() => {})
        }
        log.info(`session ${script.session} saved: renders of ${name} start logged in (setup is skipped while it lasts)`)
      } else throw new UserError('usage: tourwright session login|list|delete [script|name]')
      return
    }
    case 'clean': {
      const { clean, diskUsage, human } = await import('./clean.js')
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
      if (values.check) log.warn('voices --check was retired: every voice comes calibrated. If one says a word wrong, `pronounce` in the script fixes it')
      if (values.samples) {
        const out = resolve(values.out ?? join('videos', 'voces'))
        log.info(`recording a sample of each voice in ${out}…`)
        const made = await recordSamples(config, { out, text: values.text, only: positionals })
        for (const s of made) process.stdout.write(s.file ? `✔ ${s.language}/${basename(s.file)}\n` : `✘ ${s.language}/${s.name}: ${s.error}\n`)
        process.stdout.write(`\nListen to them in ${out} and put the one you like in the script: voice: <name>\n`)
        if (values.open) await openPath(out).catch(() => {})
        return
      }
      const v = await listVoices(config)
      if (values.json) return void process.stdout.write(`${JSON.stringify(v, null, 2)}\n`)
      process.stdout.write(config.tts.voiceChosen ? `default: ${v.default}\n\n`
        : `default: automatic, the most natural for the script's language: Pocket TTS when installed, else Microsoft's neural voices (internet), else Piper. Now in Spanish: ${await autoVoice('es', config)} · in English: ${await autoVoice('en', config)}\n(tourwright config set voice <name> to always use one)\n\n`)
      for (const [e, s] of Object.entries(v.engines)) process.stdout.write(`${s.ok ? '✔' : '✘'} ${e.padEnd(8)} ${s.ok ? '' : s.reason}\n`)
      process.stdout.write('\n')
      const NAMES = { es: 'Español', en: 'English', fr: 'Français', de: 'Deutsch', it: 'Italiano', pt: 'Português' }
      for (const lang of [...new Set(v.voices.flatMap(x => x.languages))]) {
        process.stdout.write(`\n${NAMES[lang] ?? lang}\n`)
        for (const voice of v.voices.filter(x => x.languages.includes(lang))) {
          const sample = voice.samples[lang] ? `♪ ${lang}/${basename(voice.samples[lang])}` : ''
          process.stdout.write(`  ${voice.available ? '✔' : ' '} ${voice.name.padEnd(28)} ${voice.voice.padEnd(46)} ${sample}\n`)
        }
      }
      // The samples come with a clone of the repository, not with the npm package: there, they are online
      const samples = existsSync(SAMPLES_DIR) ? SAMPLES_DIR : SAMPLES_URL
      process.stdout.write(`\nListen before choosing: a sample of each voice is in ${samples}\n(tourwright voices --open opens it; --samples records them on this machine, with your text if you like)\n`)
      if (values.open) await openPath(samples).catch(() => {})
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
      if (values.whisper) log.warn('--whisper: Whisper is no longer needed (the voices come calibrated), skipped')
      const options = { voices, edge: !values['no-edge'], chromium: !values['no-chromium'], pocket: values.pocket }
      // What is already on this PC is used; only the rest is downloaded, and it is said first
      const plan = await planInstall(options, config)
      const downloads = plan.filter(p => p.download && p.mb)
      for (const p of plan) {
        const what = p.use ?? `${p.download}${p.mb ? ` (~${p.mb} MB)` : ''}`
        process.stderr.write(`  ${p.use ? 'use     ' : 'download'}  ${p.name.padEnd(28)} ${what}\n`)
      }
      const total = downloads.reduce((a, p) => a + (p.mb ?? 0), 0)
      process.stderr.write(downloads.length ? `  about ${total} MB to download into ${config.home}\n` : '  nothing to download\n')
      if (values.plan) return
      if (downloads.length && !values.yes && process.stdin.isTTY && process.stderr.isTTY) {
        const ask = createInterface({ input: process.stdin, output: process.stderr })
        const answer = (await ask.question('Download them? [Y/n] ')).trim().toLowerCase()
        ask.close()
        if (answer.startsWith('n')) {
          process.stderr.write('Nothing was downloaded. To use what you already have: TOURWRIGHT_FFMPEG, TOURWRIGHT_PIPER_BIN,\n' +
            'TOURWRIGHT_EDGE_TTS_BIN, TOURWRIGHT_CHROMIUM (docs/CONFIGURATION.md)\n')
          return
        }
      }
      await installAll(options, config)
      // A fresh look, in one line: what was just installed is found now. The full list is `tourwright doctor`.
      const checks = await doctor(reloadConfig())
      // What was skipped on purpose (--no-chromium) is not reported missing
      const needed = checks.filter(c => ['ffmpeg', 'ffprobe', 'voices', ...(values['no-chromium'] ? [] : ['Chromium'])].includes(c.name))
      const broken = needed.filter(c => !c.ok)
      for (const c of broken) process.stdout.write(`✘ ${c.name.padEnd(22)} ${c.detail}\n`)
      if (broken.length) process.exitCode = 1
      else process.stdout.write(`✔ ready to render (${checks.filter(c => c.ok).length} checks passed; tourwright doctor lists them)\n`)
      return
    }
    case 'install-voice': {
      if (!positionals.length) throw new UserError('usage: tourwright install-voice <voice> [voice…]')
      for (const v of positionals) log.info(`installed ${await installVoice(v, config)}`)
      return
    }
    case 'record': {
      if (!positionals[0]) throw new UserError('usage: tourwright record <url> [--out script.yaml] [--language es|en]')
      const { record } = await import('./record.js')
      const out = values.out ?? 'recorded.yaml'
      if (existsSync(out) && !values.yes) throw new UserError(`${out} already exists: choose another --out (or --yes to replace it)`)
      await record(positionals[0], { out, language: values.language ?? 'es' }, config)
      return
    }
    case 'guide': {
      if (!positionals[0]) throw new UserError('usage: tourwright guide <script> [--out dir] [--open]')
      const result = await render(await loadFile(positionals[0], { vars }), { out: values.out, guide: true }, config)
      log.info(`guide: ${result.guide.steps} steps → ${result.guide.html} (and .md, with its images)`)
      if (values.open) openPath(result.guide.html)
      return
    }
    case 'narrate': {
      // The plain narration rewritten by the AI the user brings; shown first, saved only with --write
      if (!positionals[0]) throw new UserError('usage: tourwright narrate <script> [--write]')
      const { proposeNarration, writeNarration } = await import('./narrate.js')
      log.info('capturing each step and asking the AI…')
      const proposals = await proposeNarration(await loadFile(positionals[0], { vars }), config)
      for (const p of proposals) {
        // A line the AI wrote against the rules is shown too, with why the old one stays
        if (p.kept) process.stdout.write(`\n[${p.step}] ${p.before}\n   = unchanged: the AI's line was refused (${p.kept})\n`)
        else if (p.after !== p.before) process.stdout.write(`\n[${p.step}] ${p.before}\n   → ${p.after}\n`)
      }
      const changed = proposals.filter(p => !p.kept && p.after !== p.before).length
      if (!changed) return void log.info('the AI proposed no change')
      if (!values.write) return void log.info(`${changed} new line${changed === 1 ? '' : 's'}: tourwright narrate ${positionals[0]} --write saves them (the old script is kept)`)
      const { applied, backup } = writeNarration(positionals[0], proposals)
      log.info(`${applied} line${applied === 1 ? '' : 's'} saved in ${positionals[0]}${backup ? `; the old one is in ${backup}` : ''}`)
      return
    }
    case 'check': {
      // Every script as a dry run: what broke, where, and the likely fix. Exit code 1 when one is broken (CI).
      if (!positionals.length) throw new UserError('usage: tourwright check <script…> [--json] [--report file.md]')
      const results = []
      for (const file of positionals) {
        let loaded
        try {
          loaded = await loadFile(file, { vars })
        } catch (error) {
          if (!(error instanceof UserError)) throw error
          results.push({ name: basename(file), ok: false, failures: [{ message: error.message }] })
          continue
        }
        log.info(`checking ${file}…`)
        results.push({ file, ...(await checkScript(loaded, {}, config)) })
      }
      const markdown = markdownReport(results)
      if (values.report) writeFileSync(values.report, markdown)
      // GitHub Actions shows it on the run's page
      if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' })
      process.stdout.write(values.json ? `${JSON.stringify(results, null, 2)}\n` : textReport(results))
      if (results.some(r => !r.ok)) process.exitCode = 1
      return
    }
    case 'fix': {
      if (!positionals[0]) throw new UserError('usage: tourwright fix <script> [--write]')
      const result = await checkScript(await loadFile(positionals[0], { vars }), {}, config)
      if (result.ok) return void log.info(`${positionals[0]}: every step works, nothing to fix`)
      const fixes = result.failures.map(f => f.fix).filter(Boolean)
      process.stdout.write(textReport([result]))
      if (!fixes.length) {
        process.exitCode = 1
        return void log.warn('no fix found: the screenshot of the failure marks what the page offers')
      }
      if (!values.write) return void log.info(`tourwright fix ${positionals[0]} --write puts ${fixes.length === 1 ? 'it' : `these ${fixes.length}`} in the file`)
      const applied = writeFixes(positionals[0], fixes)
      log.info(`${applied} target${applied === 1 ? '' : 's'} changed in ${positionals[0]}; run it again: tourwright render ${positionals[0]} --dry-run`)
      return
    }
    case 'config': {
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
