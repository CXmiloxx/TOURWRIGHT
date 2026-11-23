// How each line is said when the narration should have life (`audio.dynamic`, on with `style: promo`): the way
// a presenter varies, not one flat speed. A question rises, an exclamation speeds up, a short line lands slower
// and lower, a long one keeps moving. On top of the whole narration's `audio.rate`; a line's own rate or pitch
// always wins. These are shifts (`rateShift`, `pitchShift`, in percent): parseVoice adds them to the voice's own
// rate and pitch (an alias tuned to -10% stays 10% slower than the rest), and percent works on every engine.

const percent = value => {
  const m = /^([+-]?\d+(?:\.\d+)?)%$/.exec(String(value ?? '').trim())
  return m ? Number(m[1]) : 0
}
const signed = (n, unit = '%') => `${n >= 0 ? '+' : ''}${Math.round(n)}${unit}`

// The words of a line, without marks, pauses or HTML
const words = text => String(text).replace(/<[^>]*>|\[\[[^\]]*\]\]|[{}]/g, ' ').trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w))

/**
 * The change a line gets for what it is: rate and pitch in percent.
 * @param {string} text
 * @returns {{ rate: number, pitch: number, kind: 'question' | 'exclamation' | 'punch' | 'long' | 'plain' }}
 */
export const lineShape = text => {
  const t = String(text).trim()
  const n = words(t).length
  if (/[?¿]/.test(t)) return { rate: 3, pitch: 5, kind: 'question' }
  if (/[!¡]/.test(t)) return { rate: 7, pitch: 3, kind: 'exclamation' }
  if (n > 0 && n <= 5) return { rate: -7, pitch: -2, kind: 'punch' }
  if (n > 18) return { rate: 4, pitch: 0, kind: 'long' }
  return { rate: 0, pitch: 0, kind: 'plain' }
}

/**
 * The prosody a line is said with: the line's own, else shifts from the narration's rate plus the line's shape.
 * @param {string} text @param {Record<string, any>} [prosody]  the line's own (rate, pitch, volume, voice, style)
 * @param {{ rate?: string, dynamic?: boolean }} [audio]  the script's `audio`
 */
export const lineProsody = (text, prosody = {}, audio = {}) => {
  if (!audio.rate && !audio.dynamic) return prosody
  const shape = audio.dynamic ? lineShape(text) : { rate: 0, pitch: 0 }
  const out = { ...prosody }
  if (out.rate === undefined) {
    const rate = percent(audio.rate) + shape.rate
    if (rate) out.rateShift = signed(rate)
  }
  if (out.pitch === undefined && shape.pitch) out.pitchShift = signed(shape.pitch)
  return out
}

const number = (value, unit) => {
  const m = new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)${unit}$`).exec(String(value ?? '').trim())
  return m ? Number(m[1]) : null
}
const fixed = (n, unit) => `${n >= 0 ? '+' : ''}${Number(n.toFixed(2))}${unit}`

/**
 * A voice's options with the line's shifts added to its own rate and pitch, in the unit the voice already uses
 * (percent, semitones or Hz for an Edge voice, taken as about 200 Hz).
 * @param {Record<string, string>} options @returns {Record<string, string>}
 */
export const applyShifts = options => {
  const { rateShift, pitchShift, ...out } = options
  const rs = number(rateShift, '%')
  if (rs) out.rate = fixed((number(out.rate, '%') ?? 0) + rs, '%')
  const ps = number(pitchShift, '%')
  if (ps) {
    const st = number(out.pitch, 'st')
    const hz = number(out.pitch, 'Hz')
    if (st !== null) out.pitch = fixed(st + 12 * Math.log2(1 + ps / 100), 'st')
    else if (hz !== null) out.pitch = fixed(hz + ps * 2, 'Hz')
    else out.pitch = fixed((number(out.pitch, '%') ?? 0) + ps, '%')
  }
  return out
}
