// Which voice: a string `engine:id[?option=value&…]` or an alias (built-in, from the config or the script's
// `voices`), the most natural one for a language when nobody chose, and a voice with some options changed.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '#core/config.js'
import { UserError } from '#core/util.js'
import { ENGINES } from './engines.js'
import { voiceLanguage } from './lexicon.js'

// Built-in aliases: tested voices that sound good. Config `tts.aliases` adds or overrides.
export const ALIASES = {
  // Spanish · Colombia
  gonzalo: 'edge:es-CO-GonzaloNeural?rate=-10%',
  salome: 'edge:es-CO-SalomeNeural?rate=-4%',
  // Spanish · Mexico, US
  jorge: 'edge:es-MX-JorgeNeural?rate=-6%',
  dalia: 'edge:es-MX-DaliaNeural?rate=-4%',
  alonso: 'edge:es-US-AlonsoNeural?rate=-6%',
  paloma: 'edge:es-US-PalomaNeural?rate=-4%',
  // Multilingual (speak most languages without a strong accent)
  andrew: 'edge:en-US-AndrewMultilingualNeural?rate=-6%',
  ava: 'edge:en-US-AvaMultilingualNeural?rate=-4%',
  emma: 'edge:en-US-EmmaMultilingualNeural?rate=-4%',
  brian: 'edge:en-US-BrianMultilingualNeural?rate=-6%',
  // English · US, UK
  jenny: 'edge:en-US-JennyNeural?rate=-4%',
  guy: 'edge:en-US-GuyNeural?rate=-6%',
  sonia: 'edge:en-GB-SoniaNeural?rate=-4%',
  // Offline, open and natural (Pocket TTS: tourwright install --pocket). Spanish, then English
  lola: 'pocket:lola',
  'lola-rapida': 'pocket:lola?model=spanish',
  alba: 'pocket:alba',
  jane: 'pocket:jane',
  mary: 'pocket:mary',
  michael: 'pocket:michael',
  george: 'pocket:george',
  // Offline (Piper): lighter, more synthetic
  claude: 'piper:es_MX-claude-high',
  davefx: 'piper:es_ES-davefx-medium',
  lessac: 'piper:en_US-lessac-medium',
  ryan: 'piper:en_US-ryan-high',
}
// `a=1&b=-4%`: values are taken literally (`+10%` stays `+10%`, unlike URL decoding)
const parseOptions = query =>
  Object.fromEntries((query ?? '').split('&').filter(Boolean).map(pair => {
    const i = pair.indexOf('=')
    return i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)]
  }))

const withOptions = (base, options) => {
  const query = Object.entries(options).map(([k, v]) => `${k}=${v}`).join('&')
  return query ? `${base}?${query}` : base
}

// `aliases`: extra names, like the script's cast of voices. Options written after an alias add to (or
// replace) the alias' own.
export const parseVoice = (spec, config = loadConfig(), aliases = {}) => {
  const names = { ...ALIASES, ...config.tts.aliases, ...aliases }
  let [value, query] = String(spec ?? config.tts.defaultVoice).trim().split(/\?(.*)/s)
  let options = parseOptions(query)
  for (let i = 0; i < 8 && Object.hasOwn(names, value); i++) {
    const [base, own] = String(names[value]).trim().split(/\?(.*)/s)
    value = base
    options = { ...parseOptions(own), ...options }
  }
  const m = /^([a-z][a-z0-9]*):(.+)$/.exec(value)
  if (!m) throw new UserError(`unknown voice "${spec}": use engine:id (${Object.keys(ENGINES).map(e => `${e}:…`).join(', ')}) or a name (${Object.keys(names).join(', ')})`)
  const [, engine, id] = m
  if (!ENGINES[engine]) throw new UserError(`unknown TTS engine "${engine}" (${Object.keys(ENGINES).join(', ')})`)
  // The id ends up in file paths (piper) and in a shell line (command): letters, digits, . _ - only
  if (!/^[A-Za-z0-9_.-]+$/.test(id) || id.includes('..')) throw new UserError(`invalid voice id "${id}"`)
  return { engine, id, options, spec: withOptions(`${engine}:${id}`, options) }
}

// The most natural voice this machine can use for a language, when nobody chose one: Pocket TTS (offline,
// natural) when installed; else a neural Microsoft voice when edge-tts answers (needs internet; tried once per
// process with a short word); else Piper, offline everywhere.
const AUTO = {
  pocket: { es: 'lola', en: 'alba', pt: 'pocket:rafael', fr: 'pocket:estelle', de: 'pocket:juergen', it: 'pocket:giovanni' },
  edge: { es: 'salome', en: 'ava' },
  piper: { es: 'claude', en: 'lessac' },
}
let edgeWorks = null
const edgeAnswers = async config => {
  edgeWorks ??= (async () => {
    if (!(await ENGINES.edge.available(config).catch(() => ({ ok: false }))).ok) return false
    const dir = mkdtempSync(join(tmpdir(), 'tw-edge-'))
    try {
      const probe = ENGINES.edge.synthesize({ text: 'ok', voice: parseVoice('ava', config), out: join(dir, 'probe.wav'), config })
      await Promise.race([probe, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))])
      return true
    } catch {
      return false
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })()
  return edgeWorks
}

/** @param {string} [language] @returns {Promise<string>} a voice spec */
export const autoVoice = async (language, config = loadConfig()) => {
  if (config.tts.voiceChosen) return config.tts.defaultVoice
  const lang = String(language ?? 'es').slice(0, 2).toLowerCase()
  if (config.tts.pocket?.python) return AUTO.pocket[lang] ?? AUTO.pocket.en
  // Multilingual Ava speaks the other languages without a strong accent
  if (await edgeAnswers(config)) return AUTO.edge[lang] ?? 'ava'
  return AUTO.piper[lang] ?? config.tts.defaultVoice
}

// A voice with some options changed: `withProsody('ana', { rate: '+10%' })` → 'ana?rate=+10%'.
/** @param {string} spec @param {{ rate?: string, pitch?: string, volume?: string, style?: string }} [prosody] */
export const withProsody = (spec, { rate, pitch, volume, style } = {}) => {
  const extra = Object.fromEntries(Object.entries({ rate, pitch, volume, instructions: style }).filter(([, v]) => v !== undefined))
  if (!Object.keys(extra).length) return spec
  const [base, query] = String(spec).split(/\?(.*)/s)
  return withOptions(base, { ...parseOptions(query), ...extra })
}
// The languages a voice is for: its own, and Spanish and English for the multilingual ones
/** @returns {string[]} */
export const voiceLanguages = voice => (/Multilingual/.test(voice.id) ? ['es', 'en'] : [voiceLanguage(voice) ?? 'es'])
