// The declarative part of a walkthrough: how a step of a script becomes calls to the helpers `v`.
// walkthrough/helpers/ gives the animated helpers that are filmed; quick.js the quick ones for `setup`.
// Plugins' steps run here too.
import { PLUGIN_STEPS, STEPS } from '#script/schema.js'
import { withCodes } from '#core/secrets.js'
import { holdsSecret, log, plainText, UserError } from '#core/util.js'
import { markedLine } from '#voice/index.js'
import { asTarget, describeTarget, isMissingElement, maskedText, offeredElements, resolveTarget, targetsOf, whyUnusable } from './targets.js'

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

// What steps will say, the way the helpers of browser.js say it: [text, prosody] for each line, to make them
// ahead while the browser starts. Steps inside offCamera, if and try count too (they may run).
/** @param {any[]} steps @returns {[string, Record<string, any>][]} */
export const spokenLines = steps => steps.flatMap(step => {
  if (!step || typeof step !== 'object') return []
  const [action, arg] = Object.entries(step)[0] ?? []
  if (arg === null || arg === undefined) return []
  switch (action) {
    case 'say':
      if (typeof arg === 'string') return arg ? [[plainText(arg), {}]] : []
      return arg.speak || arg.caption ? [[arg.speak ?? plainText(arg.caption), prosodyOf(arg)]] : []
    case 'title': return typeof arg === 'object' && arg.say ? [[arg.say, prosodyOf(arg)]] : []
    case 'focus': {
      const { spoken, before } = markedLine(arg.say)
      if (!spoken) return []
      // The words before the {marked} one are made on their own too: their length times the focus
      return /[\p{L}\p{N}]/u.test(before ?? '') ? [[plainText(spoken), prosodyOf(arg)], [plainText(before), prosodyOf(arg)]] : [[plainText(spoken), prosodyOf(arg)]]
    }
    case 'offCamera': return Array.isArray(arg) ? spokenLines(arg) : []
    case 'if': return [...spokenLines(arg.then ?? []), ...spokenLines(arg.else ?? [])]
    case 'try': return spokenLines(Array.isArray(arg) ? arg : (arg.steps ?? []))
    default: return []
  }
})

// A secret typed on camera stays unreadable: a password field already shows dots, any other field is blurred
export const hideTyped = locator =>
  locator.first().evaluate(el => {
    if (!(el instanceof HTMLInputElement && el.type === 'password')) el.classList.add('tw-blur')
  })

