# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0]

First release.

### Videos

- Browser walkthroughs: a real Chromium driven by Playwright, an animated cursor that moves like a hand,
  click ripples, frames, spotlights, callouts, camera zoom that pans toward the element, blur for personal
  data, title cards and captions with your colors and logo.
- Guided focus (`focus`): the onboarding-style tour step. The page dims except the element, a ring (that
  may pulse) marks it, a bubble with a `3/5` badge explains it, the camera pushes in and it can click at
  the end, all landing on the word marked `{like this}` in the narration.
- Narrated slides: title cards, images with pan and zoom, HTML, crossfades.
- Actions: `goto`, `back`, `reload`, `click`, `dblclick`, `rightClick`, `hover`, `check`, `uncheck`,
  `drag`, `type`, `fill`, `press`, `select`, `upload`, `scroll`, `scrollTo`, `cursor`, `wait`, `pause`,
  `offCamera`, `sound` and the visual ones above.
- Automatic editing: page loads, off-camera steps, waits and voice synthesis are cut, so the video has no
  dead time; a narration never overlaps the previous one.
- Deliverables: H.264/AAC `.mp4` (48 kHz audio) with soft subtitles and chapters, `.srt`, `.vtt`, a `.jpg`
  thumbnail and a `.json` manifest. Qualities `sd`, `hd`, `fullhd`, `vertical` and `square`.
- Capture on a virtual display (Xvfb, the sharpest) or headless screencast, which runs anywhere.
- `baseUrl` may be a folder next to a local script: pages without a server.

### Voice and audio

- TTS engines: Piper (offline, default), Microsoft Edge voices, any OpenAI-compatible server and a custom
  command. Every sentence is cached, so re-renders never synthesize it again.
- A cast of voices per script (`voices`) and per line `voice`, `rate`, `pitch`, `volume` and `style`, on
  every engine.
- Exact pauses inside the text (`[[800ms]]`, `[[1.5s]]`) and a pronunciation dictionary (`pronounce`).
- Polish presets (`audio.polish`: `default`, `clean`, `warm`, `radio`, `podcast`, `none`).
- Background music with fade in and out that lowers itself under the voice; sound effects (`sound`,
  automatic click and typing sounds) with built-in `click`, `pop`, `ding` and `whoosh`.

### Scripts

- Declarative YAML or JSON with a JSON Schema for editors and agents, or JavaScript modules.
- Variables (`vars`, `{{name}}`, `--var` and `vars` in API and MCP requests), reusable `blocks` + `use`,
  `repeat`, `if` and `try`.
- Robust targets by role and name, label, placeholder, text or test id.
- Saved sessions: log in off camera once and reuse it.
- Plugins add step actions, TTS engines and voices.

### Running it

- Four ways in: CLI, HTTP API with webhooks and signed download links, MCP server for AI agents, Node
  library.
- Job queue in a local folder or Redis/BullMQ; storage in a local folder or S3-compatible buckets. Each
  render runs in its own process and failed renders are retried; API and workers scale independently.
- Sandbox for API jobs: declarative scripts only, files kept inside the job folder, host allowlist and
  private-network blocking, secrets off by default, one tenant per token. Errors carry a stable `code`.
- Linux, macOS and Windows. `tourwright install` (or `scripts/install.sh`, `scripts/install.ps1`) sets up
  ffmpeg, Piper, voices, edge-tts and Chromium without root and without touching the system: everything
  lives in one folder, with Python packages in a virtual environment that brings its own Python (uv), so no
  Python is needed. A Docker image for linux/amd64 and linux/arm64; `tourwright doctor` checks a machine.
- Quality checks: lint (Biome), types (JSDoc checked by `tsc`), tests and a real render on the three
  systems in CI.

[1.0.0]: https://github.com/CXmiloxx/tourwright/releases/tag/v1.0.0
