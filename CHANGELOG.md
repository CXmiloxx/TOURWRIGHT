# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.4.0]

Vertical videos that fill the screen with the app's phone layout, captions that never cover what is being used,
and walkthroughs without long silences on heavy pages.

### Added

- `scale` in a browser script: how big the page is drawn (the page is `width / scale` CSS pixels wide, at that
  density). `scale: 2.75` on a vertical video shows the app as on an iPhone; `scale: 1.5` on Full HD makes
  everything bigger and stays sharp.

### Fixed

- Vertical videos rendered with Xvfb (the Docker image) showed the app's desktop layout, tiny in the middle of the
  screen: `capture: auto` now films them as a screencast at twice the density, the way a phone shows the app.
- Captions wrapped at half the screen width into a tall box of five or six lines that covered the page; they now
  take the width they need (up to 70 %, 88 % on vertical), and move to the top while the element the cursor goes to
  sits under them (an option of a list, a field low on a phone).
- On heavy pages (long lists with hover styles, servers without GPU) each cursor glide could take several seconds
  of silence: it now takes a set time (0.28–0.65 s), with fewer moves when the page is slow.
- Waiting for an element to show up (a search result, a list still loading) is cut from the video once the voice
  has stopped, like a page that loads.

## [2.3.0]

Videos with a studio look, narration that sounds clear and even, a natural voice chosen for each script's language,
`record` that hands you the finished video, translation into other languages, and verified downloads.

### Added

- `theme: { frame: window }`: the recording inside a browser window with rounded corners, a shadow and the title in
  its bar, on a wallpaper of lights in the theme colors.
- A camera that stays close after a zoomed focus and glides to the next element instead of pulling back and
  pushing in again; it never zooms closer than the element fits whole.
- `upload` shows the cursor clicking the drop zone and a drawn file chooser picking the files; `select` clicks the
  list before choosing.
- Vertical videos are filmed the way a phone shows the app (half as wide at twice the density): the app uses its
  mobile layout, big and sharp, and captions sit above the area Reels, Shorts and TikTok cover.
- With no voice chosen, each render picks the most natural voice for the script's `language`: Pocket TTS when
  installed, else Microsoft's neural voices when they answer (Salomé in Spanish, Ava in English), else Piper.
- `tourwright record` writes the script and makes the narrated video at once: the login typed during the tour is
  saved as encrypted secrets, the AI rewrites the narration when one is set up, and the video gets the studio look
  in the app's own main color. `--no-video` writes only the script; `--plain` leaves out the studio look.
- `tourwright translate <script> --to en` (es, en, pt, fr, de, it): the same video in another language, translated
  by your AI; targets and typed text stay, and a line whose variables or marked word changed stays as it was.
- MCP tools `tourwright_jobs` (jobs on the server, with the links of finished videos) and `tourwright_delete_job`.
- The archives `tourwright install` downloads from fixed releases (Piper, uv) are checked against their SHA-256.

### Changed

- `record` now makes the video too; `--no-video` keeps the old behavior.
- The subtitle files are `captions.srt` and `captions.vtt` (`captions-stepN` for a preview), not named after the
  video, and the `.mp4` has no subtitle track: players loaded them over the captions drawn on the video. The
  manifest keeps the keys `files.srt` and `files.vtt`; through the API the files are `captions.srt` and
  `captions.vtt` instead of `video.srt` and `video.vtt`.
- The `default` sound has no room any more (the echo blurred the words), more presence and softer "s"; every preset
  but `none` levels each sentence to -16 LUFS on its own, so no sentence is louder than the next.
- Title cards with a voice hold 0.7 s after it instead of 3.5 s.
- Glass captions, a bigger cursor, smoother focus ring and bubbles.
- The npm package no longer ships `scripts/install.sh` and `install.ps1`, which only work from a clone.
- The demo is Facturero, a billing app with a professional design and a mobile layout, filmed with the new look.

### Fixed

- Two captions on screen in mpv, VLC and Totem (the drawn one and the subtitle track or file).
- A script in English with no voice chosen was spoken by the Spanish Piper voice.

## [2.2.0]

A Docker image whose Redis queue works and whose voice is twice as fast, images tagged with each version, and
MCP tools that say what they touch.

### Added

- Every MCP tool says what it touches (MCP annotations: read-only, opens websites, may replace a file) and every
  parameter has a description, so agents fill them in without guessing and clients know when to ask first.
- The Docker image is tagged with each release (`2.1.0`, `2.1`, `2`) besides `latest`, so a server or a Kubernetes
  deployment can pin a version; the Kubernetes manifest and the deployment guide use `:2`.

### Changed

- The Docker image speaks with `piper-tts` kept loaded, like `tourwright install`, instead of the archived standalone
  Piper: ten sentences take 5 s instead of 9.5 s. Voice samples and the demo video no longer go into the image.

