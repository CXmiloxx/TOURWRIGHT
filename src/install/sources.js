// Where each part is downloaded from, pinned: versions, URLs and the SHA-256 of every archive.
import { isWindows } from '#core/util.js'

export const DEFAULT_VOICES = ['es_MX-claude-high', 'en_US-lessac-medium']
export const PIPER_VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'
// Pinned: a new piper-tts is tried (speed, sound) before it is used
export const PIPER_TTS = 'piper-tts==1.8.0'
// Platforms with a piper-tts build
export const PIPER_WHEELS = new Set(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'])
export const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2'
const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
// A release series, not the development branch: "-latest" brings its bug fixes, never a new major version
export const FFMPEG_SERIES = '9.0'
const btbn = target => `${BTBN}/ffmpeg-n${FFMPEG_SERIES}-latest-${target}-gpl-${FFMPEG_SERIES}.${target.startsWith('win') ? 'zip' : 'tar.xz'}`
// A fixed uv release: every install gets the same one
export const UV_RELEASE = 'https://github.com/astral-sh/uv/releases/download/0.13.6'
// Any of these the system has is used; without one, uv downloads PYTHON_VERSION (every package has wheels for it)
export const PYTHONS = '>=3.10,<3.14'
export const PYTHON_VERSION = '3.12'

// Keyed by `${process.platform}-${process.arch}`
export const FFMPEG = {
  // Static builds: they run on any distribution (no 32-bit ARM build: apt install ffmpeg on a Raspberry Pi)
  'linux-x64': btbn('linux64'),
  'linux-arm64': btbn('linuxarm64'),
  'win32-x64': btbn('win64'),
  'win32-arm64': btbn('winarm64'),
}
export const PIPER = {
  'linux-x64': 'piper_linux_x86_64.tar.gz',
  'linux-arm64': 'piper_linux_aarch64.tar.gz',
  'linux-arm': 'piper_linux_armv7l.tar.gz',
  'win32-x64': 'piper_windows_amd64.zip',
  // Windows on ARM runs the x64 build under emulation
  'win32-arm64': 'piper_windows_amd64.zip',
}

export const UV = {
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'linux-arm': 'uv-armv7-unknown-linux-gnueabihf.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
}

// SHA-256 of every archive from a fixed release: a file that changed upstream (a replaced or tampered asset)
// is refused instead of run. uv: its release's sha256.sum. Piper publishes none: hashed from the release
// assets when PIPER_RELEASE was pinned. A new release pinned above needs its hashes here too.
export const SHA256 = {
  [`${PIPER_RELEASE}/piper_linux_x86_64.tar.gz`]: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992',
  [`${PIPER_RELEASE}/piper_linux_aarch64.tar.gz`]: 'fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb',
  [`${PIPER_RELEASE}/piper_linux_armv7l.tar.gz`]: 'c6946fcd57c705ed1d4666ea880f80ba0bbbd14de62ecbdd13460baf3bac8e37',
  [`${PIPER_RELEASE}/piper_windows_amd64.zip`]: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  [`${UV_RELEASE}/uv-x86_64-unknown-linux-gnu.tar.gz`]: 'f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645',
  [`${UV_RELEASE}/uv-aarch64-unknown-linux-gnu.tar.gz`]: '229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d',
  [`${UV_RELEASE}/uv-armv7-unknown-linux-gnueabihf.tar.gz`]: 'd00cd4949c4524c934afcfee1aedfa9d337cf4e43be4d6b692ad8d74d0a65562',
  [`${UV_RELEASE}/uv-x86_64-apple-darwin.tar.gz`]: '63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02',
  [`${UV_RELEASE}/uv-aarch64-apple-darwin.tar.gz`]: '60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472',
  [`${UV_RELEASE}/uv-x86_64-pc-windows-msvc.zip`]: 'a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f',
  [`${UV_RELEASE}/uv-aarch64-pc-windows-msvc.zip`]: 'c2426c0c8e28b53d8c440e47a18d96ad4db51e159866c0e81435b196d7f0081c',
}

export const exe = name => (isWindows ? `${name}.exe` : name)
