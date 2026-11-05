// Commands for voices and for what Tourwright installs.
// Each command gets the parsed options (`values`, `positionals`), the config and the script variables (--var).
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { reloadConfig } from '#core/config.js'
import { DEFAULT_VOICES, installAll, installVoice, planInstall } from '#install/index.js'
import { log, openPath, UserError } from '#core/util.js'
import { autoVoice, listVoices, narrate, recordSamples, SAMPLES_DIR, SAMPLES_URL } from '#voice/index.js'
import { doctor } from '#cli/doctor.js'

/** @type {Record<string, (cli: import('#cli/args.js').Cli) => Promise<void>>} */
export const voicesCommands = {
  voices: async ({ values, positionals, config }) => {
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
  },
  say: async ({ values, positionals, config }) => {
    const text = positionals.join(' ')
    if (!text) throw new UserError('usage: tourwright say "<text>" [--voice v] [--out file.wav]')
    const n = await narrate(text, values.voice, config)
    const out = resolve(values.out ?? 'say.wav')
    const { ffmpeg } = await import('#video/ffmpeg.js')
    await ffmpeg(['-i', n.file, out], config)
    log.info(`${out} · ${n.duration.toFixed(1)} s · ${n.voice}`)
  },
  install: async ({ values, config }) => {
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
  },
  'install-voice': async ({ positionals, config }) => {
    if (!positionals.length) throw new UserError('usage: tourwright install-voice <voice> [voice…]')
    for (const v of positionals) log.info(`installed ${await installVoice(v, config)}`)
  },
}
