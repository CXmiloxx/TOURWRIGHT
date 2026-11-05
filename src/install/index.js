// `tourwright install`: what Tourwright needs to render, without root and without Docker, on Linux, macOS and
// Windows. Everything goes into TOURWRIGHT_HOME (bin/, piper/, python/, venv/, voices/) and nothing is
// installed on the system: deleting that folder removes it all. What the system already has (an ffmpeg in
// PATH, a piper, an edge-tts) is used as it is.
//
//   ffmpeg    static build: Linux (x64, arm64) and Windows (x64, arm64). macOS: Homebrew.
//   Piper     the piper-tts Python package (OHF-Voice/piper1-gpl, PIPER_TTS), kept loaded during a render.
//             Where it has no build (32-bit ARM, Windows on ARM) or Python cannot be set up: the last
//             standalone release of rhasspy/piper (archived; the same voices).
//   edge-tts  Python package.
//   Python    Python packages live in a virtual environment (TOURWRIGHT_HOME/venv) made by uv. It uses the
//             system's Python when it is 3.10–3.13 (never changing it) and downloads 3.12 into
//             TOURWRIGHT_HOME/python only when there is none. Without uv (no build for the platform,
//             offline) the system's Python makes the environment instead.
//   Chromium  a Chrome, Edge or Chromium already on the system; Playwright's build only when there is none.
//
// One concern per module: sources.js (pinned URLs and hashes), download.js, python.js (the virtual environment),
// parts.js (each part), plan.js (the plan and installAll).
export { DEFAULT_VOICES, SHA256 } from './sources.js'
export { download } from './download.js'
export { installVoice } from './parts.js'
export { planInstall, installAll } from './plan.js'
