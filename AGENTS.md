# Working on Tourwright (for coding agents and contributors)

Using Tourwright from an agent (MCP tools, script format) is in [docs/AGENTS.md](docs/AGENTS.md). This file is
about changing Tourwright itself.

## Architecture

`src/` is split by domain. Each domain is a folder with an alias in `package.json` (`imports`), and a domain
imports only from the ones below it:

```text
cli, server          entry points: everything below
authoring            explore, record, check/fix (repair)       → ai, render, script, video, voice, core
ai, install          the user's AI; tourwright install          → render, script, video, voice, core
render               the browser and what it films             → plugins, script, video, voice, core
plugins              extra steps, engines and voices           → script, voice, core
video                ffmpeg: compose, loudness, review         → voice, core
script, voice        script formats; text-to-speech            → core
core                 config, util, secrets, locks, paths       → nothing
```

| Path | What |
|---|---|
| `bin/tourwright.js` | Calls `#cli/index.js` |
| `src/index.js` | The library API (`import { render } from 'tourwright'`) |
| `src/core/` | `config.js` (every setting: defaults < the user's `config.json` < `tourwright.config.json` < `TOURWRIGHT_*` env), `util.js`, `secrets.js`, `lock.js` (`--lock`: one browser at a time), `locate.js` (programs outside PATH), `paths.js` (the package root, its docs and version) |
| `src/script/` | Script formats: `schema.js` (zod, declarative), `expand.js` (vars, blocks, repeat), `load.js` (files, JS modules, secrets), `mask-rule.js` |
| `src/voice/` | Text-to-speech: `voices.js` (which voice, aliases, auto), `text.js` (pauses, marks, pronunciation), `sound.js` (polish presets, prosody filters), `narrate.js` (synthesis and sentence cache), `samples.js` (listing, samples), `engines.js`, `lexicon.js`, `effects.js` (built-in sounds), `python.js` (the Python helpers' processes), `piper_voice.py` (Piper kept loaded), `pocket.py`, `piper-voices.js`, `calibrated.json` (loudness per voice) |
| `src/video/` | ffmpeg: `compose.js` (raw recording → mp4: cuts, mix, subtitles, chapters), `loudness.js` (each sentence leveled, true-peak limiter), `timeline.js`, `frame-filter.js`, `review.js` (blank screens, silence, loudness, clipping), `recompose.js` (`--keep` and `tourwright recompose`), `ffmpeg.js` (running ffmpeg), `quality.js` (encoding presets) |
| `src/plugins/` | Loads plugins: extra step actions, TTS engines, voices |
| `src/render/` | `index.js` (one entry for every kind of video), `slides.js` |
| `src/render/walkthrough/` | A filmed walkthrough, one stage per module: `index.js` (runs them in order), `plan.js` (size, device, voice, capture; `DEVICES`), `studio.js` (browser, off-camera login, dressed page, recording), `clock.js` (captions, chapters, cuts, narration, effects), `stage.js` (what every filmed step shares), `helpers/` (the `v` helpers: `navigation`, `narration`, `pointer`, `camera`), `deliver.js` (compose, review, `--keep`) |
| `src/render/steps/` | `index.js` (step interpreter, `if`/`try`), `targets.js` (finding elements: exact and visible first, `mask`, errors that list what the page offers), `lists.js` (lists that are not a `<select>`), `quick.js` (the quick helpers for `setup`) |
| `src/render/browser/` | `chromium.js` (which browser), `launch.js`, `capture.js` (Xvfb / screencast), `network.js` (sandbox, host remapping), `guard-proxy.js` (the strict sandbox: every connection checked, redirects and WebSockets too), `session.js` (off-camera login, saved sessions) |
| `src/render/page/` | What Tourwright draws or watches on the page: `visuals.js`, `cursor.js`, `overlay.js` + `theme.js`, `frame.js`, `mask.js`, `review.js` (page errors, clicks without effect, layout) |
| `src/render/guide/` | `tourwright guide`: `collect.js` (a picture of each step), `write.js` (HTML and Markdown) |
| `src/ai/` | The AI the user brings: `client.js` (Claude via the official SDK, OpenAI-compatible, Ollama), `narrate.js`, `translate.js` |
| `src/authoring/` | Writing scripts: `explore/` (a site's sections and targets, `--draft`), `record/` (a tour done by hand becomes a script), `repair.js` (`check` / `fix`) |
| `src/install/` | `tourwright install`: `plan.js`, `parts.js` (ffmpeg, Piper, voices, edge-tts, Chromium), `python.js` (the venv), `download.js`, `sources.js` (pinned URLs and hashes), `clean.js` |
| `src/server/` | `http.js` (HTTP API), `mcp.js` (MCP server), `worker.js` + `run-job.js` (queue consumer; each render in its own process), `jobs/` (`service.js` jobs and queue, `store.js` records, `blobs.js` files on disk or S3, `links.js` signed links) |
| `src/cli/` | `index.js` reads the options (`args.js`) and hands each command to its group in `commands/` (`videos`, `sites`, `voices`, `machine`); `help.js`, `doctor.js`, `progress.js`, `settings.js` (`tourwright config`) |
| `scripts/check-architecture.js` | The rules below that a machine can check, run by `npm run check` |
| `examples/app/` | A demo app with no dependencies (2FA login, personal data, upload, long process, live notice) that CI films |
| `server.json`, `glama.json` | The MCP server's entry in the official MCP Registry (version and `mcpName` in `package.json` must match); `glama.json` names the maintainers on Glama |
| `.claude-plugin/`, `claude-plugin/` | Claude Code marketplace and plugin: the MCP server and the `make-tour` skill |
| `.github/workflows/image.yml` | The Docker image: `latest` from `main`, `X.Y.Z`, `X.Y` and `X` for each release tag |
| `.github/workflows/release.yml` | A release from one tag `vX.Y.Z`: npm (Trusted Publishing), the MCP Registry, the GitHub release and the `v2` tag |
| `action.yml` | The GitHub Action (`uses: CXmiloxx/tourwright@v2`): render or check scripts in CI |
| `site/`, `docs/demo/` | The project page (GitHub Pages, `pages.yml`; Tailwind v4 in `site/src/styles.css`, built with `npm run build` inside `site/`, its own `package.json`) and the demo video, GIF and social preview |
| `brand/` | The logo (light and dark) and the web icons: use these files, never redraw the mark |

## Where new code goes

| Adding… | Goes in |
|---|---|
| A step action | `script/schema.js` + `render/steps/index.js` + a helper in `render/walkthrough/helpers/` (see Rules) |
| How an element is found | `render/steps/targets.js` |
| Something drawn on or read from the page | `render/page/` (one file per thing) |
| Browser start, capture, network, login | `render/browser/` |
| A stage of a filmed video (before/after the steps) | `render/walkthrough/` |
| A new kind of video | `render/<kind>.js`, dispatched from `render/index.js` |
| ffmpeg work on a finished file (mix, filters, checks) | `video/` |
| A voice, engine, text rule or sound | `voice/` (an engine others may not want: a plugin) |
| A script option or format rule | `script/` (zod in `schema.js`, then `npm run schema`) |
| A CLI command | its group in `cli/commands/`, its flags in `cli/args.js`, its text in `cli/help.js` |
| An API or MCP tool | `server/http.js`, `server/mcp.js`; job options in `server/jobs/service.js` |
| A setting | `core/config.js` (default + `TOURWRIGHT_*` env) |
| A helper used by several domains | the lowest domain that needs it; `core/util.js` only if truly generic |
| Something `tourwright install` fetches | `install/parts.js`, pinned in `install/sources.js` |

A new folder or domain: add its alias to `imports` in `package.json` and its place to `LAYERS` in
`scripts/check-architecture.js` (a test checks both match), and a row to the map above.

## Rules

Checked by `npm run check` (`scripts/check-architecture.js`):

- A module has at most **400 lines**. Past that it holds more than one concern: split it by concern into a
  folder (see `render/walkthrough/`, `voice/`, `install/`), with an `index.js` only when others need one entry.
- Every module starts with a comment that says what it is for. File names are kebab-case.
- Imports are relative only inside a module's own folder (`./x.js`, `./sub/x.js`), never `../`. Anything else
  goes through an alias: `#core/util.js`, `#render/steps/targets.js`. A file can then move without touching
  the files that use it.
- A domain imports only from the domains below it (the diagram above, `LAYERS` in the script). A function
  needed by a lower domain moves down (a zod rule to `script`, an ffmpeg filter to `video`), never the import up.
- Shared state goes through an explicit object (`stage`, `clock`), not closures over a long function.

By hand:

- Plain Node.js ESM, no build step, Node 22+. Types are JSDoc checked by `tsc` (`jsconfig.json`); page globals in `src/globals.d.ts`;
  script types come from the zod schema (`z.infer`), never written by hand. Few dependencies: Playwright, yaml, zod, the MCP SDK;
  BullMQ/ioredis are optional. Speak S3 and HTTP with the standard library.
- No machine-specific paths: everything comes from `loadConfig()`; the package's own files from `#core/paths.js`.
- Linux, macOS and Windows: build paths with `node:path`, check containment with `isInside`, find programs
  with `findBinary`/`which` (they add `.exe`), write ffmpeg concat lists with `concatEntry`, and never
  depend on a Unix shell, signals or tools (`sh`, `diff`, `kill -INT`) outside Linux-only code like Xvfb.
- Anything reachable from the API/MCP is untrusted: validate with zod, keep paths inside the job folder,
  route browser traffic through the guard, never build shell lines from input.
- Errors the user can fix are `UserError(message, { status, code })`: never retried, shown as is, and the API
  answers `{ error, code }` with that status.
- Logs go to stderr (`log.*`); stdout is for machine output (`--json`, MCP stdio).
- A new step action: add it to `STEPS` in `src/script/schema.js`, to `runStep` in `src/render/steps/index.js`, its
  filmed helper to the group it belongs to in `src/render/walkthrough/helpers/` (and a plain version in
  `plainHelpers`, `src/render/steps/quick.js`, for `setup`), to `docs/SCRIPTS.md`, then `npm run schema`.
  If it holds steps, also to `expandNested` in `src/script/expand.js` and `nested` in `jsonSchema()`.
  Niche actions belong in a plugin ([docs/PLUGINS.md](docs/PLUGINS.md)).
- Prosody (`rate`, `pitch`, `volume`) must work on every engine: list in `native` what an engine does itself;
  `prosodyFilter` does the rest with ffmpeg.

## Checks

```bash
npm run check  # lint (Biome) + types (tsc on JSDoc) + architecture + tests + schema in sync
npm test       # unit tests only; the audio mix test runs when ffmpeg is there
node bin/tourwright.js doctor
node bin/tourwright.js render examples/slides.yaml --out /tmp/out/
node bin/tourwright.js render examples/example-com.yaml --dry-run
```
