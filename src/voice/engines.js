// TTS engines. Each one writes the audio of one sentence to `out` (any format ffmpeg reads) and
// reports whether it can run on this server. `native` lists the voice options (rate, pitch, volume) it
// applies itself; the others are applied with ffmpeg afterwards. Plugins add engines with the same shape.
import { spawn } from 'node:child_process'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log, run, runWithInput, sleep, UserError } from '#core/util.js'
import { findPiperVoice } from './piper-voices.js'
import { pythonProcess } from './python.js'

// "+10%" / "-4.5%" → "+10%" / "-5%" (edge-tts takes whole signed numbers only)
const signed = (value, unit) => {
  const m = new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)${unit}$`).exec(String(value ?? '').trim())
  if (!m) return null
  const n = Math.round(Number(m[1]))
  return `${n < 0 ? '-' : '+'}${Math.abs(n)}${unit}`
}

const brokenPython = new Set()

const piper = {
  native: ['rate'],
  available: async config => {
    const { bin, python, voicesDir } = config.tts.piper
    if (python) return { ok: true, python, voicesDir, note: 'kept loaded (piper-tts)' }
    if (!bin) return { ok: false, reason: 'piper not found (tourwright install, or TOURWRIGHT_PIPER_BIN)' }
    return { ok: true, bin, voicesDir }
  },
  synthesize: async ({ text, voice, out, config }) => {
    const { bin, python } = config.tts.piper
    if (!bin && !python) throw new Error('piper not installed (run `tourwright install` or set TOURWRIGHT_PIPER_BIN)')
    const model = findPiperVoice(config, voice.id)
    if (!model) throw new UserError(`piper voice ${voice.id} not installed: tourwright install-voice ${voice.id}`)
    // length_scale > 1 speaks slower; a "rate" like edge's (-10%) is translated
    const rate = voice.options.rate ? 1 / (1 + Number.parseFloat(voice.options.rate) / 100) : voice.options.lengthScale
    // piper-tts 1.8 keeps the voice loaded for the whole render: about 5× faster per sentence than the command
    if (python && !brokenPython.has(python)) {
      const lengthScale = rate ? Number(rate) : undefined
      try {
        return void (await pythonProcess(python, 'piper_voice.py', [model]).send({ text, out, lengthScale, speaker: voice.options.speaker }))
      } catch (error) {
        // An older piper-tts cannot be kept loaded: its `piper` command still works
        if (!bin || !/piper_voice\.py (stopped|did not start)/.test(error.message)) throw error
        brokenPython.add(python)
        log.warn(`piper-tts cannot stay loaded (${error.message.split('\n')[0]}); using the slower piper command`)
      }
    }
    const args = ['--model', model, '--output_file', out]
    if (rate) args.push('--length_scale', String(rate))
    if (voice.options.speaker) args.push('--speaker', voice.options.speaker)
    await runWithInput(config.tts.piper.bin, args, text, { timeout: 120_000 })
  },
}

const edge = {
  native: options => ['rate', ...(signed(options.pitch, 'Hz') ? ['pitch'] : []), ...(signed(options.volume, '%') ? ['volume'] : [])],
  available: async config =>
    config.tts.edge.bin ? { ok: true, bin: config.tts.edge.bin, note: 'needs internet' } : { ok: false, reason: 'edge-tts not found (pip install edge-tts)' },
  synthesize: async ({ text, voice, out, config }) => {
    if (!config.tts.edge.bin) throw new Error('edge-tts not installed (pip install edge-tts or set TOURWRIGHT_EDGE_TTS_BIN)')
    const o = voice.options
    const args = ['--voice', voice.id, `--rate=${signed(o.rate, '%') ?? '+0%'}`, `--pitch=${signed(o.pitch, 'Hz') ?? '+0Hz'}`,
      `--volume=${signed(o.volume, '%') ?? '+0%'}`, '--text', text, '--write-media', out]
    // An online service: a dropped connection or "No audio was received" usually works on the next try
    for (let attempt = 1; ; attempt++) {
      try {
        return void (await run(config.tts.edge.bin, args, { timeout: 90_000 }))
      } catch (error) {
        if (attempt >= 3) throw error
        await sleep(attempt * 2000)
      }
    }
  },
}

// What else makes a sentence sound different besides its voice spec and text (`fingerprint`): part of the key of
// the sentence cache, so changing it makes the sentences again instead of reusing the old ones
const fileStamp = path => {
  try {
    const s = statSync(path)
    return `${s.size}-${Math.round(s.mtimeMs)}`
  } catch {
    return ''
  }
}

const openai = {
  native: ['rate'],
  fingerprint: (voice, config) => `${config.tts.openai.url ?? ''}|${voice.options.model ?? config.tts.openai.model ?? ''}`,
  available: async config =>
    config.tts.openai.url ? { ok: true, url: config.tts.openai.url, model: config.tts.openai.model } : { ok: false, reason: 'set TOURWRIGHT_OPENAI_TTS_URL (and TOURWRIGHT_OPENAI_TTS_KEY)' },
  synthesize: async ({ text, voice, out, config }) => {
    const { url, key, model } = config.tts.openai
    if (!url) throw new Error('TOURWRIGHT_OPENAI_TTS_URL not set')
    const body = { model: voice.options.model ?? model, voice: voice.id, input: text, response_format: 'wav' }
    if (voice.options.speed) body.speed = Number(voice.options.speed)
    else if (voice.options.rate) body.speed = Math.min(4, Math.max(0.25, 1 + Number.parseFloat(voice.options.rate) / 100))
    if (voice.options.instructions) body.instructions = voice.options.instructions
    const response = await fetch(`${url.replace(/\/$/, '')}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`TTS server answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
    writeFileSync(out, Buffer.from(await response.arrayBuffer()))
  },
}

// A path as one word for the system shell: in single quotes for sh, double quotes for cmd.exe (a Windows path
// never holds a double quote)
const shellWord = (path, platform = process.platform) => (platform === 'win32' ? `"${path}"` : `'${path.replaceAll("'", `'\\''`)}'`)

