// The declarative part of a walkthrough: how a step of a script becomes calls to the helpers `v`.
// `browser.js` gives the animated helpers that are filmed; `plainHelpers` the quick ones for `setup`.
// Plugins' steps run here too.
import { basename } from 'node:path'
import { PLUGIN_STEPS } from '../script/schema.js'
import { withCodes } from '../secrets.js'
import { holdsSecret, log, sleep, UserError } from '../util.js'
import { asTarget, describeTarget, isMissingElement, offeredElements, resolveTarget, targetsOf } from './targets.js'

// A target of a script (a selector, or { role, name }, { label }…) → a Playwright locator
export const locate = (page, t) => {
  if (typeof t === 'string') return page.locator(t)
  const exact = t.exact
  let l
  if (t.role) l = page.getByRole(t.role, { ...(t.name ? { name: t.name } : {}), exact })
  else if (t.label) l = page.getByLabel(t.label, { exact })
  else if (t.placeholder) l = page.getByPlaceholder(t.placeholder, { exact })
  else if (t.testId) l = page.getByTestId(t.testId)
  else if (t.text) l = page.getByText(t.text, { exact })
  else l = page.locator(t.css)
  if (t.css && (t.role || t.label || t.placeholder || t.testId || t.text)) l = l.and(page.locator(t.css))
  return t.nth !== undefined ? l.nth(t.nth) : l
}

// `dismiss`: things the app puts in the way (its own product tour, a cookie banner, a chat bubble) are
// closed whenever they show up. Playwright closes them before an action they block; `pending` tells
// whether one is on screen now (or shows up within `ms`), so the recording can close it off camera.
export const dismissing = async (page, targets = []) => {
  const locators = targets.map(t => locate(page, t).first())
  for (const l of locators) await page.addLocatorHandler(l, h => h.click().catch(() => {}), { noWaitAfter: true })
  return {
    /** @param {number} [ms] @returns {Promise<import('playwright').Locator | null>} */
    pending: async (ms = 0) => {
      if (!locators.length) return null
      if (ms) {
        const any = locators.reduce((a, l) => a.or(l)).first()
        await any.waitFor({ state: 'visible', timeout: ms }).catch(() => {})
      }
      for (const l of locators) if (await l.isVisible().catch(() => false)) return l
      return null
    },
  }
}

// How a line is spoken, from a step's value
const prosodyOf = a => ({ voice: a.voice, rate: a.rate, pitch: a.pitch, volume: a.volume, style: a.style })

// A secret typed on camera stays unreadable: a password field already shows dots, any other field is blurred
export const hideTyped = locator =>
  locator.first().evaluate(el => {
    if (!(el instanceof HTMLInputElement && el.type === 'password')) el.classList.add('tw-blur')
  })

// Runs declarative steps with the helpers `v`. A step whose element is missing fails with what the page has
// instead; a dry run (`v.dryRun`) goes on to the end and lists every step that failed.
// `offset`: how many steps of the script come before these (a preview of some steps keeps their numbers)
export const runSteps = async (steps, v, page, top = true, offset = 0) => {
  const failures = []
  for (const [index, step] of steps.entries()) {
    // Which step of the script is on screen: findings of the review name it
    if (top) v.step = index + offset + 1
    try {
      await runStep(step, v, page)
    } catch (error) {
      const failure = await explain(error, step, page, index + offset)
      if (!(top && v.dryRun && failure instanceof UserError)) throw failure
      failures.push(failure)
      log.warn(failure.message.split('\n')[0])
    }
  }
  if (failures.length) {
    const count = `${failures.length} step${failures.length > 1 ? 's' : ''}`
    const error = new UserError(`${count} failed (later ones may fail because of an earlier one):\n${failures.map(f => `  ${f.message}`).join('\n')}`, { code: 'steps_failed' })
    // For `tourwright check` and `fix`: each failure as data
    Object.assign(error, { failures: failures.map(f => f.failure ?? { message: f.message }) })
    throw error
  }
}

