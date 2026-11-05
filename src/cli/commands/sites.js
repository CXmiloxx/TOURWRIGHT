// Commands that look at a site: explore it, record a tour by hand, log in by hand.
// Each command gets the parsed options (`values`, `positionals`), the config and the script variables (--var).
import { existsSync } from 'node:fs'
import { deleteSession, listSessions } from '#render/browser/session.js'
import { loadFile } from '#script/load.js'
import { log, UserError } from '#core/util.js'

/** @type {Record<string, (cli: import('#cli/args.js').Cli) => Promise<void>>} */
export const sitesCommands = {
  explore: async ({ values, positionals, config }) => {
    if (!positionals[0]) throw new UserError('usage: tourwright explore <url|script> [--draft file.yaml]')
    const { explore, printReport } = await import('#authoring/explore/index.js')
    const report = await explore(positionals[0], { draft: values.draft, fresh: values.fresh, login: /** @type {any} */ (values.login), pages: values.pages?.split(',').map(p => p.trim()).filter(Boolean) }, config)
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printReport(report)
  },
  record: async ({ values, positionals, config }) => {
    if (!positionals[0]) throw new UserError('usage: tourwright record <url> [--out script.yaml] [--language es|en] [--no-video] [--plain]')
    const { record } = await import('#authoring/record/index.js')
    const out = values.out ?? 'recorded.yaml'
    if (existsSync(out) && !values.yes) throw new UserError(`${out} already exists: choose another --out (or --yes to replace it)`)
    await record(positionals[0], { out, language: values.language ?? 'es', video: !values['no-video'], studio: !values.plain }, config)
  },
  session: async ({ values, positionals, config }) => {
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
      const { launch, urlResolver } = await import('#render/browser/launch.js')
      const { loginByHand, sessionPath } = await import('#render/browser/session.js')
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
  },
}
