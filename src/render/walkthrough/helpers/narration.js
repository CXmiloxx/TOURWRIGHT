// What is said and shown in words: title cards, chapters, captions with their voice, sounds.
import { plainText } from '#core/util.js'
import { durationOf, stripMarks } from '#voice/index.js'
import { titleHtml } from '#render/page/theme.js'
import { hideTitle, setCaption, showTitle } from '#render/page/visuals.js'

/** @param {import('#render/walkthrough/stage.js').Stage} s @param {Record<string, any>} v */
export const narrationHelpers = (s, v) => {
  const { page, clock, plan, config } = s
  const { theme } = plan
  const speakNow = async (text, prosody) => {
    const n = await s.synth(text, prosody)
    if (n) clock.play(n, v.step)
  }
  return {
    // look: { kicker, animation, background }; the theme's titleAnimation and titleBackground are the defaults
    // With a voice the card only holds a beat after it: the viewer has just heard what it says
    title: async (text, subtitle = '', ms = undefined, speak = undefined, prosody = undefined, look = {}) => {
      ms ??= speak ? 700 : 2500
      await clock.waitVoice()
      await showTitle(page, titleHtml({ text, subtitle, kicker: look.kicker, animation: look.animation ?? theme.titleAnimation, background: look.background ?? theme.titleBackground, logo: theme.logo }))
      await page.waitForTimeout(150)
      clock.markStart()
      clock.addMark(text)
      if (speak) {
        await speakNow(speak, prosody)
        await clock.waitVoice()
      }
      await clock.wait(ms)
      await hideTitle(page)
      await clock.wait(450)
    },
    // A chapter of the video starting here, with nothing on screen
    chapter: async name => {
      clock.markStart()
      clock.addMark(name)
    },
    say: async (html, options = {}) => {
      const { speak, ms = 0, silent = false, ...prosody } = typeof options === 'number' ? { ms: options } : options
      await clock.waitVoice()
      // Text and voice start together: the voice is synthesized before the caption shows (instant when
      // cached). The time it takes is cut from the video: the screen is still meanwhile.
      const narration = html && !silent ? await s.synth(speak ?? plainText(html), prosody) : null
      if (html) html = stripMarks(html)
      await setCaption(page, html)
      clock.closeCaption()
      clock.markStart()
      if (html) clock.addCaption(plainText(html))
      if (narration) clock.play(narration, v.step)
      if (ms) await clock.wait(ms)
    },
    sound: async ({ file, volume = 1, wait: hold = false }) => {
      if (s.dryRun) return
      const path = await s.soundFile(file)
      s.effect(path, volume, 'sound')
      if (hold) await clock.wait((await durationOf(path, config)) * 1000)
    },
  }
}