// A missing element, said with its target and with what the page offers instead. The error carries it as data
// too (`failure`): the step, the target, the page and the elements on it, for `tourwright check` and `fix`.
const explain = async (error, step, page, index) => {
  const [action, arg] = Object.entries(step)[0]
  const targets = targetsOf(action, arg)
  if (!targets.length || !isMissingElement(error) || error.explained) return error
  const absent = []
  for (const t of targets) if (!(await locate(page, t).count().catch(() => 0))) absent.push(t)
  // Found but never usable (hidden, covered, disabled) is a different problem from not there at all
  const what = absent.length ? `cannot find ${describeTarget(absent[0])}` : `${describeTarget(targets[0])} is there but cannot be used (hidden or covered?)`
  const elements = await offeredElements(page)
  const seen = new Set()
  const offered = elements.map(e => asTarget(e.target)).filter(s => !seen.has(s) && seen.add(s)).slice(0, 15)
  const message = `step ${index + 1} (${action}): ${what}` +
    (offered.length ? `\n    on this page (${page.url()}): ${offered.join(' · ')}` : `\n    page: ${page.url()}`)
  const explained = new UserError(message, { code: 'element_not_found' })
  const failure = { step: index + 1, action, target: absent[0] ?? targets[0], found: !absent.length, url: page.url(), message, elements }
  Object.assign(explained, { explained: true, cause: error, failure })
  return explained
}

const runStep = async (step, v, page) => {
    if (v.beforeStep) await v.beforeStep()
    const [action, arg] = Object.entries(step)[0]
    const find = t => resolveTarget(page, t, stepTimeout(page))
    const withTarget = a => (typeof a === 'object' && a && 'target' in a ? a : { target: a })
    switch (action) {
      case 'goto': await v.goto(arg); break
      case 'title':
        if (typeof arg === 'string') await v.title(arg)
        else await v.title(arg.text, arg.subtitle, arg.ms, arg.say, prosodyOf(arg), { kicker: arg.kicker, animation: arg.animation, background: arg.background })
        break
      case 'say':
        if (arg === null) await v.say(null)
        else if (typeof arg === 'string') await v.say(arg)
        else await v.say(arg.caption ?? arg.speak, { speak: arg.speak, ms: arg.ms, ...prosodyOf(arg) })
        break
      case 'caption': await v.say(arg, { silent: true }); break
      case 'click': await v.click(await find(withTarget(arg).target)); break
      case 'dblclick': await v.click(await find(withTarget(arg).target), { clickCount: 2 }); break
      case 'rightClick': await v.click(await find(withTarget(arg).target), { button: 'right' }); break
      case 'hover': await v.hover(await find(arg)); break
      case 'check': await v.check(await find(arg), true); break
      case 'uncheck': await v.check(await find(arg), false); break
      case 'drag': await v.drag(await find(arg.from), await find(arg.to)); break
      case 'type':
      case 'fill': {
        const field = await find(arg.target)
        if (action === 'type' && arg.clear) await field.first().fill('')
        if (holdsSecret(arg.text)) await hideTyped(field)
        if (action === 'type') await v.type(field, await withCodes(arg.text), arg.delay)
        else await field.first().fill(await withCodes(arg.text))
        break
      }
      case 'press': await page.keyboard.press(arg); await v.pause(300); break
      case 'select': await (await find(arg.target)).first().selectOption(arg.value); await v.pause(400); break
      case 'highlight': { const a = withTarget(arg); await v.highlight(await find(a.target), a.ms); break }
      case 'spotlight': { const a = withTarget(arg); await v.spotlight(await find(a.target), a.ms); break }
      case 'focus': await v.focus(await find(arg.target), arg); break
      case 'callout': await v.callout(await find(arg.target), arg.text, { ms: arg.ms, position: arg.position }); break
      case 'zoom': { const a = withTarget(arg); await v.zoom(await find(a.target), a.ms, a.scale); break }
      case 'scrollTo': await v.scrollTo(await find(arg)); break
      case 'scroll': await v.scroll(arg); break
      case 'cursor': await v.cursor(arg === 'show'); break
      case 'back': await v.back(); break
      case 'reload': await v.reload(); break
      case 'pause': await v.pause(arg); break
      case 'sound': await v.sound(typeof arg === 'string' ? { file: arg } : arg); break
      case 'wait': await v.offCamera(() => waitFor(page, arg)); break
      case 'blur': for (const t of [arg].flat()) await v.blur(locate(page, t)); break
      case 'upload': await v.upload(await find(arg.target), [arg.files].flat()); break
      case 'offCamera': await v.offCamera(() => runSteps(arg, v, page, false)); break
      case 'if': {
        const ok = arg.timeout ? await v.offCamera(() => holds(page, arg)) : await holds(page, arg)
        if (ok) await runSteps(arg.then, v, page, false)
        else if (arg.else) await runSteps(arg.else, v, page, false)
        break
      }
      case 'try': await attempt(page, v, arg); break
      default: {
        const plugin = PLUGIN_STEPS.get(action)
        if (!plugin) throw new UserError(`unknown action ${action}`)
        await plugin.run(arg, { page, v, locate: t => locate(page, t), dryRun: Boolean(v.dryRun) })
      }
    }
}

