// Needs a browser (skipped without one): targets, `mask` and the safe dry run against small pages.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { loadConfig } from '#core/config.js'
import { registerPlugin } from '#plugins/index.js'
import { launchChromium, findChromium } from '#render/browser/chromium.js'
import { maskInPage } from '#render/page/mask.js'
import { runSteps, setStepTimeout } from '#render/steps/index.js'
import { resolveTarget, whyUnusable } from '#render/steps/targets.js'

const config = loadConfig()
const missing = (await findChromium(config)).source === 'missing' && 'no browser'

/** @type {import('playwright').Browser} */
let browser
before(async () => {
  if (!missing) browser = await launchChromium(config, { headless: true })
})
after(async () => {
  await browser?.close()
})

const open = async (html, mask = null) => {
  const context = await browser.newContext()
  if (mask) await context.addInitScript(maskInPage, mask)
  const page = await context.newPage()
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return page
}

test('a hidden copy of a link loses to the visible one', { skip: missing }, async () => {
  const page = await open('<nav style="display:none"><a href="#m">Pre-aprobado</a></nav><a id="real" href="#d">Pre-aprobado</a>')
  const l = await resolveTarget(page, { role: 'link', name: 'Pre-aprobado' }, 2000)
  assert.equal(await l.first().getAttribute('id'), 'real')
  await page.context().close()
})

test('the exact words win over a longer text that contains them; what stays ambiguous is reported', { skip: missing }, async () => {
  const page = await open('<p>Elige el plazo y periodicidad.</p><label id="exact">Periodicidad</label><b>Uno</b><b>Uno</b>')
  const notes = []
  const l = await resolveTarget(page, { text: 'Periodicidad' }, 2000, { note: n => notes.push(n) })
  assert.equal(await l.first().getAttribute('id'), 'exact')
  assert.equal(notes.length, 0)
  await resolveTarget(page, { text: 'Uno' }, 2000, { note: n => notes.push(n) })
  assert.equal(notes.length, 1)
  assert.equal(notes[0].kind, 'ambiguous')
  assert.match(notes[0].message, /matches 2 elements/)
  await page.context().close()
})

test('a hidden exact match never wins over a visible longer text', { skip: missing }, async () => {
  const page = await open('<div style="display:none"><button>Guardar</button></div><button id="seen">Guardar cambios</button>')
  const l = await resolveTarget(page, { text: 'Guardar' }, 2000)
  assert.equal(await l.first().getAttribute('id'), 'seen')
  await page.context().close()
})

test('mask changes what is seen, steps still find the real text, dates are masked and date fields blurred', { skip: missing }, async () => {
  const page = await open('<ul><li><button id="range">1.200.000 - 1.600.000</button></li></ul><p id="born">Nació el 05/11/1987</p>' +
    '<input type="date" id="d" value="1990-01-02"><input type="date" id="e">', ['id', 'date'])
  await page.waitForTimeout(300)
  assert.notEqual(await page.locator('#range').textContent(), '1.200.000 - 1.600.000')
  assert.doesNotMatch(await page.locator('#born').textContent(), /05\/11\/1987/)
  assert.match(await page.locator('#born').textContent(), /^Nació el \d\d\/\d\d\/\d{4}$/)
  const l = await resolveTarget(page, { text: '1.200.000 - 1.600.000' }, 2000)
  assert.equal(await l.first().getAttribute('id'), 'range')
  // The field keeps its real value (a form sends it) and is blurred; an empty one is not
  assert.equal(await page.locator('#d').inputValue(), '1990-01-02')
  assert.match(await page.locator('#d').getAttribute('class') ?? '', /tw-blur/)
  assert.equal(await page.locator('#e').getAttribute('class'), null)
  await page.context().close()
})

