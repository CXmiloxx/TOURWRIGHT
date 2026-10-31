// Configuration: built-in defaults < tourwright.config.json (or TOURWRIGHT_CONFIG) < environment < CLI flags.
// Every path and binary is discovered or configurable: nothing is tied to one machine.
import { existsSync, readFileSync } from 'node:fs'
import { cpus, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { findBinary, isWindows, UserError } from './util.js'

const env = process.env

// ~/.local/share/tourwright on Linux and macOS, %LOCALAPPDATA%\tourwright on Windows
const defaultHome = () => {
  if (env.TOURWRIGHT_HOME) return resolve(env.TOURWRIGHT_HOME)
  if (isWindows && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'tourwright')
  const xdg = env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  return join(xdg, 'tourwright')
}

// A program installed by `tourwright install` in its Python virtual environment (TOURWRIGHT_HOME/venv)
export const venvBin = (home, name) => (isWindows ? join(home, 'venv', 'Scripts', name) : join(home, 'venv', 'bin', name))

// Pocket TTS lives in that environment too (tourwright install --pocket); its Python runs src/voice/pocket.py
const pocketPython = (home, file) =>
  env.TOURWRIGHT_POCKET_PYTHON ?? file.tts?.pocket?.python ?? (findBinary(venvBin(home, 'pocket-tts')) ? findBinary(venvBin(home, 'python')) : null)

const readConfigFile = () => {
  const file = env.TOURWRIGHT_CONFIG ?? (existsSync('tourwright.config.json') ? 'tourwright.config.json' : null)
  if (!file) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read config ${file}: ${error.message}`)
  }
}

const bool = (value, fallback) => (value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()))
const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value))
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
const preset = value => {
  if (value === undefined || value === '') return undefined
  if (!PRESETS.includes(value)) throw new UserError(`TOURWRIGHT_PRESET must be one of ${PRESETS.join(', ')}`)
  return value
}
const list = value => (value ? String(value).split(',').map(x => x.trim()).filter(Boolean) : undefined)

let cached

// Binaries are looked up once; after installing them, a new lookup finds them
export const reloadConfig = () => {
  cached = undefined
  return loadConfig()
}

export const loadConfig = (overrides = {}) => {
  if (cached && !Object.keys(overrides).length) return cached
  const file = readConfigFile()
  const home = overrides.home ?? file.home ?? defaultHome()
  const pocket = pocketPython(home, file)
  const config = {
    home,
    // Rendered jobs (queue, outputs) and the shared voice cache
    dataDir: resolve(env.TOURWRIGHT_DATA_DIR ?? file.dataDir ?? join(home, 'data')),
    cacheDir: resolve(env.TOURWRIGHT_CACHE_DIR ?? file.cacheDir ?? join(home, 'cache')),
    // Credentials saved with `tourwright secret set` (see src/secrets.js)
    secretsFile: resolve(env.TOURWRIGHT_SECRETS_FILE ?? file.secretsFile ?? join(home, 'secrets.json')),
    // Temporary work files. /dev/shm (RAM) is faster than disk when it exists.
    tmpDir: env.TOURWRIGHT_TMP_DIR ?? file.tmpDir ?? (existsSync('/dev/shm') ? '/dev/shm' : undefined),

    ffmpeg: findBinary(env.TOURWRIGHT_FFMPEG, file.ffmpeg, 'ffmpeg', join(home, 'bin', 'ffmpeg')),
    ffprobe: findBinary(env.TOURWRIGHT_FFPROBE, file.ffprobe, 'ffprobe', join(home, 'bin', 'ffprobe')),
    xvfb: findBinary(env.TOURWRIGHT_XVFB, file.xvfb, 'Xvfb'),
    // Chromium: Playwright's own build by default; TOURWRIGHT_CHROMIUM points to another one (system package, ARM…)
    chromium: env.TOURWRIGHT_CHROMIUM ?? file.chromium,
    browsersPath: env.TOURWRIGHT_BROWSERS_PATH ?? file.browsersPath,
    // Threads per ffmpeg process and CPU priority: a shared server stays responsive.
    threads: num(env.TOURWRIGHT_FFMPEG_THREADS ?? file.threads, Math.max(1, Math.min(4, cpus().length))),
    nice: num(env.TOURWRIGHT_NICE ?? file.nice, 10),
    // x264 preset of the final video (default: medium). Faster on weak or virtual CPUs, at a larger file.
    preset: preset(env.TOURWRIGHT_PRESET ?? file.preset),

    tts: {
      // The most natural voice installed: Pocket TTS when it is there, else Piper
      defaultVoice: env.TOURWRIGHT_VOICE ?? file.tts?.defaultVoice ?? (pocket ? 'pocket:lola' : 'piper:es_MX-claude-high'),
      pocket: { python: pocket },
      piper: {
        bin: findBinary(env.TOURWRIGHT_PIPER_BIN, file.tts?.piper?.bin, 'piper', join(home, 'piper', 'piper'), venvBin(home, 'piper')),
        voicesDir: resolve(env.TOURWRIGHT_PIPER_VOICES ?? file.tts?.piper?.voicesDir ?? join(home, 'voices')),
      },
      edge: { bin: findBinary(env.TOURWRIGHT_EDGE_TTS_BIN, file.tts?.edge?.bin, 'edge-tts', venvBin(home, 'edge-tts')) },
      // Any server speaking the OpenAI /v1/audio/speech protocol: OpenAI, Kokoro-FastAPI, LocalAI, openedai-speech…
      openai: {
        url: env.TOURWRIGHT_OPENAI_TTS_URL ?? file.tts?.openai?.url ?? (env.OPENAI_API_KEY ? 'https://api.openai.com' : undefined),
        key: env.TOURWRIGHT_OPENAI_TTS_KEY ?? env.OPENAI_API_KEY ?? file.tts?.openai?.key,
        model: env.TOURWRIGHT_OPENAI_TTS_MODEL ?? file.tts?.openai?.model ?? 'tts-1',
      },
      // Any other engine: a command that reads text on stdin and writes {out}. {voice} is the voice id.
      command: env.TOURWRIGHT_TTS_COMMAND ?? file.tts?.command,
      // Named voices: { gonzalo: "edge:es-CO-GonzaloNeural?rate=-10%" }
      aliases: file.tts?.aliases ?? {},
      // Seconds of silence between sentences
      pause: num(env.TOURWRIGHT_TTS_PAUSE ?? file.tts?.pause, 0.5),
      // Sound of the narration: a preset (default, clean, warm, radio, podcast, none) or an ffmpeg audio filter
      polish: env.TOURWRIGHT_VOICE_POLISH ?? file.tts?.polish ?? 'default',
      // Words every voice should say differently: { "SaaS": "sas" }. A script's `pronounce` adds to it.
      pronounce: file.tts?.pronounce ?? {},
    },

    theme: { ...file.theme },

    // Modules that add step actions, TTS engines and voices (see src/plugins.js and docs/PLUGINS.md)
    plugins: list(env.TOURWRIGHT_PLUGINS) ?? file.plugins ?? [],

    queue: {
      driver: env.TOURWRIGHT_QUEUE ?? file.queue?.driver ?? (env.TOURWRIGHT_REDIS_URL ? 'redis' : 'local'),
      redisUrl: env.TOURWRIGHT_REDIS_URL ?? file.queue?.redisUrl,
      name: env.TOURWRIGHT_QUEUE_NAME ?? file.queue?.name ?? 'tourwright',
      // Videos rendered at the same time by one worker. Each one is a browser plus ffmpeg.
      concurrency: num(env.TOURWRIGHT_CONCURRENCY ?? file.queue?.concurrency, 1),
      jobTimeout: num(env.TOURWRIGHT_JOB_TIMEOUT ?? file.queue?.jobTimeout, 1800),
      attempts: num(env.TOURWRIGHT_JOB_ATTEMPTS ?? file.queue?.attempts, 2),
      // Finished jobs (and their files) are deleted after this many hours (0 = keep forever)
      retentionHours: num(env.TOURWRIGHT_RETENTION_HOURS ?? file.queue?.retentionHours, 72),
    },

    // Where finished files end up: the local data dir (shared volume) or any S3-compatible bucket.
    storage: {
      driver: env.TOURWRIGHT_STORAGE ?? file.storage?.driver ?? (env.TOURWRIGHT_S3_BUCKET ? 's3' : 'local'),
      s3: {
        endpoint: env.TOURWRIGHT_S3_ENDPOINT ?? file.storage?.s3?.endpoint,
        publicEndpoint: env.TOURWRIGHT_S3_PUBLIC_ENDPOINT ?? file.storage?.s3?.publicEndpoint,
        region: env.TOURWRIGHT_S3_REGION ?? file.storage?.s3?.region ?? 'us-east-1',
        bucket: env.TOURWRIGHT_S3_BUCKET ?? file.storage?.s3?.bucket,
        prefix: env.TOURWRIGHT_S3_PREFIX ?? file.storage?.s3?.prefix ?? 'tourwright/',
        accessKey: env.TOURWRIGHT_S3_ACCESS_KEY ?? env.AWS_ACCESS_KEY_ID,
        secretKey: env.TOURWRIGHT_S3_SECRET_KEY ?? env.AWS_SECRET_ACCESS_KEY,
        pathStyle: bool(env.TOURWRIGHT_S3_PATH_STYLE ?? file.storage?.s3?.pathStyle, true),
        urlExpires: num(env.TOURWRIGHT_S3_URL_EXPIRES, 3600),
      },
    },

    api: {
      host: env.TOURWRIGHT_HOST ?? file.api?.host ?? '127.0.0.1',
      port: num(env.TOURWRIGHT_PORT ?? file.api?.port, 4700),
      // Bearer tokens accepted by the HTTP API. Required unless the API only listens on localhost.
      tokens: list(env.TOURWRIGHT_API_TOKENS ?? env.TOURWRIGHT_API_TOKEN) ?? file.api?.tokens ?? [],
      maxBodyMb: num(env.TOURWRIGHT_MAX_BODY_MB ?? file.api?.maxBodyMb, 50),
      // JavaScript scripts run arbitrary code on the worker: off for API jobs unless you trust every client.
      allowJs: bool(env.TOURWRIGHT_ALLOW_JS ?? file.api?.allowJs, false),
      // ${env:TOURWRIGHT_SECRET_*} in API jobs: any client could type a secret into a page it controls.
      allowSecrets: bool(env.TOURWRIGHT_ALLOW_SECRETS ?? file.api?.allowSecrets, false),
    },

    // Sandbox for jobs that come from the API or MCP: which hosts the browser may load (empty = any)
    // and which hosts are always blocked (internal networks, cloud metadata).
    network: {
      allowedHosts: list(env.TOURWRIGHT_ALLOWED_HOSTS) ?? file.network?.allowedHosts ?? [],
      blockPrivate: bool(env.TOURWRIGHT_BLOCK_PRIVATE ?? file.network?.blockPrivate, false),
    },

    ...overrides,
  }
  if (!Object.keys(overrides).length) cached = config
  return config
}
