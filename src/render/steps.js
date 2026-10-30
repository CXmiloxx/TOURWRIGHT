// The declarative part of a walkthrough: how a step of a script becomes calls to the helpers `v`.
// `browser.js` gives the animated helpers that are filmed; `plainHelpers` the quick ones for `setup`.
// Plugins' steps run here too.
import { basename } from 'node:path'
import { PLUGIN_STEPS } from '../script/schema.js'
import { log, sleep, UserError } from '../util.js'

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

// How a line is spoken, from a step's value
const prosodyOf = a => ({ voice: a.voice, rate: a.rate, pitch: a.pitch, volume: a.volume, style: a.style })

// Runs declarative steps with the helpers `v`.
export const runSteps = async (steps, v, page) => {
  for (const step of steps) {
    const [action, arg] = Object.entries(step)[0]
    const withTarget = a => (typeof a === 'object' && a && 'target' in a ? a : { target: a })
    switch (action) {
      case 'goto': await v.goto(arg); break
      case 'title':
        if (typeof arg === 'string') await v.title(arg)
        else await v.title(arg.text, arg.subtitle, arg.ms, arg.say, prosodyOf(arg))
        break
      case 'say':
        if (arg === null) await v.say(null)
        else if (typeof arg === 'string') await v.say(arg)
        else await v.say(arg.caption ?? arg.speak, { speak: arg.speak, ms: arg.ms, ...prosodyOf(arg) })
        break
      case 'caption': await v.say(arg, { silent: true }); break
      case 'click': await v.click(locate(page, withTarget(arg).target)); break
      case 'dblclick': await v.click(locate(page, withTarget(arg).target), { clickCount: 2 }); break
      case 'rightClick': await v.click(locate(page, withTarget(arg).target), { button: 'right' }); break
      case 'hover': await v.hover(locate(page, arg)); break
      case 'check': await v.check(locate(page, arg), true); break
      case 'uncheck': await v.check(locate(page, arg), false); break
      case 'drag': await v.drag(locate(page, arg.from), locate(page, arg.to)); break
      case 'type':
        if (arg.clear) await locate(page, arg.target).first().fill('')
        await v.type(locate(page, arg.target), arg.text, arg.delay)
        break
      case 'fill': await locate(page, arg.target).first().fill(arg.text); break
      case 'press': await page.keyboard.press(arg); await v.pause(300); break
      case 'select': await locate(page, arg.target).first().selectOption(arg.value); await v.pause(400); break
      case 'highlight': { const a = withTarget(arg); await v.highlight(locate(page, a.target), a.ms); break }
      case 'spotlight': { const a = withTarget(arg); await v.spotlight(locate(page, a.target), a.ms); break }
      case 'focus': await v.focus(locate(page, arg.target), arg); break
      case 'callout': await v.callout(locate(page, arg.target), arg.text, { ms: arg.ms, position: arg.position }); break
      case 'zoom': { const a = withTarget(arg); await v.zoom(locate(page, a.target), a.ms, a.scale); break }
      case 'scrollTo': await v.scrollTo(locate(page, arg)); break
      case 'scroll': await v.scroll(arg); break
      case 'cursor': await v.cursor(arg === 'show'); break
      case 'back': await v.back(); break
      case 'reload': await v.reload(); break
      case 'pause': await v.pause(arg); break
      case 'sound': await v.sound(typeof arg === 'string' ? { file: arg } : arg); break
      case 'wait': await v.offCamera(() => waitFor(page, arg)); break
      case 'blur': for (const t of [arg].flat()) await v.blur(locate(page, t)); break
      case 'upload': await v.upload(locate(page, arg.target), [arg.files].flat()); break
      case 'offCamera': await v.offCamera(() => runSteps(arg, v, page)); break
      case 'if': {
        const ok = arg.timeout ? await v.offCamera(() => holds(page, arg)) : await holds(page, arg)
        if (ok) await runSteps(arg.then, v, page)
        else if (arg.else) await runSteps(arg.else, v, page)
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

// `try`: steps that may fail (a banner that is not always there). Each one waits briefly, not 30 s.
const timeouts = new WeakMap()
const attempt = async (page, v, arg) => {
  const { steps, timeout = 3000 } = Array.isArray(arg) ? { steps: arg } : arg
  const previous = timeouts.get(page) ?? 30_000
  timeouts.set(page, timeout)
  page.setDefaultTimeout(timeout)
  try {
    await runSteps(steps, v, page)
  } catch (error) {
    log.info(`try: skipped the rest (${String(error.message).split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '')})`)
  } finally {
    timeouts.set(page, previous)
    page.setDefaultTimeout(previous)
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