// Runs declarative steps with the helpers `v`. A step whose element is missing fails with what the page has
// instead; a dry run (`v.dryRun`) goes on to the end and lists every step that failed.
// `offset`: how many steps of the script come before these (a preview of some steps keeps their numbers)
// `parent`: the number of the step these are inside (`if`, `try`, `offCamera`): the 2nd step inside step 4 is "4.2"
export const runSteps = async (steps, v, page, top = true, offset = 0, parent = null) => {
  const failures = []
  for (const [index, step] of steps.entries()) {
    const number = parent ? `${parent}.${index + 1}` : index + offset + 1
    // Which step of the script is on screen: findings of the review name it
    if (top) {
      v.step = number
      v.progress?.(v.step)
    }
    // `tourwright guide`: a screenshot before the step, with its element marked
    if (top && v.onStep) await v.onStep(step)
    try {
      await runStep(step, v, page, number)
    } catch (error) {
      const failure = await explain(error, step, page, number)
      // A safe dry run did not press what came before: an element that would show up after it cannot be checked
      if (v.safe && v.skipped?.length && failure.code === 'element_not_found') {
        log.warn(`step ${number}: not checked, it comes after an action the safe dry run did not perform (${failure.message.split('\n')[0].replace(/^step [\d.]+ \(\w+\): /, '')})`)
        v.unchecked = (v.unchecked ?? 0) + 1
        continue
      }
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
const explain = async (error, step, page, number) => {
  const [action, arg] = Object.entries(step)[0]
  const targets = targetsOf(action, arg)
  if (!targets.length || !isMissingElement(error) || error.explained) return error
  const absent = []
  for (const t of targets) if (!(await locate(page, t).count().catch(() => 0))) absent.push(t)
  // Found but never usable (hidden, covered, disabled) is a different problem from not there at all
  // Playwright says why in its call log: another element on top, disabled, still moving…
  const why = absent.length ? null : whyUnusable(error)
  const what = absent.length ? `cannot find ${describeTarget(absent[0])}` : `${describeTarget(targets[0])} is there but cannot be used (${why ?? 'hidden or covered?'})`
  const elements = await offeredElements(page)
  const seen = new Set()
  const offered = elements.map(e => asTarget(e.target)).filter(s => !seen.has(s) && seen.add(s)).slice(0, 15)
  const message = `step ${number} (${action}): ${what}` +
    (offered.length ? `\n    on this page (${page.url()}): ${offered.join(' · ')}` : `\n    page: ${page.url()}`)
  const explained = new UserError(message, { code: 'element_not_found' })
  const failure = { step: number, action, target: absent[0] ?? targets[0], found: !absent.length, url: page.url(), message, elements }
  Object.assign(explained, { explained: true, cause: error, failure })
  return explained
}

// Steps that need the whole page: the camera held close after a zoomed focus goes back first. Typing, clicking,
// choosing, uploading and narrating stay close; a focus decides for itself (it may glide to the next element).
const WIDE = new Set(['goto', 'title', 'back', 'reload', 'scroll', 'scrollTo', 'highlight', 'spotlight', 'callout', 'zoom', 'drag'])

const runStep = async (step, v, page, number) => {
    if (v.beforeStep) await v.beforeStep()
    const [action, arg] = Object.entries(step)[0]
    if (WIDE.has(action)) await v.releaseCamera?.()
    const find = (t, visible = true) => resolveTarget(page, t, stepTimeout(page), { visible, note: v.note })
    // A safe dry run finds every element but does not press, type or choose: nothing real happens in the app
    const safe = Boolean(v.safe)
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
      case 'chapter': await v.chapter(arg); break
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
        if (safe) {
          await v.skip(action, field)
          break
        }
        if (action === 'type' && arg.clear) await field.first().fill('')
        if (holdsSecret(arg.text)) await hideTyped(field)
        if (action === 'type') await v.type(field, await withCodes(arg.text), arg.delay)
        else await field.first().fill(await withCodes(arg.text))
        break
      }
      case 'press':
        if (safe) await v.skip(action)
        else {
          await page.keyboard.press(arg)
          await v.pause(300)
        }
        break
      case 'select': await v.select(await find(arg.target), arg.value, arg.search); break
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
      case 'wait':
        // What a safe dry run waits for usually comes after something it did not press: a short look, never a failure
        if (safe && typeof arg === 'object') await waitFor(page, { ...arg, timeout: Math.min(arg.timeout ?? 60_000, stepTimeout(page)) }).catch(() => {})
        else await v.offCamera(() => waitFor(page, arg))
        break
      case 'blur': for (const t of [arg].flat()) await v.blur(locate(page, t)); break
      case 'upload': await v.upload(await find(arg.target, false), [arg.files].flat()); break
      case 'offCamera': await v.offCamera(() => runSteps(arg, v, page, false, 0, number)); break
      case 'if': {
        const ok = arg.timeout ? await v.offCamera(() => holds(page, arg)) : await holds(page, arg)
        if (ok) await runSteps(arg.then, v, page, false, 0, number)
        else if (arg.else) await runSteps(arg.else, v, page, false, 0, number)
        break
      }
      case 'try': await attempt(page, v, arg, number); break
      default: {
        const plugin = PLUGIN_STEPS.get(action)
        if (!plugin) throw new UserError(`unknown action ${action}`)
        // A plugin may do real things (send a code, wait for one): a safe dry run leaves it out
        if (safe) {
          await v.skip(action)
          break
        }
        // The plugin gets its argument the way its schema reads it: defaults filled in, values converted
        const parsed = STEPS[action]?.safeParse?.(arg)
        await plugin.run(parsed?.success ? parsed.data : arg, { page, v, locate: t => locate(page, t), dryRun: Boolean(v.dryRun) })
      }
    }
}

// A text on the page, real or as `mask` draws it
const shownText = async (page, text) => {
  const shown = await maskedText(page, text)
  return shown === text ? page.getByText(text) : page.getByText(text).or(page.getByText(shown))
}

const waitFor = async (page, arg) => {
  if (typeof arg === 'number') return page.waitForTimeout(arg)
  const timeout = arg.timeout ?? 60_000
  if (arg.target) await locate(page, arg.target).first().waitFor({ state: arg.state ?? 'visible', timeout })
  if (arg.text) await (await shownText(page, arg.text)).first().waitFor({ state: arg.state ?? 'visible', timeout })
  if (arg.url) await page.waitForURL(u => String(u).includes(arg.url), { timeout })
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
}

// Whether an `if` condition holds now (or within its timeout).
const holds = async (page, c) => {
  const timeout = c.timeout ?? 0
  const visible = l => (timeout ? l.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false) : l.first().isVisible())
  if (c.visible && !(await visible(locate(page, c.visible)))) return false
  if (c.text && !(await visible(await shownText(page, c.text)))) return false
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
const attempt = async (page, v, arg, number) => {
  const { steps, timeout = 3000 } = Array.isArray(arg) ? { steps: arg } : arg
  const previous = stepTimeout(page)
  setStepTimeout(page, Math.min(timeout, previous))
  try {
    await runSteps(steps, v, page, false, 0, number)
  } catch (error) {
    log.info(`try: skipped the rest (${String(error.message).split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '')})`)
  } finally {
    setStepTimeout(page, previous)
  }
}