test('a plugin step gets the defaults of its schema; a safe dry run leaves it and every press out', { skip: missing }, async () => {
  const got = []
  registerPlugin({ name: 'defaults', steps: { otp: { schema: z => z.object({ boxes: z.string().default('input'), ms: z.number().default(900) }), run: async arg => void got.push(arg) } } })
  const page = await open('<button id="b" onclick="this.textContent=\'pressed\'">Send</button><input id="i">')
  setStepTimeout(page, 2000)
  const skipped = []
  const v = { dryRun: true, safe: false, pause: async () => {}, click: async l => l.first().click(), skip: async a => void skipped.push(a) }
  await runSteps([{ otp: { ms: 5 } }], v, page)
  assert.deepEqual(got, [{ boxes: 'input', ms: 5 }])
  await runSteps([{ otp: {} }, { fill: { target: '#i', text: 'x' } }, { press: 'Enter' }], { ...v, safe: true }, page)
  assert.equal(got.length, 1)
  assert.deepEqual(skipped, ['otp', 'fill', 'press'])
  assert.equal(await page.locator('#i').inputValue(), '')
  await page.context().close()
})

test('why an element cannot be used comes from the call log of Playwright', () => {
  const error = new Error('locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole(\'link\')\n  - <div class="loader">…</div> intercepts pointer events\n  - retrying click action')
  assert.equal(whyUnusable(error), '<div class="loader">…</div> intercepts pointer events')
  assert.equal(whyUnusable(new Error('Timeout')), null)
})

test('a { role: button } names a toggle that is a radio (Radix, shadcn): it is found, with the target to write', { skip: missing }, async () => {
  const page = await open('<div role="radiogroup"><button role="radio" aria-checked="false" id="m">Mensual</button><button role="radio" aria-checked="true">Anual</button></div>')
  const l = await resolveTarget(page, { role: 'button', name: 'Mensual' }, 2000)
  assert.equal(await l.first().getAttribute('id'), 'm')
  await page.context().close()
})

test('a page still loading: the real button that comes a moment after a toggle of that name wins', { skip: missing }, async () => {
  const page = await open(`<div role="radiogroup"><button role="radio" id="r">Guardar</button></div>
    <script>setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<button id="b">Guardar</button>'), 300)</script>`)
  const l = await resolveTarget(page, { role: 'button', name: 'Guardar' }, 2000)
  assert.equal(await l.first().getAttribute('id'), 'b')
  await page.context().close()
})

test('a call to action that is an <a role="button">: a { role: link } target finds it, and the page lists it as a button', { skip: missing }, async () => {
  const page = await open('<a href="#" role="button" id="cta">Empezar la prueba</a>')
  const l = await resolveTarget(page, { role: 'link', name: 'Empezar la prueba' }, 2000)
  assert.equal(await l.first().getAttribute('id'), 'cta')
  const { pageInventory } = await import('#render/steps/targets.js')
  assert.ok((await pageInventory(page)).some(t => /role: button, name: Empezar la prueba/.test(t)))
  await page.context().close()
})

test('the site\'s own colors become the theme; a page in another language than the voice is said', { skip: missing }, async () => {
  const { readBrand } = await import('#render/page/brand.js')
  const { brandTheme, resolveTheme } = await import('#render/page/theme.js')
  const { checkLanguage } = await import('#render/page/review.js')
  const page = await open(`<style>:root { --primary: 145 25% 70% } body { background: #0f1112; color: #f1f2f0 }</style>
    <link rel="alternate" hreflang="es" href="/es/precios"><h1>Pricing</h1>`)
  await page.evaluate(() => { document.documentElement.lang = 'en' })
  const brand = await readBrand(page)
  assert.equal(brand.background, '#0f1112')
  assert.equal(brand.text, '#f1f2f0')
  assert.ok(brand.accent && brand.accent !== '#0f1112')
  const theme = brandTheme(resolveTheme(), brand)
  assert.equal(theme.background, '#0f1112')
  // The gradient and the glow come from the brand, not the default navy and indigo
  assert.doesNotMatch(`${theme.gradient} ${theme.glow}`, /1E3A5F|6366F1/i)
  assert.match(String(await checkLanguage(page, 'es')), /"en" and the narration in "es".*\/es\/precios/)
  assert.equal(await checkLanguage(page, 'en'), null)
  await page.context().close()
})
