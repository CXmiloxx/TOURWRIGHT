# Working on Tourwright (for coding agents and contributors)

Using Tourwright from an agent (MCP tools, script format) is in [docs/AGENTS.md](docs/AGENTS.md). This file is
about changing Tourwright itself.

## Map

| Path | What |
|---|---|
| `bin/tourwright.js`, `src/cli.js` | CLI |
| `src/config.js` | Every setting: defaults < the user's `config.json` < `tourwright.config.json` < `TOURWRIGHT_*` env |
| `src/settings.js` | `tourwright config`: each person's defaults (quality, voice, fps, AI…), checked before saved |
| `src/install.js` | `tourwright install`: what the PC already has first (`locate.js`: folders outside PATH), then ffmpeg, Piper, voices, edge-tts, Chromium per OS and CPU |
| `src/lock.js` | `--lock`: one browser at a time on the machine (`flock` on Linux) |
| `src/script/` | Script formats: `schema.js` (zod, declarative), `expand.js` (vars, blocks, repeat), `load.js` (files, JS modules, secrets) |
| `src/render/` | `browser.js` (walkthroughs: recording and the `v` helpers), `steps.js` (step interpreter, `if`/`try`), `targets.js` (finding elements, fallbacks, errors that list what the page offers), `chromium.js` (which browser: configured, Playwright's, the system's), `mask.js` (invented data on screen), `review.js` (what went wrong on the page and in the video), `session.js` (off-camera login, saved sessions), `cursor.js`, `visuals.js` (title cards, captions, frames, callouts, zoom), `slides.js`, `capture.js` (Xvfb / screencast), `network.js` (sandbox, host remapping), `overlay.js` + `theme.js` (styles of what Tourwright draws) |
| `src/voice/` | TTS engines, prosody, pauses, pronunciation, polish presets and the sentence cache; `effects.js` (built-in sounds); `piper_voice.py` (Piper kept loaded); `piper-voices.js` (voices already on the PC) |
| `src/record.js` | `tourwright record`: the tour done by hand becomes a script with a first narration |
| `src/guide.js` | `tourwright guide`: the script as a step-by-step guide with screenshots |
| `src/narrate.js`, `src/ai.js` | `tourwright narrate`: the narration rewritten by the AI the user brings (Claude via the official SDK, OpenAI-compatible, Ollama) |
| `src/repair.js` | `tourwright check` / `fix`: broken steps across scripts and the likely new target |
| `src/plugins.js` | Loads plugins: extra step actions, TTS engines, voices |
| `src/compose.js`, `src/timeline.js` | Raw recording → final mp4 (cuts, audio mix, subtitles, chapters) |
| `src/jobs/` | Job records + queue (`store.js`: local folder / Redis), files (`blobs.js`: local / S3), signed links |
| `src/worker.js`, `src/run-job.js` | Queue consumer; each render in its own process |
| `src/server/http.js` | HTTP API |
| `examples/app/` | A demo app with no dependencies (2FA login, personal data, upload, long process, live notice) that CI films |
| `src/mcp.js` | MCP server |
| `server.json`, `glama.json` | The MCP server's entry in the official MCP Registry (version and `mcpName` in `package.json` must match); `glama.json` names the maintainers on Glama |
| `.claude-plugin/`, `claude-plugin/` | Claude Code marketplace and plugin: the MCP server and the `make-tour` skill |
| `.github/workflows/image.yml` | The Docker image: `latest` from `main`, `X.Y.Z`, `X.Y` and `X` for each release tag |
| `action.yml` | The GitHub Action (`uses: CXmiloxx/tourwright@v2`): render or check scripts in CI |
| `site/`, `docs/demo/` | The project page (GitHub Pages, `pages.yml`; Tailwind v4 in `site/src/styles.css`, built with `npm run build` inside `site/`, its own `package.json`) and the demo video, GIF and social preview |
| `brand/` | The logo (light and dark) and the web icons: use these files, never redraw the mark |

## Rules

- Plain Node.js ESM, no build step, Node 22+. Types are JSDoc checked by `tsc` (`jsconfig.json`); page globals in `src/globals.d.ts`;
  script types come from the zod schema (`z.infer`), never written by hand. Few dependencies: Playwright, yaml, zod, the MCP SDK;
  BullMQ/ioredis are optional. Speak S3 and HTTP with the standard library.
- No machine-specific paths: everything comes from `loadConfig()`.
- Linux, macOS and Windows: build paths with `node:path`, check containment with `isInside`, find programs
  with `findBinary`/`which` (they add `.exe`), write ffmpeg concat lists with `concatEntry`, and never
  depend on a Unix shell, signals or tools (`sh`, `diff`, `kill -INT`) outside Linux-only code like Xvfb.
- Anything reachable from the API/MCP is untrusted: validate with zod, keep paths inside the job folder,
  route browser traffic through the guard, never build shell lines from input.
- Errors the user can fix are `UserError(message, { status, code })`: never retried, shown as is, and the API
  answers `{ error, code }` with that status.
- Logs go to stderr (`log.*`); stdout is for machine output (`--json`, MCP stdio).
- A new step action: add it to `STEPS` in `src/script/schema.js`, to `runSteps` in `src/render/browser.js`
  (and a no-op or plain version in `plainHelpers` for `setup`), to `docs/SCRIPTS.md`, then `npm run schema`.
  If it holds steps, also to `expandNested` in `src/script/expand.js` and `nested` in `jsonSchema()`.
  Niche actions belong in a plugin ([docs/PLUGINS.md](docs/PLUGINS.md)).
- Prosody (`rate`, `pitch`, `volume`) must work on every engine: list in `native` what an engine does itself;
  `prosodyFilter` does the rest with ffmpeg.

## Checks

```bash
npm run check  # lint (Biome) + types (tsc on JSDoc) + tests + schema in sync
npm test       # unit tests only; the audio mix test runs when ffmpeg is there
node bin/tourwright.js doctor
node bin/tourwright.js render examples/slides.yaml --out /tmp/out/
node bin/tourwright.js render examples/example-com.yaml --dry-run
```
