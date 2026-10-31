# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- `explore` on a site by IP (`http://127.0.0.1:…`) or with a host that starts with a digit named its secrets
  `_127_USER`, which is not a valid name: they are `SITE_127_USER` now.
- `explore` no longer lists a site's home twice when its menu links to `/index.html` and the home is `/`.

## [1.1.0]

From a site to a video with only the script: Tourwright now explores the site, keeps the credentials out
of the script, and speaks with natural voices that say tech words right.

### Scripts

- `tourwright explore <url|script>`: finds the login form (asks for the credentials without showing them),
  logs in off camera, visits every section of the site's menu and lists each page's title, description and
  targets, with a screenshot (table rows blurred). `--draft` writes a working script: the login in `setup`,
  one narrated stop per section and numbered focuses on the key filters and buttons.
- `dismiss`: things the app opens on its own (its product tour, a cookie banner) are closed off camera
  whenever they show up. `explore` detects them and adds them to the draft.

### Credentials and sessions

- `tourwright secret set|list|delete`: credentials asked for without echo, kept in
  `TOURWRIGHT_HOME/secrets.json` (owner only) and used as `${secret:NAME}`. `TOURWRIGHT_SECRET_*` still works
  and wins. Secret values are replaced with `•••` in every log and error.
- Missing secrets are all named at once with the command that saves each; `validate` checks them and warns
  when one is used on camera.
- `tourwright session list|delete`, `render --fresh` and `tourwright forget` (every secret and session). A
  login in `setup` that does not get past the login page stops the render with a clear message.

### Output

- Each video in its own folder: `videos/<name>/`.
- `export` (script) or `--export` (CLI): `video`, `audio` (.mp3) and `silent` (the video without sound).
- `render --open` opens the video; the render ends listing every file it wrote.

### Voices

- Pocket TTS engine (`pocket:`): natural offline voices on the CPU, `lola` in Spanish and `alba`, `jane`,
  `mary`, `michael`, `george` in English. `tourwright install --pocket`; the default voice once installed.
- New Edge and Piper voices in English: `jenny`, `guy`, `sonia`, `ryan`.
- Narration said the way people say it, in the voice's language: acronyms spelled with that language's
  letter names, numbers in words that agree with what they count, amounts in pesos, emails dictated, long
  ids digit by digit. Captions keep what is written.
- Calibrated per engine (`src/voice/calibrated.json`): each term was said written several ways and Whisper
  picked the one understood best.
- `tourwright voices` groups voices by language; a sample of each voice comes in `docs/voices/es` and
  `docs/voices/en`; `voices --samples` records them again; `voices --check` (with `install --whisper`) lists
  the words a voice gets wrong.

### Install and disk

- `tourwright clean`: what each part takes on disk; removes downloads and leftovers, and with
  `--voice-cache`, `--pocket` or `--whisper` the voice cache, Pocket TTS or Whisper with their models.
- `tourwright install` removes what it downloaded once the packages are installed.

### Fixed

- `--help` works on every command, and a mistyped option gives a short message instead of a stack trace.
- The summary after `tourwright install` shows what was just installed.
- Edge voices retry when the service returns no audio.
- The composition test reads ffprobe's output on Windows (`\r\n` line endings).

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
