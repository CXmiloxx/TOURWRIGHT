// The sizes a video comes in, by name.
import { UserError } from '#core/util.js'

export const QUALITIES = {
  sd: { width: 854, height: 480, crf: '26', preset: 'medium' },
  hd: { width: 1280, height: 720, crf: '23', preset: 'medium' },
  fullhd: { width: 1920, height: 1080, crf: '20', preset: 'medium' },
  // Vertical, for phones and short-form platforms
  vertical: { width: 1080, height: 1920, crf: '21', preset: 'medium' },
  square: { width: 1080, height: 1080, crf: '21', preset: 'medium' },
}

/** A quality by name, or an error that lists them */
export const qualityOf = name => {
  const q = QUALITIES[name]
  if (!q) throw new UserError(`quality "${name}" does not exist: use ${Object.keys(QUALITIES).join(', ')}`)
  return q
}
