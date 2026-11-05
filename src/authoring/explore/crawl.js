// Going through the site: logged in like the script, each section opened, described and photographed; and the
// report a person reads.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import YAML from 'yaml'
import { loadConfig } from '#core/config.js'
import { launch, urlResolver } from '#render/browser/launch.js'
import { needsPrep, prepare, sessionPath } from '#render/browser/session.js'
import { dismissing } from '#render/steps/index.js'
import { fromData, interpolate, loadFile } from '#script/load.js'
import { log, UserError } from '#core/util.js'
import { DISMISS, draftScript, flow } from './draft.js'
import { askCredentials, findLogin, secretPrefix } from './login.js'
import { describe, outline, samePage, sections } from './page.js'

/**
 * @param {string} input   a URL, or a script file
 * @param {{ pages?: string[], draft?: string, fresh?: boolean, max?: number, login?: 'setup' | 'camera' }} [options]
 *   login: where the draft logs in, off camera in `setup` (default) or on camera, field by field
 */
export const explore = async (input, { pages: only, draft, fresh = false, max = 20, login: loginOn = 'setup' } = {}, config = loadConfig()) => {
  if (draft && existsSync(draft)) throw new UserError(`${draft} already exists: pick another name for the draft`)
  if (!['setup', 'camera'].includes(loginOn)) throw new UserError(`--login ${loginOn}: use setup (off camera) or camera`)
  const isUrl = /^https?:\/\//i.test(input)
  let loaded
  if (isUrl) {
    const u = new URL(input)
    loaded = fromData({ title: u.hostname, baseUrl: u.origin, steps: [{ goto: u.pathname + u.search }] }, { name: u.hostname })
  } else {
    loaded = await loadFile(input, { allowJs: false })
    if (loaded.kind !== 'browser') throw new UserError('explore works on browser scripts (slides have no site to explore)')
  }
  const header = Object.fromEntries(Object.entries(loaded.script).filter(([k]) => !['steps', 'blocks', 'vars', 'type'].includes(k)))
  const firstGoto = loaded.script.steps.find(s => 'goto' in s)?.goto ?? '/'
  const { resolveUrl } = urlResolver(loaded.script, loaded.dir, false)
  const host = new URL(resolveUrl(firstGoto)).hostname
  // Next to the video it is for: videos/<name>/explore/ (the draft's name, else the script's or the site's)
  const videoName = draft ? basename(draft).replace(/\.(ya?ml|json)$/i, '') : loaded.name
  const outDir = resolve('videos', videoName, 'explore')
  mkdirSync(outDir, { recursive: true })

  const locale = header.language === 'en' ? 'en-US' : header.language ?? 'es-CO'
  const browser = await launch({ headless: true, display: null, width: 1280, height: 720, locale }, config)
  try {
    const common = { viewport: { width: 1280, height: 720 }, locale }
    const network = { uploads: new Map() }
    let start = firstGoto
    let complete = true
    let onCamera

    // A bare URL on a login page: the setup that logs in is written from the form itself
    if (isUrl) {
      const probe = await browser.newPage(common)
      await probe.goto(resolveUrl(firstGoto), { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
      header.title = (await probe.title()).split(/[·|–-]/)[0].trim() || host
      header.language = (await probe.evaluate(() => document.documentElement.lang)).slice(0, 2) || undefined
      const login = await findLogin(probe)
      const loginPath = new URL(probe.url()).pathname
      await probe.close()
      if (login) {
        const prefix = secretPrefix(host)
        const names = [`${prefix}_USER`, `${prefix}_PASSWORD`]
        Object.assign(header, {
          session: host,
          sessionCheck: { goto: '/', notUrl: loginPath },
          setup: [
            { goto: loginPath },
            ...(login.user ? [{ fill: { target: login.user, text: `\${secret:${names[0]}}` } }] : []),
            { fill: { target: login.password, text: `\${secret:${names[1]}}` } },
            { click: login.submit },
          ],
        })
        start = '/'
        if (loginOn === 'camera') onCamera = { path: loginPath, ...login, names }
        complete = await askCredentials(config, names)
        if (!complete) log.warn(`a login is needed. Save the credentials, then explore again:\n    tourwright secret set ${names[0]}\n    tourwright secret set ${names[1]}`)
      }
    }
    if (loginOn === 'camera' && !onCamera) log.warn('--login camera: no login form found on that URL, the draft logs in as the script does')

    const script = interpolate({ ...loaded.script, ...header, steps: loaded.script.steps }, { config })
    const sessionFile = script.session ? sessionPath(config, script.session) : null
    let state
    if (complete && needsPrep(script, loaded, sessionFile)) {
      log.info('logging in off camera…')
      state = await prepare({ browser, common, script: { ...script, warmup: [] }, loaded, network, resolveUrl, sessionFile: fresh ? null : sessionFile })
    }
    const context = await browser.newContext({ ...common, ...(state ? { storageState: state } : {}) })
    const blurCss = (script.blur ?? []).filter(t => typeof t === 'string').map(sel => `${sel} { filter: blur(8px) !important; }`).join('\n')
    if (blurCss) {
      await context.addInitScript(css => {
        const add = () => document.head.append(Object.assign(document.createElement('style'), { textContent: css }))
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add)
        else add()
      }, blurCss)
    }
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    const blocker = await dismissing(page, script.dismiss)
    const found = new Map((script.dismiss ?? []).map(t => [JSON.stringify(t), t]))

    const visit = async (path, n) => {
      await page.goto(resolveUrl(path), { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
      await page.waitForTimeout(1200)
      // Close what the app opened on its own, and remember it for the draft's `dismiss`
      // Tours open a moment after the page: give them that moment
      const tour = page.getByRole('button', { name: DISMISS }).first()
      if (await tour.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) {
        // Its accessible name ("Saltar la guía"), which may differ from its text ("Saltar")
        const name = outline(await tour.ariaSnapshot())[0]?.name ?? (await tour.textContent() ?? '').trim()
        found.set(JSON.stringify({ role: 'button', name }), { role: 'button', name })
        await tour.click().catch(() => {})
        await page.waitForTimeout(500)
      }
      const open = await blocker.pending()
      if (open) await open.click().catch(() => {})
      const root = (await page.locator('main').count()) ? page.locator('main').first() : page.locator('body')
      const items = outline(await root.ariaSnapshot())
      const shot = join(outDir, `${String(n).padStart(2, '0')}-${path.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'inicio'}.png`)
      await page.screenshot({ path: shot })
      return { items, shot, url: page.url() }
    }

    const home = await visit(start, 0)
    const bodyItems = outline(await page.locator('body').ariaSnapshot())
    const homePath = new URL(home.url).pathname
    const list = (only?.length ? only.map(p => ({ name: p, path: p })) : sections(bodyItems, home.url))
      .filter(s => samePage(s.path) !== samePage(homePath)).slice(0, max)
    const pages = []
    for (const [i, s] of list.entries()) {
      log.info(`${s.name}…`)
      const r = await visit(s.path, i + 1)
      pages.push({ ...s, page: describe(r.items), shot: r.shot })
    }
    const homeInfo = describe(home.items)
    if (found.size) header.dismiss = [...found.values()]
    header.blur ??= ['main tbody']

    const report = { site: host, start, home: { ...homeInfo, shot: home.shot }, pages, screenshots: outDir, loggedIn: Boolean(state), needsLogin: !complete }
    if (draft) {
      const text = draftScript({ header: { title: header.title, language: header.language, voice: header.voice, ...header }, start, home: homeInfo, pages, site: header.title ?? host, menu: bodyItems.find(i => i.role === 'navigation' && i.name)?.name, login: onCamera })
      fromData(YAML.parse(text), { name: 'draft' })
      writeFileSync(draft, text)
      report.draft = resolve(draft)
    }
    await context.close()
    return report
  } finally {
    await browser.close().catch(() => {})
  }
}

// The report for a person: one block per page, targets ready to paste
export const printReport = (r, write = s => process.stdout.write(s)) => {
  const block = (title, path, info, shot) => {
    write(`\n── ${title}  ${path}\n`)
    if (info.description) write(`   ${info.description}\n`)
    for (const t of info.targets.slice(0, 14)) write(`   ${flow(t)}\n`)
    write(`   screenshot: ${shot}\n`)
  }
  block(r.home.heading ?? r.site, r.start, r.home, r.home.shot)
  for (const p of r.pages) block(p.name, p.path, p.page, p.shot)
  write(`\n${r.pages.length} sections · screenshots in ${r.screenshots}\n`)
  if (r.draft) write(`draft: ${r.draft}\n  try it:  tourwright render "${r.draft}" --dry-run\n  then:    tourwright render "${r.draft}" --open\n`)
}
