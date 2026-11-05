// The recording's clock and what happens on it: captions, chapters, cuts, narration and sound effects, all in
// seconds since the recording started. compose() turns them into the final video.

/**
 * @param {import('playwright').Page} page
 * @param {{ dryRun: boolean, startedAt?: number }} options
 */
export const createClock = (page, { dryRun, startedAt = Date.now() }) => {
  const now = () => (Date.now() - startedAt) / 1000
  /** @type {{ start: number, end?: number, text: string }[]} */
  const captions = []
  /** @type {{ start: number, title: string }[]} */
  const marks = []
  /** @type {[number, number][]} */
  const cuts = []
  /** @type {{ at: number, file: string, duration: number, step?: number, text?: string, voice?: string }[]} */
  const narrations = []
  /** @type {{ at: number, file: string, volume: number, kind: string }[]} */
  const effects = []
  /** @type {{ step: number, at: number }[]} */
  const steps = []
  // When the video starts (everything before is the page loading); when the voice really stops, and voiceUntil
  // adds the breath before the next sentence
  let startS = 0
  let voiceEnd = 0
  let voiceUntil = 0

  const clock = {
    now,
    captions,
    marks,
    cuts,
    narrations,
    effects,
    steps,
    get start() {
      return startS
    },
    get voiceEnd() {
      return voiceEnd
    },
    /** The video starts at the first title, caption or focus */
    markStart: () => {
      if (!startS) startS = now()
    },
    closeCaption: () => {
      const last = captions.at(-1)
      if (last && last.end === undefined) last.end = now()
    },
    /** @param {string} text */
    addCaption: text => captions.push({ start: now(), text }),
    /** @param {string} title */
    addMark: title => marks.push({ start: now(), title }),
    /** A pause on camera; a dry run hardly waits */
    wait: ms => page.waitForTimeout(dryRun ? Math.min(ms, 20) : ms),
    /** A new caption, a title card or a cut wait for the previous narration to finish */
    waitVoice: async () => {
      const left = voiceUntil - now()
      if (left > 0 && !dryRun) await page.waitForTimeout(left * 1000)
    },
    /** An action that follows what was said starts as the voice stops, not a breath later */
    waitSpeech: async () => {
      const left = voiceEnd - now()
      if (left > 0 && !dryRun) await page.waitForTimeout(left * 1000)
    },
    /** A stretch cut from the video */
    cut: (from, to = now()) => cuts.push([from, to]),
    /** Slow preparation (a voice or a sound made for the first time) is cut from the video when it takes a while */
    offClock: async fn => {
      const from = now()
      try {
        return await fn()
      } finally {
        if (now() - from > 0.3) cuts.push([from, now()])
      }
    },
    /** What happens inside `fn` is cut from the video, after the voice has finished */
    offCamera: async fn => {
      await clock.waitVoice()
      const from = now()
      try {
        return await fn()
      } finally {
        cuts.push([from, now()])
      }
    },
    /** A sentence starts now */
    play: (n, step) => {
      narrations.push({ at: now(), file: n.file, duration: n.duration, step, text: n.text, voice: n.spec })
      voiceEnd = now() + n.duration
      voiceUntil = voiceEnd + 0.4
    },
    /** A sound effect now */
    effect: (file, volume, kind) => effects.push({ at: now(), file, volume, kind }),
    /** @param {number} step */
    stepStarts: step => steps.push({ step, at: now() }),
    /** Everything compose() needs about time, the cut before the start included */
    timeline: end => ({ end, cuts: [[0, startS], ...cuts], narrations, effects, captions, marks }),
  }
  return clock
}

/** @typedef {ReturnType<typeof createClock>} Clock */
