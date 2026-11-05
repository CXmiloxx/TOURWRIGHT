// The voices of this machine and their samples: what `tourwright voices` lists and records.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fromRoot } from '#core/paths.js'
import { loadConfig } from '#core/config.js'
import { run } from '#core/util.js'
import { ENGINES } from './engines.js'
import { findPiperVoice, installedPiperVoices } from './piper-voices.js'
import { narrate, requireFfmpeg } from './narrate.js'
import { polishFilter } from './sound.js'
import { ALIASES, parseVoice, voiceLanguages } from './voices.js'

// A recorded sample of every built-in voice comes with Tourwright (docs/voices/<name>.mp3): anyone can listen
// to them and choose before installing anything. `tourwright voices --samples` records them again, with
// this server's voices or another text.
export const SAMPLES_DIR = fromRoot('docs', 'voices')
export const SAMPLES_URL = 'https://github.com/CXmiloxx/TOURWRIGHT/tree/main/docs/voices'

const SAMPLE_TEXT = {
  es: 'Hola, soy {name}. Así sueno narrando un video: la API responde en JSON, el informe llega en PDF, y este mes van 25.800 consultas, el 95 % con resultado.',
  en: "Hi, I'm {name}. This is how I sound narrating a video: the API answers in JSON, the report comes as a PDF, and this month there were twenty-five thousand searches.",
}

/**
 * Records a sample of each named voice into `out` (mp3). Multilingual voices speak Spanish, the rest their language.
 * @param {any} config @param {{ out: string, text?: string, only?: string[] }} options
 * @returns {Promise<{ name: string, voice: string, language: string, file?: string, error?: string }[]>}
 */
export const recordSamples = async (config, { out, text, only = [] }) => {
  const named = Object.entries({ ...ALIASES, ...config.tts.aliases }).filter(([name]) => !only.length || only.includes(name))
  const results = []
  for (const [name, spec] of named) {
    let languages = ['es']
    try {
      languages = voiceLanguages(parseVoice(spec, config))
    } catch {}
    // One folder per language: docs/voices/es/lola.mp3, docs/voices/en/alba.mp3
    for (const lang of languages) {
      try {
        const said = (text ?? SAMPLE_TEXT[lang] ?? SAMPLE_TEXT.es).replaceAll('{name}', name.split('-')[0].replace(/^./, c => c.toUpperCase()))
        const n = await narrate(said, spec, config, { language: lang })
        mkdirSync(join(out, lang), { recursive: true })
        const file = join(out, lang, `${name}.mp3`)
        await run(requireFfmpeg(config), ['-y', '-v', 'error', '-i', n.file, '-af', polishFilter(config) ?? 'anull', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', file])
        results.push({ name, voice: spec, language: lang, file })
      } catch (error) {
        results.push({ name, voice: spec, language: lang, error: String(error.message).split('\n')[0] })
      }
    }
  }
  return results
}

// Every voice this server can use right now, with the engines that are (not) available.
export const listVoices = async (config = loadConfig()) => {
  const engines = Object.fromEntries(
    await Promise.all(Object.entries(ENGINES).map(async ([name, e]) => [name, await e.available(config)]))
  )
  const voices = []
  for (const [alias, spec] of Object.entries({ ...ALIASES, ...config.tts.aliases })) {
    const engine = spec.split(':')[0]
    if (engine === 'piper' && engines.piper.ok) {
      const model = spec.slice(6).split('?')[0]
      if (!findPiperVoice(config, model)) continue
    }
    let languages = []
    try {
      languages = voiceLanguages(parseVoice(spec, config))
    } catch {}
    const samples = Object.fromEntries(languages.map(l => [l, join(SAMPLES_DIR, l, `${alias}.mp3`)]).filter(([, f]) => existsSync(f)))
    voices.push({ name: alias, voice: spec, engine, languages, available: Boolean(engines[engine]?.ok), samples })
  }
  if (engines.piper.ok) {
    // Installed Piper voices without a name of their own
    for (const id of installedPiperVoices(config).filter(id => !voices.some(v => v.voice === `piper:${id}`))) {
      voices.push({ name: `piper:${id}`, voice: `piper:${id}`, engine: 'piper', languages: [id.slice(0, 2)], available: true, samples: {} })
    }
  }
  return { default: config.tts.defaultVoice, engines, voices }
}
