// Showing an element: frames, spotlights, callouts, zooms and the guided focus timed to the narration. The camera
// stays close after a zoomed focus, until a step that needs the whole page (steps.js) calls releaseCamera.
import { plainText } from '#core/util.js'
import { markedLine, stripMarks } from '#voice/index.js'
import { callout, camera, cameraOut, focusOff, focusOn, frame, setCaption, spotlight } from '#render/page/visuals.js'

/** @param {import('#render/walkthrough/stage.js').Stage} s @param {Record<string, any>} v */
export const cameraHelpers = (s, v) => {
  const { page, clock, plan, dryRun, safe, moveTo } = s
  const { wait } = clock
  const { pageSize } = plan
  // The element in view and its box, or nothing when it has none (hidden)
  const boxOf = async locator => {
    await locator.scrollIntoViewIfNeeded()
    return locator.boundingBox()
  }
  return {
    highlight: async (locator, ms = 2500) => {
      const box = await boxOf(locator.first())
      if (!box) return
      await frame(page, box, ms)
      await wait(ms)
    },
    spotlight: async (locator, ms = 2500) => {
      const box = await boxOf(locator.first())
      if (!box) return
      await spotlight(page, box, ms)
      await wait(ms + 400)
    },
    callout: async (locator, html, { ms = 3000, position = 'auto' } = {}) => {
      const box = await boxOf(locator.first())
      if (!box) return
      await callout(page, box, html, ms, position)
      await wait(ms + 300)
    },
    zoom: async (locator, ms = 2500, scale = 1.6) => {
      await v.releaseCamera()
      locator = locator.first()
      const b = await boxOf(locator)
      if (!b) return
      // The element fits whole, and never less than a noticeable zoom
      const e = Math.max(1.15, Math.min(scale, (pageSize.width * 0.85) / b.width, (pageSize.height * 0.7) / b.height))
      await camera(locator, e)
      await wait(900 + ms)
      await camera(locator, 1)
      await wait(900)
    },
    focus: async (locator, options = {}) => {
      // The hold after the voice is short: a long silence before the next action loses the viewer
      const { text, say, caption, step, zoom: asked, pulse, click, ms = click ? 150 : 600, position, ...prosody } = options
      locator = locator.first()
      // Never closer than the element fits whole, with a margin: a wide field on a phone is not cut by the camera
      const size = asked && asked > 1 ? await locator.evaluate(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height } }).catch(() => null) : null
      const fits = size ? Math.min((pageSize.width * 0.9) / Math.max(1, size.w), (pageSize.height * 0.6) / Math.max(1, size.h)) : 1
      const zoom = asked && asked > 1 ? Math.min(asked, fits) : asked
      // Under a gentle 8 %, a push in is not worth the movement
      const zoomed = Boolean(zoom && zoom >= 1.08)
      await clock.waitVoice()
      // "{Pay}" marks the word the focus lands on. Its time is the length of what is said before it
      // (synthesized on its own; cached like any sentence), a little early as the eye needs it.
      const { spoken, before } = markedLine(say)
      const narration = spoken ? await s.synth(plainText(spoken), prosody) : null
      // The part before the mark, said the way the whole line says it: its length is when the focus lands
      const lead = narration && /[\p{L}\p{N}]/u.test(before ?? '') ? await s.synth(plainText(before), prosody, plainText(spoken)) : null
      // The picture leads the sound, never the other way: the focus lands at the marked word, and at the latest
      // before half the line is said (a mark at the end of a short line would land when the voice has stopped)
      const at = lead ? Math.min(Math.max(0, lead.duration - 0.25), narration.duration * 0.45) : 0
      // Held close from the focus before: a zoomed focus glides there, any other goes back to the whole page first
      if (s.state.cameraHeld && zoomed) {
        await camera(locator, zoom)
        await wait(dryRun ? 0 : 700)
      } else await v.releaseCamera()
      // The voice starts and the cursor glides there meanwhile: no silence while it travels. A focus that clicks
      // waits until the element can be clicked before it starts talking about it
      let target = await s.center(locator, Boolean(click) && !safe)
      // The voice would name the element before the camera got there: the camera goes first, then the voice
      const early = zoomed && !s.state.cameraHeld && at < 1.2
      if (early) {
        await camera(locator, zoom)
        await wait(dryRun ? 0 : 750)
        const box = await locator.boundingBox()
        if (box) target = { ...target, x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height }
      }
      const shown = caption ?? (spoken || null)
      if (shown) {
        const html = stripMarks(shown)
        await setCaption(page, html)
        if (!dryRun) await s.clearCaption(target, locator)
        clock.closeCaption()
        clock.markStart()
        clock.addCaption(plainText(html))
      } else clock.markStart()
      if (narration) clock.play(narration, v.step)
      const started = clock.now()
      // The cursor travels while the line goes on: the focus lands at its time, not after a long glide
      // (a page closed meanwhile, by a time limit, fails the step below: the move's own error is not left unhandled)
      let moveError = null
      const travel = moveTo(target.x, target.y).catch(e => (moveError = e))
      try {
        const left = at - (clock.now() - started)
        if (left > 0) await wait(left * 1000)
        if (zoomed && !s.state.cameraHeld && !early) {
          // The focus lands once the camera has done most of its move: a layer chasing a fast element lags
          await camera(locator, zoom)
          await wait(450)
        }
        await focusOn(locator, { html: text, step, pulse, position, zoom: zoomed ? zoom : 1 })
      } finally {
        await travel
      }
      if (moveError) throw moveError
      if (zoomed) {
        // The element moved under the camera: the cursor follows it
        await wait(250)
        const box = await locator.boundingBox()
        if (box) await moveTo(box.x + box.width / 2, box.y + box.height / 2)
      }
      await clock.waitSpeech()
      await wait(ms)
      // The focus fades out and the camera stays close: what comes next (typing in the field, the click) is seen
      // up close, and the next zoomed focus glides from here. Other steps take it back (releaseCamera).
      await focusOff(page)
      s.state.cameraHeld = Boolean(zoomed)
      if (click) await v.click(locator)
    },
    releaseCamera: async () => {
      if (!s.state.cameraHeld) return
      s.state.cameraHeld = false
      if (await cameraOut(page).catch(() => false)) await wait(dryRun ? 0 : 750)
    },
  }
}
