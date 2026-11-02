// Piper voices already on the PC: Tourwright's folder, the folders in TOURWRIGHT_PIPER_VOICE_DIRS, and the
// Hugging Face cache (where piper-tts and huggingface_hub keep rhasspy/piper-voices). A voice counts only
// with its .onnx.json next to it: Piper needs both.
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const usable = file => existsSync(file) && existsSync(`${file}.json`)

const hfSnapshots = () => {
  const env = process.env
  const hub = env.HF_HUB_CACHE ?? (env.HF_HOME ? join(env.HF_HOME, 'hub') : join(homedir(), '.cache', 'huggingface', 'hub'))
  const snapshots = join(hub, 'models--rhasspy--piper-voices', 'snapshots')
  try {
    return readdirSync(snapshots).map(s => join(snapshots, s))
  } catch {
    return []
  }
}

// In the Hugging Face repo a voice lives at es/es_MX/claude/high/es_MX-claude-high.onnx
const hfPath = id => {
  const m = /^([a-z]{2,3})_([A-Z]{2})-(\w+)-(x_low|low|medium|high)$/.exec(id)
  return m ? join(m[1], `${m[1]}_${m[2]}`, m[3], m[4], `${id}.onnx`) : null
}

/** Folders searched for voices, Tourwright's own first */
export const voiceDirs = config => [config.tts.piper.voicesDir, ...(config.tts.piper.extraVoiceDirs ?? [])]

/** The .onnx of voice `id` wherever it is on the PC, or null */
export const findPiperVoice = (config, id) => {
  for (const dir of voiceDirs(config)) {
    const file = join(dir, `${id}.onnx`)
    if (usable(file)) return file
  }
  const rel = hfPath(id)
  if (rel) {
    for (const snapshot of hfSnapshots()) {
      const file = join(snapshot, rel)
      if (usable(file)) return file
    }
  }
  return null
}

/** Ids of every voice found, without repeats */
export const installedPiperVoices = config => {
  const ids = new Set()
  for (const dir of voiceDirs(config)) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith('.onnx') && usable(join(dir, f))) ids.add(f.slice(0, -5))
    } catch {}
  }
  for (const snapshot of hfSnapshots()) {
    try {
      for (const e of readdirSync(snapshot, { recursive: true, withFileTypes: true })) {
        const file = join(e.parentPath ?? e.path, e.name)
        if (e.name.endsWith('.onnx') && usable(file)) ids.add(basename(e.name, '.onnx'))
      }
    } catch {}
  }
  return [...ids]
}
