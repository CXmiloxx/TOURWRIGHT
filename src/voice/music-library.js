// Your own background music: tracks kept in the music folder (TOURWRIGHT_MUSIC_DIR) with a name and a mood, so a
// script says `music: launch-theme` or `music: upbeat` (any track of that mood) instead of a path. Added with
// `tourwright music add <file|url>`; `tourwright install --music` puts a set of public-domain tracks there.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { loadConfig } from '#core/config.js'
import { hash, UserError } from '#core/util.js'

// The moods a track can have: what a script asks for, and what each built-in style uses
export const MOODS = ['upbeat', 'corporate', 'calm', 'acoustic', 'tech', 'cinematic']
export const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.oga', '.opus', '.wav', '.m4a', '.aac', '.flac']
const NAME = /^[a-z0-9][a-z0-9-]{0,59}$/
const MAX_BYTES = 60 * 1024 * 1024

/** @typedef {{ name: string, file: string, mood?: string, title?: string, artist?: string, license?: string, source?: string }} Track */

const indexOf = config => join(config.musicDir, 'library.json')

/** A name for a file: lowercase words joined by dashes */
export const slug = text => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'track'

/**
 * The tracks in the music folder: those added with their details, and any audio file put there by hand.
 * @returns {Track[]}
 */
export const listTracks = (config = loadConfig()) => {
  if (!existsSync(config.musicDir)) return []
  let saved = {}
  try {
    saved = JSON.parse(readFileSync(indexOf(config), 'utf8')).tracks ?? {}
  } catch {}
  const tracks = []
  for (const f of readdirSync(config.musicDir).sort()) {
    // A download still in progress (or cut short) is a hidden file: never a track
    if (f.startsWith('.') || !AUDIO_EXTENSIONS.includes(extname(f).toLowerCase())) continue
    const name = basename(f, extname(f))
    tracks.push({ ...saved[name], name, file: join(config.musicDir, f) })
  }
  return tracks
}

/**
 * The track a script names: by its name, else one of that mood. Several of one mood: the same one for the same
 * `seed` (the video's title), so a video keeps its music and two videos may get different ones.
 * @param {string} wanted @param {string} [seed]
 * @returns {Track | null}
 */
export const findTrack = (wanted, seed = '', config = loadConfig()) => {
  const tracks = listTracks(config)
  const named = tracks.find(t => t.name === wanted)
  if (named) return named
  const moody = tracks.filter(t => t.mood === wanted)
  if (!moody.length) return null
  return moody[Number.parseInt(hash(seed).slice(0, 8), 16) % moody.length]
}

const saveIndex = (tracks, config) => {
  const index = Object.fromEntries(tracks.map(({ name, file, ...rest }) => [name, rest]))
  writeFileSync(indexOf(config), `${JSON.stringify({ tracks: index }, null, 2)}\n`)
}

/**
 * Adds a track: a local file or an http(s) URL, copied into the music folder under `name`.
 * @param {string} source @param {{ name?: string, mood?: string, title?: string, artist?: string, license?: string }} [details]
 * @returns {Promise<Track>}
 */
export const addTrack = async (source, details = {}, config = loadConfig()) => {
  const remote = /^https?:\/\//i.test(source)
  const ext = extname(remote ? new URL(source).pathname : source).toLowerCase() || '.mp3'
  if (!AUDIO_EXTENSIONS.includes(ext)) throw new UserError(`${source}: not an audio file (${AUDIO_EXTENSIONS.join(', ')})`)
  if (details.mood && !MOODS.includes(details.mood)) throw new UserError(`mood ${details.mood}? Use ${MOODS.join(', ')}`)
  const name = details.name ?? slug(basename(remote ? new URL(source).pathname : source, ext))
  if (!NAME.test(name)) throw new UserError(`name ${name}: lowercase letters, digits and dashes`)
  mkdirSync(config.musicDir, { recursive: true })
  const tracks = listTracks(config).filter(t => t.name !== name)
  const file = join(config.musicDir, `${name}${ext}`)
  // The new track is in the folder (hidden) before anything there is removed: a failed download or a missing
  // file leaves the track that was there as it was
  const tmp = join(config.musicDir, `.${name}.${process.pid}.tmp`)
  try {
    if (remote) {
      const response = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
      if (!response.ok) throw new UserError(`${source}: ${response.status} ${response.statusText}`)
      const type = response.headers.get('content-type') ?? ''
      if (type && !/^(audio\/|application\/octet-stream|binary\/)/.test(type)) throw new UserError(`${source} is not an audio file (${type.split(';')[0]})`)
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new UserError(`${source}: larger than ${MAX_BYTES / 1024 / 1024} MB`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > MAX_BYTES) throw new UserError(`${source}: larger than ${MAX_BYTES / 1024 / 1024} MB`)
      writeFileSync(tmp, bytes)
    } else {
      if (!existsSync(source) || !statSync(source).isFile()) throw new UserError(`${source}: no such file`)
      copyFileSync(source, tmp)
    }
    // A track already there under that name, in this or another format, is replaced
    for (const f of readdirSync(config.musicDir)) if (!f.startsWith('.') && basename(f, extname(f)) === name) rmSync(join(config.musicDir, f), { force: true })
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  const track = { name, file, ...Object.fromEntries(Object.entries({ ...details, source: remote ? source : undefined, name: undefined }).filter(([, v]) => v)) }
  saveIndex([...tracks, track], config)
  return track
}

/** Removes a track from the music folder; false when there was none by that name */
export const removeTrack = (name, config = loadConfig()) => {
  const tracks = listTracks(config)
  const track = tracks.find(t => t.name === name)
  if (!track) return false
  rmSync(track.file, { force: true })
  saveIndex(tracks.filter(t => t.name !== name), config)
  return true
}
