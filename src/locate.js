// Where a PC keeps programs that are not always in PATH (a service, cron or an IDE often starts with a short
// PATH): pip --user, pipx, uv tool, conda, pyenv, the Microsoft Store Python, winget, scoop, Chocolatey,
// Homebrew, Linuxbrew, MacPorts, Nix. Tourwright looks there before downloading anything of its own.
// Snap programs are left out: their sandbox cannot read Tourwright's work files.
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isWindows } from './util.js'

// Folders under `base` that match each segment in turn; a segment ending in `*` is a name prefix
const matching = (base, ...segments) => {
  let dirs = base ? [base] : []
  for (const segment of segments) {
    const next = []
    for (const dir of dirs) {
      if (!segment.endsWith('*')) {
        next.push(join(dir, segment))
        continue
      }
      const prefix = segment.slice(0, -1).toLowerCase()
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && e.name.toLowerCase().startsWith(prefix)) next.push(join(dir, e.name))
      } catch {}
    }
    dirs = next
  }
  // The newest version first (Python313 before Python311)
  return dirs.filter(d => existsSync(d)).sort().reverse()
}

const CONDA = ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge']

let cached

/** Folders with programs that may be missing from PATH, most likely first, without repeats */
export const extraBinDirs = () => {
  if (cached) return cached
  const env = process.env
  const home = homedir()
  let dirs
  if (isWindows) {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const drive = join(env.SystemDrive ?? 'C:', '/')
    dirs = [
      // Python: pip --user, python.org (per user and for everyone), Microsoft Store, pipx / uv tool, conda, pyenv
      ...matching(env.APPDATA, 'Python', 'Python3*', 'Scripts'),
      ...matching(local, 'Programs', 'Python', 'Python3*', 'Scripts'),
      ...matching(env.ProgramFiles, 'Python3*', 'Scripts'),
      ...matching(local, 'Packages', 'PythonSoftwareFoundation.Python.3*', 'LocalCache', 'local-packages', 'Python3*', 'Scripts'),
      ...matching(home, '.local', 'bin'),
      ...CONDA.flatMap(d => [...matching(home, d, 'Scripts'), ...matching(env.ProgramData, d, 'Scripts')]),
      ...matching(home, '.pyenv', 'pyenv-win', 'shims'),
      // ffmpeg and others: winget, scoop, Chocolatey, folders people unzip it to
      ...matching(local, 'Microsoft', 'WinGet', 'Links'),
      ...matching(local, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg*', 'ffmpeg-*', 'bin'),
      ...matching(local, 'Microsoft', 'WinGet', 'Packages', 'BtbN.FFmpeg*', 'ffmpeg-*', 'bin'),
      ...matching(home, 'scoop', 'shims'),
      ...matching(env.ProgramData, 'chocolatey', 'bin'),
      ...matching(env.ProgramFiles, 'ffmpeg', 'bin'),
      ...matching(drive, 'ffmpeg', 'bin'),
      ...matching(drive, 'tools', 'ffmpeg*', 'bin'),
    ]
  } else {
    dirs = [
      ...matching(home, '.local', 'bin'),
      ...(process.platform === 'darwin' ? matching(home, 'Library', 'Python', '3*', 'bin') : []),
      ...CONDA.flatMap(d => [...matching(home, d, 'bin'), ...matching('/opt', d, 'bin')]),
      ...matching(home, '.pyenv', 'shims'),
      ...matching('/opt/homebrew', 'bin'),
      ...matching('/home/linuxbrew/.linuxbrew', 'bin'),
      ...matching(home, '.linuxbrew', 'bin'),
      ...matching('/opt/local', 'bin'),
      ...matching(home, '.nix-profile', 'bin'),
      ...matching('/run/current-system/sw', 'bin'),
      ...matching('/usr/local', 'bin'),
      ...matching('/usr', 'bin'),
    ]
  }
  cached = [...new Set(dirs)]
  return cached
}

/** `name` in every folder of extraBinDirs(), for findBinary */
export const elsewhere = name => extraBinDirs().map(d => join(d, name))
