// The quick helpers for off-camera steps (`setup`, the steps before a --step preview): the same actions as the
// filmed ones, with no animation, captions or narration.
import { basename } from 'node:path'
import { sleep } from '#core/util.js'
import { isNativeSelect, listOption, listSearch, markFields, missingOption } from './lists.js'
import { maskedText } from './targets.js'

/** The quick version, for `setup` */
const chooseQuick = async (page, list, value, search) => {
  list = list.first()
  if (await isNativeSelect(list)) return void (await list.selectOption(value))
  for (const text of [value].flat()) {
    await markFields(page)
    await list.click()
    if (search) await (await listSearch(page, list)).fill(search)
    await listOption(page, text, await maskedText(page, text)).click().catch(error => missingOption(page, text, error))
  }
}

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
    chapter: noop,
    say: noop,
    click: (l, options) => l.first().click(options),
    check: (l, on) => l.first().setChecked(on),
    select: (l, value, search) => chooseQuick(page, l, value, search),
    drag: (from, to) => from.first().dragTo(to.first()),
    hover: l => l.first().hover(),
    type: (l, text) => l.first().fill(text),
    highlight: noop,
    spotlight: noop,
    callout: noop,
    // Nothing to show off camera, but a focus that clicks still clicks: the next step expects the page it opens
    focus: (l, options = {}) => (options.click ? l.first().click() : undefined),
    cursor: noop,
    sound: noop,
    zoom: noop,
    releaseCamera: noop,
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
