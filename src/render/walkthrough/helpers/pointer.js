// What the cursor does on camera: clicks, checks, drags, typing, lists and files. In a safe dry run each one
// finds its element and stops there (`v.skip`).
import { basename } from 'node:path'
import { holdsSecret, UserError } from '#core/util.js'
import { typingSound } from '#voice/effects.js'
import { clickWithEffect } from '#render/page/review.js'
import { isNativeSelect, listOption, listSearch, markFields, missingOption } from '#render/steps/lists.js'
import { hideTyped } from '#render/steps/index.js'
import { maskedText } from '#render/steps/targets.js'
import { safePath } from '#render/page/theme.js'
import { filePicker, tap } from '#render/page/visuals.js'

/** @param {import('#render/walkthrough/stage.js').Stage} s @param {Record<string, any>} v */
export const pointerHelpers = (s, v) => {
  const { page, clock, center, moveTo, dryRun, safe, watcher } = s
  const { wait } = clock
  return {
    click: async (locator, options = {}) => {
      locator = locator.first()
      if (safe) return v.skip('click', locator)
      const { x, y } = await center(locator, true)
      await moveTo(x, y)
      await wait(250)
      s.clickNoise()
      const changed = await clickWithEffect(page, locator, async () => {
        await locator.click(options)
        await wait(400)
      })
      if (changed === false) watcher.add({ kind: 'no-effect', message: `the click on ${locator} changed nothing on the page (wrong element, or it needs a wait?)` })
    },
    check: async (locator, on = true) => {
      locator = locator.first()
      if (safe) return v.skip(on ? 'check' : 'uncheck', locator)
      const { x, y } = await center(locator, true)
      await moveTo(x, y)
      await wait(250)
      s.clickNoise()
      await locator.setChecked(on)
      await wait(400)
    },
    drag: async (from, to) => {
      if (safe) return v.skip('drag', from.first())
      const a = await center(from.first())
      const box = await to.first().boundingBox()
      if (!box) throw new UserError('drop target is not visible')
      await moveTo(a.x, a.y)
      await wait(200)
      await page.mouse.down()
      await moveTo(box.x + box.width / 2, box.y + box.height / 2)
      await wait(200)
      await page.mouse.up()
      await wait(500)
    },
    hover: async locator => {
      const { x, y } = await center(locator.first())
      await moveTo(x, y)
      await wait(400)
    },
    type: async (locator, text, delay = 70) => {
      locator = locator.first()
      if (safe) return v.skip('type', locator)
      if (holdsSecret(text)) await hideTyped(locator)
      // Into the field and typing at once: a click that only focuses needs no pause after it
      const { x, y } = await center(locator, true)
      await moveTo(x, y)
      await wait(150)
      s.clickNoise()
      await locator.click()
      await wait(120)
      if (s.plan.audio.typing && !dryRun && text) s.effect(await clock.offClock(() => typingSound(text.length, delay, s.config)), 0.8, 'typing')
      await locator.pressSequentially(text, { delay: dryRun ? 0 : delay })
      await wait(300)
    },
    // The cursor goes to the list and clicks before the choice changes
    select: async (locator, value, search) => {
      locator = locator.first()
      if (safe) return v.skip('select', locator)
      const { x, y } = await center(locator, true)
      await moveTo(x, y)
      await wait(200)
      s.clickNoise()
      if (await isNativeSelect(locator)) {
        if (!dryRun) await tap(page, x, y)
        await wait(250)
        await locator.selectOption(value)
        return void (await wait(450))
      }
      // A list of its own: opened, narrowed by a quick search, the option picked. The wait for the results
      // is cut from the video (center), so a slow search never shows as dead air
      for (const [i, text] of [value].flat().entries()) {
        if (i) {
          const again = await center(locator)
          await moveTo(again.x, again.y)
          await wait(150)
        }
        await markFields(page)
        await locator.click()
        await wait(250)
        if (search) {
          const field = await listSearch(page, locator)
          await field.pressSequentially(search, { delay: dryRun ? 0 : 45 })
          await wait(200)
        }
        const option = listOption(page, text, await maskedText(page, text))
        const at = await center(option).catch(error => missingOption(page, text, error))
        await moveTo(at.x, at.y)
        await wait(150)
        s.clickNoise()
        await option.click()
        await wait(400)
      }
    },
    // The real chooser of the system never shows in a recording: the cursor clicks where the file goes, a drawn
    // chooser picks the files, and they are put in the field
    upload: async (locator, files) => {
      const paths = files.map(f => safePath(f, s.loaded.dir, s.loaded.sandboxed))
      for (const p of paths) s.uploads.set(basename(p), p)
      locator = locator.first()
      if (safe) return v.skip('upload')
      if (!dryRun) {
        // A file field is often hidden behind its label (a drop zone): the cursor goes to what is seen
        const where = await locator.evaluate(el => {
          const seen = e => e && e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 12
          const host = [el, /** @type {HTMLInputElement} */ (el).labels?.[0], el.closest('label'), el.parentElement].find(seen)
          if (!host) return null
          host.scrollIntoView({ block: 'center', behavior: 'smooth' })
          return true
        })
        if (where) {
          await wait(300)
          const r = await locator.evaluate(el => {
            const seen = e => e && e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 12
            const host = [el, /** @type {HTMLInputElement} */ (el).labels?.[0], el.closest('label'), el.parentElement].find(seen)
            const b = host.getBoundingClientRect()
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
          })
          await moveTo(r.x, r.y)
          await wait(200)
          s.clickNoise()
          await tap(page, r.x, r.y)
          await wait(250)
        }
        const en = (s.script.language ?? 'es').startsWith('en')
        await filePicker(page, paths.map(p => basename(p)), en ? { title: 'Open file', open: 'Open', folder: 'Documents' } : { title: 'Abrir archivo', open: 'Abrir', folder: 'Documentos' })
        s.clickNoise()
      }
      await locator.setInputFiles(paths)
      await wait(450)
    },
  }
}