/**
 * The command line with {voice} and {out} filled in. {out} is quoted, so a path with spaces stays one word; when
 * the command already quotes it ("{out}" or '{out}') the path goes inside those quotes as it is.
 */
export const commandLine = (template, { voice, out }, platform = process.platform) =>
  template.replaceAll('{voice}', voice).replace(/(["']?)\{out\}\1/g, (_, quote) => (quote ? `${quote}${out}${quote}` : shellWord(out, platform)))

// TOURWRIGHT_TTS_COMMAND="my-tts --voice {voice} --out {out}": text arrives on stdin. The same values are in
// TOURWRIGHT_TTS_VOICE and TOURWRIGHT_TTS_OUT, for a command that reads them from the environment.
const command = {
  fingerprint: (_, config) => config.tts.command ?? '',
  available: async config => (config.tts.command ? { ok: true, command: config.tts.command } : { ok: false, reason: 'set TOURWRIGHT_TTS_COMMAND' }),
  synthesize: async ({ text, voice, out, config }) => {
    if (!config.tts.command) throw new Error('TOURWRIGHT_TTS_COMMAND not set')
    const line = commandLine(config.tts.command, { voice: voice.id, out })
    await new Promise((resolve, reject) => {
      // The system shell: sh, or cmd.exe on Windows
      const child = spawn(line, { shell: true, stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, TOURWRIGHT_TTS_VOICE: voice.id, TOURWRIGHT_TTS_OUT: out } })
      let stderr = ''
      child.stderr.on('data', c => (stderr += c))
      child.on('error', reject)
      child.on('exit', code => (code === 0 ? resolve(undefined) : reject(new Error(`TTS command exited ${code}: ${stderr.slice(-300)}`))))
      child.stdin.end(text)
    })
  },
}

// Kyutai Pocket TTS: an open model (MIT code) with natural Spanish, English, French, German, Italian and
// Portuguese, on the CPU, offline once downloaded. `pocket:lola` (Spanish), `pocket:lola?model=spanish` (faster,
// a bit flatter), or the name of a .wav in the voices folder to speak with that voice (`pocket:my-voice`,
// with the consent of whoever it belongs to). Loading the model takes seconds, so one process per model and
// voice stays loaded for the whole render (src/voice/pocket.py) and gets one sentence at a time.
const POCKET_MODELS = { lola: 'spanish_24l', giovanni: 'italian_24l', juergen: 'german_24l', rafael: 'portuguese_24l', estelle: 'french_24l' }
const pocket = {
  native: [],
  // A voice of your own: the same name with another recording is another voice
  fingerprint: (voice, config) => fileStamp(join(config.tts.piper.voicesDir, `${voice.id}.wav`)),
  available: async config =>
    config.tts.pocket.python
      ? { ok: true, python: config.tts.pocket.python, note: 'downloads its model the first time' }
      : { ok: false, reason: 'not installed (tourwright install --pocket)' },
  synthesize: async ({ text, voice, out, config }) => {
    if (!config.tts.pocket.python) throw new UserError('Pocket TTS is not installed: tourwright install --pocket')
    // A voice of your own: a .wav in the voices folder
    const wav = join(config.tts.piper.voicesDir, `${voice.id}.wav`)
    const source = existsSync(wav) ? wav : voice.id
    const model = voice.options.model ?? POCKET_MODELS[voice.id] ?? 'english'
    if (!/^[a-z0-9_.-]+$/.test(model)) throw new UserError(`invalid pocket model "${model}"`)
    await pythonProcess(config.tts.pocket.python, 'pocket.py', [model, source]).send({ text, out })
  },
}

export const ENGINES = { piper, pocket, edge, openai, command }