const waitFor = async (page, arg) => {
  if (typeof arg === 'number') return page.waitForTimeout(arg)
  const timeout = arg.timeout ?? 60_000
  if (arg.target) await locate(page, arg.target).first().waitFor({ state: arg.state ?? 'visible', timeout })
  if (arg.text) await page.getByText(arg.text).first().waitFor({ state: arg.state ?? 'visible', timeout })
  if (arg.url) await page.waitForURL(u => String(u).includes(arg.url), { timeout })
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
}

// Whether an `if` condition holds now (or within its timeout).
const holds = async (page, c) => {
  const timeout = c.timeout ?? 0
  const visible = l => (timeout ? l.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false) : l.first().isVisible())
  if (c.visible && !(await visible(locate(page, c.visible)))) return false
  if (c.text && !(await visible(page.getByText(c.text)))) return false
  if (c.url) {
    const ok = timeout
      ? await page.waitForURL(u => String(u).includes(c.url), { timeout }).then(() => true, () => false)
      : page.url().includes(c.url)
    if (!ok) return false
  }
  return true
}

// How long a step waits for its element: 30 s while recording, less in a dry run and inside `try`
const timeouts = new WeakMap()
export const stepTimeout = page => timeouts.get(page) ?? 30_000
/** @param {import('playwright').Page} page @param {number} ms */
export const setStepTimeout = (page, ms) => {
  timeouts.set(page, ms)
  page.setDefaultTimeout(ms)
}

// `try`: steps that may fail (a banner that is not always there). Each one waits briefly, not 30 s.
const attempt = async (page, v, arg) => {
  const { steps, timeout = 3000 } = Array.isArray(arg) ? { steps: arg } : arg
  const previous = stepTimeout(page)
  setStepTimeout(page, Math.min(timeout, previous))
  try {
    await runSteps(steps, v, page, false)
  } catch (error) {
    log.info(`try: skipped the rest (${String(error.message).split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '')})`)
  } finally {
    setStepTimeout(page, previous)
  }
}

// Helpers for off-camera setup: same actions, no animation, captions or narration.
export const plainHelpers = (page, resolveUrl, uploads, toPath) => {
  const noop = async () => {}
  return {
    goto: async path => {
      await page.goto(resolveUrl(path), { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
      // Forms often ignore input until hydrated
      await sleep(500)
    },
    back: () => page.goBack({ waitUntil: 'domcontentloaded' }),
    reload: () => page.reload({ waitUntil: 'domcontentloaded' }),
    title: noop,
    say: noop,
    click: (l, options) => l.first().click(options),
    check: (l, on) => l.first().setChecked(on),
    drag: (from, to) => from.first().dragTo(to.first()),
    hover: l => l.first().hover(),
    type: (l, text) => l.first().fill(text),
    highlight: noop,
    spotlight: noop,
    callout: noop,
    focus: noop,
    cursor: noop,
    sound: noop,
    zoom: noop,
    scrollTo: l => l.first().scrollIntoViewIfNeeded(),
    scroll: dy => page.mouse.wheel(0, dy),
    pause: ms => page.waitForTimeout(Math.min(ms, 2000)),
    offCamera: fn => fn(),
    blur: noop,
    upload: async (l, files) => {
      const paths = files.map(toPath)
      for (const p of paths) uploads.set(basename(p), p)
      await l.setInputFiles(paths)
    },
  }
}

