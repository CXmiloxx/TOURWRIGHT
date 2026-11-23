// `style`: the feel of a video in one word, as defaults. What the script sets itself always wins.
//   promo     a launch or an ad: upbeat music under the voice, a livelier voice that rises on questions and
//             lands short lines, a whoosh on every title card, clicks you can hear, the studio window
//   calm      onboarding at an easy pace: soft music, a slower voice, longer breaths between sentences
//   tutorial  none of these: the voice and the page, as before (the default)

/** @type {Record<string, { music?: Record<string, any>, audio?: Record<string, any>, theme?: Record<string, any> }>} */
export const STYLES = {
  promo: {
    music: { file: 'upbeat', volume: 0.32, fadeIn: 0.5, fadeOut: 2.5 },
    audio: { clicks: true, transitions: 'whoosh', dynamic: true, rate: '+6%', pause: 0.12 },
    theme: { frame: 'window', titleBackground: 'aurora' },
  },
  calm: {
    music: { file: 'calm', volume: 0.2, fadeIn: 1, fadeOut: 3 },
    audio: { rate: '-4%', pause: 0.35 },
  },
  tutorial: {},
}

/**
 * The script with its style's defaults under what it sets itself.
 * @template {Record<string, any>} T
 * @param {T} script
 * @returns {T & Record<string, any>}
 */
export const withStyle = script => {
  const style = STYLES[script.style ?? 'tutorial']
  if (!style || !Object.keys(style).length) return script
  const music = script.music ?? style.music
  return {
    ...script,
    ...(music ? { music } : {}),
    ...(style.audio ? { audio: { ...style.audio, ...script.audio } } : {}),
    ...(style.theme ? { theme: { ...style.theme, ...script.theme } } : {}),
  }
}
