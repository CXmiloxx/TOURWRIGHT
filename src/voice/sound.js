// How the narration sounds: the polish presets (tone only; compose() levels each sentence to LOUDNESS) and
// the ffmpeg filters for the rate, pitch and volume an engine does not do itself.
import { loadConfig } from '#core/config.js'
import { UserError } from '#core/util.js'

// The sound of each preset, without the loudness: compose() levels every sentence to the same loudness on its
// own (two passes, linear gain), so no sentence comes out louder than the next and nothing pumps in the silences.
// default: clear and close, the way people expect a narrator: warmth in the lows, presence where consonants live,
// softer "s", gentle compression. No room: an echo blurs the words.
export const POLISH_DEFAULT =
  'highpass=f=80,equalizer=f=180:t=q:w=1:g=1.5,equalizer=f=3200:t=q:w=1.2:g=2.5,deesser=i=0.35,' +
  'acompressor=threshold=-20dB:ratio=2.5:attack=8:release=140'

// Named sounds for the narration. Scripts pick one by name; only the server config takes a raw filter.
export const POLISH_PRESETS = {
  default: POLISH_DEFAULT,
  // Just even loudness: the voice as the engine made it
  clean: 'highpass=f=60',
  // Closer and rounder
  warm: 'highpass=f=70,equalizer=f=150:t=q:w=1:g=3.5,equalizer=f=3000:t=q:w=2:g=-1,equalizer=f=8000:t=q:w=2:g=-2,' +
    'acompressor=threshold=-22dB:ratio=3:attack=10:release=200',
  // Telephone / walkie-talkie band
  radio: 'highpass=f=300,lowpass=f=3400,equalizer=f=1800:t=q:w=1:g=4,acompressor=threshold=-25dB:ratio=6:attack=5:release=100',
  // Dense and upfront, like a podcast host, with a hint of room
  podcast: 'highpass=f=80,equalizer=f=200:t=q:w=1:g=2,equalizer=f=5000:t=q:w=1.5:g=2.5,deesser=i=0.4,' +
    'acompressor=threshold=-24dB:ratio=4:attack=5:release=120:makeup=2,aecho=0.9:0.7:20:0.05',
  none: null,
}

// Where every sentence lands: -16 LUFS (web and podcast standard), peaks under -1.5 dB
export const LOUDNESS = { I: -16, TP: -1.5, LRA: 7 }
const LOUDNORM = `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`

/** The tone of a preset only (or the server's raw filter, as it is); null for none */
export const polishTone = (config = loadConfig(), preset) => {
  const p = preset ?? config.tts.polish
  if (!p || p === 'none') return null
  return Object.hasOwn(POLISH_PRESETS, p) ? POLISH_PRESETS[p] : p
}

// The script's preset wins over the server's; the server may also set a raw ffmpeg filter.
// One filter for a single clip (voice samples): the tone, then the loudness. A raw server filter goes as it is.
export const polishFilter = (config = loadConfig(), preset) => {
  const p = preset ?? config.tts.polish
  const tone = polishTone(config, preset)
  if (!tone) return null
  return Object.hasOwn(POLISH_PRESETS, p) ? `${tone},${LOUDNORM}` : tone
}
const number = (value, unit) => {
  const m = new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)${unit}$`).exec(String(value).trim())
  return m ? Number(m[1]) : null
}

// ffmpeg filters for the rate, pitch and volume an engine does not handle itself.
export const prosodyFilter = (options, native = []) => {
  const filters = []
  const has = k => options[k] !== undefined && options[k] !== '' && !native.includes(k)
  if (has('pitch')) {
    const st = number(options.pitch, 'st')
    const pct = number(options.pitch, '%')
    const factor = st !== null ? 2 ** (st / 12) : pct !== null ? 1 + pct / 100 : null
    if (factor === null) throw new UserError(`pitch "${options.pitch}": use semitones (+2st) or percent (-5%) with this voice`)
    if (factor !== 1) {
      const f = Math.min(2, Math.max(0.5, factor))
      filters.push(`asetrate=24000*${f.toFixed(4)},aresample=24000,atempo=${(1 / f).toFixed(4)}`)
    }
  }
  if (has('rate')) {
    const pct = number(options.rate, '%')
    if (pct === null) throw new UserError(`rate "${options.rate}": use a percent (+10%, -15%)`)
    if (pct) filters.push(`atempo=${Math.min(2, Math.max(0.5, 1 + pct / 100)).toFixed(4)}`)
  }
  if (has('volume')) {
    const db = number(options.volume, 'dB')
    const pct = number(options.volume, '%')
    if (db === null && pct === null) throw new UserError(`volume "${options.volume}": use dB (+3dB) or percent (-20%)`)
    filters.push(db !== null ? `volume=${db}dB` : `volume=${Math.max(0, 1 + pct / 100).toFixed(3)}`)
  }
  return filters.join(',')
}
