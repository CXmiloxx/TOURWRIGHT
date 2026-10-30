# Working on Tourwright (for coding agents and contributors)

Using Tourwright from an agent (MCP tools, script format) is in [docs/AGENTS.md](docs/AGENTS.md). This file is
about changing Tourwright itself.

## Map

| Path | What |
|---|---|
| `bin/tourwright.js`, `src/cli.js` | CLI |
| `src/config.js` | Every setting: defaults < `tourwright.config.json` < `TOURWRIGHT_*` env |
| `src/install.js` | `tourwright install`: ffmpeg, Piper, voices, edge-tts, Chromium per OS and CPU |
| `src/script/` | Script formats: `schema.js` (zod, declarative), `expand.js` (vars, blocks, repeat), `load.js` (files, JS modules, secrets) |
| `src/render/` | `browser.js` (walkthroughs: recording and the `v` helpers), `steps.js` (step interpreter, `if`/`try`, targets), `session.js` (off-camera login, saved sessions), `cursor.js`, `visuals.js` (title cards, captions, frames, callouts, zoom), `slides.js`, `capture.js` (Xvfb / screencast), `network.js` (sandbox, host remapping), `overlay.js` + `theme.js` (styles of what Tourwright draws) |
| `src/voice/` | TTS engines, prosody, pauses, pronunciation, polish presets and the sentence cache; `effects.js` (built-in sounds) |
| `src/plugins.js` | Loads plugins: extra step actions, TTS engines, voices |
| `src/compose.js`, `src/timeline.js` | Raw recording → final mp4 (cuts, audio mix, subtitles, chapters) |
| `src/jobs/` | Job records + queue (`store.js`: local folder / Redis), files (`blobs.js`: local / S3), signed links |
| `src/worker.js`, `src/run-job.js` | Queue consumer; each render in its own process |
| `src/server/http.js` | HTTP API |
| `src/mcp.js` | MCP server |

## Rules

- Plain Node.js ESM, no build step, Node 20+. Types are JSDoc checked by `tsc` (`jsconfig.json`); page globals in `src/globals.d.ts`;
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