### Fixed

- The 2.1.0 Docker image came without BullMQ, ioredis and the Claude SDK, so its Redis queue (the one
  `docker compose` uses) and `narrate` with Claude did not start. They are installed from the lockfile again.

## [2.1.0]

Faster renders, a progress line, Tourwright for Claude Code and GitHub Actions, a logo and a project page, and a
plain install without the Redis queue or the Claude SDK.

### Added

- A Claude Code plugin: `/plugin marketplace add CXmiloxx/tourwright`, then `/plugin install tourwright@tourwright`
  brings the MCP server and a `make-tour` skill that writes, checks and renders a script.
- A GitHub Action (`uses: CXmiloxx/tourwright@v2`): render the tours on every release, or `command: check` to fail
  the build when a deploy broke one.
- `server.json` and `mcpName`, to list the MCP server in the official MCP Registry.
- `render` shows its progress on one line in a terminal: the stage, the step being filmed and the time so far.
  Jobs of the API report the step too (`progress.step`, `progress.steps`).
- `TOURWRIGHT_TTS_PARALLEL` (default 4): how many narration lines are made at once.
- A logo (a pen nib that is a play button) and web icons in `brand/`, used by the README, the project page and
  the social preview.
- A demo video and GIF in the README, a project page (`site/`, Tailwind CSS) and a social preview image.

### Changed

- Faster renders with a new script: every line a walkthrough says is made ahead, several at once, while the
  browser starts and logs in, instead of one by one during the recording. With an online voice the demo app
  went from 108 s to 74 s. Slides make their narration in parallel too.
- A page still loading after `goto`, `back` or `reload` is cut from the video (unless the voice is speaking),
  and an app that never goes quiet (polling, live events) waits 10 s at most instead of 30 s, on camera.
- The review of the finished video (blank or black screens) runs both passes at once on a small picture:
  about 3× faster.
- The length of each narration is read from its WAV header instead of starting `ffprobe` every time.
- The Redis queue (`bullmq`, `ioredis`) and Claude for `narrate` (`@anthropic-ai/sdk`) are optional peer
  dependencies instead of optional dependencies: a plain install no longer downloads them, so it is lighter,
  and `pnpm add tourwright` finishes without the "Ignored build scripts: msgpackr-extract" error that
  BullMQ's native helper caused. Install them next to Tourwright when you use the queue or Claude; the
  Docker image brings them, at the versions of the lockfile.

## [2.0.0]

A script written by doing the tour, a guide from the same script, narration by your own AI, nothing
downloaded twice, and videos that keep pace with what happens on screen.

### Breaking

- Node.js 22 or newer (Node 20 reached its end of life in April 2026). The install scripts stop on older
  versions with "Tourwright needs Node.js 22 or newer".

### Installing

- `tourwright install` uses what the PC already has before downloading anything: Chrome, Edge or Chromium
  (also a build left by another Playwright or Puppeteer version, and `CHROME_PATH`, `CHROME_BIN`,
  `PUPPETEER_EXECUTABLE_PATH`), ffmpeg from winget, scoop, Chocolatey, Homebrew, MacPorts or Nix, Piper and
  edge-tts installed with pip, pipx, conda or pyenv, Piper voices in the Hugging Face cache or in
  `TOURWRIGHT_PIPER_VOICE_DIRS`, and the system's Python 3.10–3.13. Snap and Flatpak browsers are skipped.
- It shows what it will use and what it will download, with sizes, and asks first in a terminal
  (`--yes` skips the question, `--plan` only shows it). At the end it prints one line; `doctor` has the list.
- Its own Chromium goes into `TOURWRIGHT_HOME/browsers`: a folder other tools share
  (`PLAYWRIGHT_BROWSERS_PATH`, `/opt/ms-playwright`) is only read, never written to.
- Piper is now `piper-tts` 1.8 (OHF-Voice/piper1-gpl; rhasspy/piper is archived), kept loaded during a
  render: about 5× faster per sentence. The standalone build remains for 32-bit ARM and Windows on ARM.
- ffmpeg comes from a release series (9.0) instead of the development branch; the Linux build moved to
  BtbN (johnvansickle.com answered with a web page). A download that returns a web page says so.

### Recording

- `--lock <file>` (`TOURWRIGHT_BROWSER_LOCK`): one browser at a time on the machine. On Linux it is the same
  lock as `flock <file>`, so other tools take turns with Tourwright.
- A browser that does not start in time is started again twice (after 10 s and 30 s).
- Your own defaults: `tourwright config set quality fullhd` (also `voice`, `fps`, `capture`, `pause`, `polish`,
  `preset`…) for every project on the machine, checked before they are saved; `tourwright config` shows each
  value and where it comes from. `TOURWRIGHT_QUALITY`, `TOURWRIGHT_FPS` and `TOURWRIGHT_CAPTURE` do the same.
  The built-in default stays 720p. An unknown `--quality` now says which ones exist.
