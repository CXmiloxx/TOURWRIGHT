// Commands that make, check and fix videos from a script.
// Each command gets the parsed options (`values`, `positionals`), the config and the script variables (--var).
import { existsSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { render } from '#render/index.js'
import { loadFile, missingSecretsMessage, secretsIn, secretsShown } from '#script/load.js'
import { jsonSchema } from '#script/schema.js'
import { checkScript, markdownReport, textReport, writeFixes } from '#authoring/repair.js'
import { getSecret } from '#core/secrets.js'
import { log, openPath, UserError } from '#core/util.js'
import { EXAMPLE } from '#cli/help.js'
import { progressLine } from '#cli/progress.js'

/** @type {Record<string, (cli: import('#cli/args.js').Cli) => Promise<void>>} */
export const videosCommands = {
  render: async ({ values, positionals, config, vars }) => {
    if (!positionals[0]) throw new UserError('usage: tourwright render <script>')
    const loaded = await loadFile(positionals[0], { vars })
    const progress = progressLine()
    const result = await render(loaded, {
      out: values.out,
      voice: values.voice,
      quality: values.quality,
      capture: values.capture,
      dryRun: values['dry-run'] || values.safe,
      safe: values.safe,
      keep: values.keep,
      steps: values.step,
      timeout: values.timeout ? Number(values.timeout) : undefined,
      width: values.width ? Number(values.width) : undefined,
      height: values.height ? Number(values.height) : undefined,
      fresh: values.fresh,
      export: values.export?.split(',').map(e => e.trim()).filter(Boolean),
      onProgress: progress.onProgress,
    }, config).finally(progress.done)
    if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else if (result.dryRun) log.info(`${result.safe ? 'safe ' : ''}dry run: script ran to the end in ${result.seconds} s`)
    else {
      const { video, audio, silent, thumbnail, srt, vtt, manifest } = result.paths
      const row = (label, file) => (file ? `  ${label.padEnd(11)}${file}\n` : '')
      process.stderr.write(`\n  ${Math.round(result.duration)} s · ${result.chapters.length} chapters · ${result.captions.length} captions\n` +
        row('video', video && basename(video)) + row('audio', audio && basename(audio)) + row('silent', silent && basename(silent)) +
        row('subtitles', srt && [srt, vtt].filter(Boolean).map(f => basename(f)).join(', ')) + row('poster', thumbnail && basename(thumbnail)) +
        `  folder     ${dirname(manifest)}\n\n`)
    }
    if (values.open && !result.dryRun) await openPath(result.paths.video ?? dirname(result.paths.manifest)).catch(e => log.warn(`could not open it: ${e.message}`))
  },
  validate: async ({ values, positionals, config, vars }) => {
    if (!positionals[0]) throw new UserError('usage: tourwright validate <script>')
    // --no-vars: the format and the names only; variables without a value stay as they are written
    const unset = values['no-vars'] ? new Set() : undefined
    const loaded = await loadFile(positionals[0], { vars, missing: unset })
    log.info(`${positionals[0]}: valid ${loaded.kind} script${loaded.run ? ' (JavaScript)' : ''}`)
    if (unset?.size) log.info(`variables without a value (pass them with --var to render): ${[...unset].join(', ')}`)
    const secrets = secretsIn(loaded.script)
    if (unset) {
      if (secrets.length) log.info(`secrets it uses: ${secrets.join(', ')}`)
      return
    }
    // Secrets are checked here too: a missing one is found before a render, not during it
    const missing = secrets.filter(n => getSecret(config, n) === undefined)
    if (missing.length) log.warn(missingSecretsMessage(missing))
    const shown = loaded.kind === 'browser' ? secretsShown(loaded.script.steps) : []
    if (shown.length) log.warn(`${shown.join(', ')}: a secret outside \`type\`/\`fill\` in \`steps\` (a narration, a caption…) can be seen or heard in the video`)
    if (missing.length) process.exitCode = 2
  },
  recompose: async ({ values, positionals, config }) => {
    if (!positionals[0]) throw new UserError('usage: tourwright recompose <video folder>')
    const { recompose } = await import('#video/recompose.js')
    const result = await recompose(positionals[0], {
      voice: values.voice,
      polish: values.polish,
      clicks: values['no-clicks'] ? false : undefined,
      quality: values.quality,
      out: values.out,
    }, config)
    if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stderr.write(`\n  ${Math.round(result.duration)} s · ${result.captions.length} captions\n  video      ${result.paths.video}\n\n`)
    if (values.open) await openPath(result.paths.video).catch(e => log.warn(`could not open it: ${e.message}`))
  },
  guide: async ({ values, positionals, config, vars }) => {
    if (!positionals[0]) throw new UserError('usage: tourwright guide <script> [--out dir] [--open]')
    const result = await render(await loadFile(positionals[0], { vars }), { out: values.out, guide: true }, config)
    log.info(`guide: ${result.guide.steps} steps → ${result.guide.html} (and .md, with its images)`)
    if (values.open) openPath(result.guide.html)
  },
  narrate: async ({ values, positionals, config, vars }) => {
    // The plain narration rewritten by the AI the user brings; shown first, saved only with --write
    if (!positionals[0]) throw new UserError('usage: tourwright narrate <script> [--write]')
    const { proposeNarration, writeNarration } = await import('#ai/narrate.js')
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
  },
  translate: async ({ values, positionals, config }) => {
    if (!positionals[0] || !values.to) throw new UserError('usage: tourwright translate <script.yaml> --to en|es|pt|fr|de|it [--out f.yaml] [--yes]')
    const { translateFile } = await import('#ai/translate.js')
    log.info(`translating ${positionals[0]} with your AI…`)
    const r = await translateFile(positionals[0], { to: values.to, out: values.out, yes: values.yes }, config)
    for (const k of r.kept) process.stdout.write(`kept as it was (${k.why}): ${k.text}\n`)
    log.info(`${r.out}: ${r.translated} lines translated. Make the video: tourwright render ${r.out}`)
  },
  check: async ({ values, positionals, config, vars }) => {
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
  },
  fix: async ({ values, positionals, config, vars }) => {
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
  },
  init: async ({ positionals }) => {
    const file = positionals[0] ?? 'video.yaml'
    if (existsSync(file)) throw new UserError(`${file} already exists`)
    writeFileSync(file, EXAMPLE)
    log.info(`${file} written — tourwright render ${file}`)
  },
  schema: async () => {
    process.stdout.write(`${JSON.stringify(jsonSchema(), null, 2)}\n`)
  },
}