- Narration and actions keep pace: a `focus` acts as the voice stops (no extra 2 s), its voice starts while
  the cursor travels, and an element already on screen is not waited for. A login on camera went from 22 s
  to 13 s with the same narration.

### Writing and keeping scripts

- `tourwright record <url>`: do the tour by hand in a browser window; each click, field and choice becomes a step
  with a stable target and a first narration that says where the element is ("Abre Clientes en el menú",
  "Para buscar, escribe en…"), a `chapter` per screen, and the user, password and 2FA code of a login as
  `${secret:…}` and `${totp:…}`.
- `tourwright guide <script>`: the same script as a step-by-step guide with a marked screenshot per step — one
  HTML file to send or print, and Markdown with its pictures. Secrets and codes never show.
- `tourwright narrate <script> [--write]`: the narration rewritten from what each screen shows, by the AI the user
  brings — Claude (official SDK, optional), any OpenAI-compatible server, or Ollama on the same PC. Every line is
  checked (the focus word stays, no secrets) and the old script is kept when it is saved.
- `chapter: Name` starts a chapter of the video (and a section of the guide) with nothing on screen.
- `tourwright check <scripts…>`: every script as a dry run, every broken step and its likely fix; exit code 1
  when one broke, `--report` writes Markdown and GitHub Actions gets a job summary.
- `tourwright fix <script> [--write]`: the new target for each broken step (the closest element of the same
  kind, or the only one), written into the YAML keeping its comments. The MCP tool `tourwright_check` does the
  same for agents and returns the fixed script.
- `render --step 7` (or `7-9`): film only those steps with their voice; the steps before run fast off camera.
- `mask`: emails, phones, ID numbers, names or any pattern on screen replaced by invented data, the same for the
  same value. Only what is drawn changes; an editable field keeps its real value.
- Every video is reviewed: page errors, 5xx answers, clicks that changed nothing and blank or black screens are
  printed with their step and saved in the manifest under `review`.
- `examples/app`: a demo app with a 2FA login, personal data, an upload, a long process and a live notice;
  `examples/app.yaml` films it and CI checks and renders it on Linux, macOS and Windows.

### Errors

- A missing element names what was looked for and lists what the page offers, as targets to paste.
- `{ label: … }` finds a field whose label is not linked to it (an input wrapped to add an icon) by its
  placeholder, accessible name or the text before it, and warns with the direct target.
- A dry run waits 5 s per element, goes on to the end and lists every step that failed. The screenshot of a
  failure marks every field, button and link on the page with the target that finds it.
- A value split by an unquoted comma in YAML says how to quote it.

## [1.2.0]

Logins of every kind on video, and title cards that move.

### Logins

- `tourwright explore --login camera`: the draft shows the login in the video, field by field, each with a
  focus that says what goes in it, instead of logging in off camera in `setup`.
- Secrets can be typed on camera: a password field shows dots and any other field is blurred while it holds
  a secret. The warning is now only for a secret in a narration, a caption or anything else in view.
- `${totp:NAME}`: the code of an authenticator app, made from its key the moment it is typed (RFC 6238); a
  code about to expire waits for the next one.
- `tourwright session login <script>`: log in by hand in a browser window (Google or Microsoft accounts, a
  captcha, a code by SMS) and save it as the script's `session`. A render whose session is missing or
  expired, with no `setup` to log in again, stops and says to run it.

### Title cards

- Title cards are animated: `animation` (`rise` word by word, the default; `type` letter by letter with a
  caret; `zoom` into focus; `split` from the sides; `fade`), a `background` (`gradient`, drifting `aurora`
  lights, a moving `grid`, or the `page` itself blurred) and a `kicker` label above the title. They leave
  with a short blur. The theme sets the defaults with `titleAnimation` and `titleBackground`.
- In slides the animation is drawn frame by frame, so it is smooth whatever the machine.
- Bigger, bolder titles.

### Changed

- The voices come calibrated, so `tourwright voices --check` and `install --whisper` are no longer needed:
  both are still accepted and only print a notice. `tourwright clean --whisper` removes Whisper if an earlier
  version installed it.
- A lighter npm package (0.6 MB instead of 3.3 MB): the voice samples are listened to on GitHub, and
  `tourwright voices --open` opens them there when they are not on disk.

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

[1.2.0]: https://github.com/CXmiloxx/tourwright/releases/tag/v1.2.0
[1.1.0]: https://github.com/CXmiloxx/tourwright/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/CXmiloxx/tourwright/releases/tag/v1.0.0
