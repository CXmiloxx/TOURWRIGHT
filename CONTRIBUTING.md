# Contributing

Issues and pull requests are welcome — bugs, voices, new step actions, renderers, deployment recipes,
translations of the docs. Questions go to [Discussions](https://github.com/CXmiloxx/tourwright/discussions);
vulnerabilities to [SECURITY.md](SECURITY.md), never a public issue.

## Setup

Node.js 20+ on Linux, macOS or Windows. CI runs the tests and a real render on all three.

```bash
git clone https://github.com/CXmiloxx/tourwright && cd tourwright
npm ci
node bin/tourwright.js install  # ffmpeg, Piper + voices, edge-tts, Chromium (not install.sh: it drops dev dependencies)
node bin/tourwright.js doctor   # what works on this machine
npm test                        # unit tests, no browser needed (the audio mix test needs ffmpeg)
npm run check                   # lint + typecheck + tests + schema in sync: what CI runs
```

## Rules

Read [AGENTS.md](AGENTS.md) first: the map of the code and its rules (plain ESM, no build step, few
dependencies, everything from `loadConfig()`, untrusted input validated, logs on stderr).

## Good first contributions

- **Voice aliases that sound good**: open a "Share a voice" issue with the spec and a sample.
- **Examples**: a script in `examples/` that shows a feature well.
- **Translations of the docs.**
- **New step actions** (see below).
- **TTS engines as plugins**, so they do not need to live in the core.

## Adding a step action

1. Add it to `STEPS` in `src/script/schema.js` (zod).
2. Implement it in `runSteps` in `src/render/browser.js`.
3. Document it in the Actions table of `docs/SCRIPTS.md`.
4. `npm run schema` and commit `schema/script.schema.json` (CI checks it is up to date).
5. Add a test in `test/`, then render a script that uses it and watch the video.

## Writing a plugin

Plugins add step actions and TTS engines without changing the core. See [docs/PLUGINS.md](docs/PLUGINS.md).

## Commits

Conventional Commits with a [gitmoji](https://gitmoji.dev): `<gitmoji> type(scope): title`, e.g.

```
✨ feat(voice): pronunciation dictionary per script
🐛 fix(render): cursor jumps when the page scrolls
📚 docs(scripts): document the drag action
```

Types: ✨ feat · 🐛 fix · ♻️ refactor · ⚡ perf · 📚 docs · ✅ test · 👷 ci · 📦 build · 🔧 chore. One intent
per commit; a breaking change takes `!` after the type and a `BREAKING CHANGE:` footer.

## Pull requests

1. Open an issue first for new syntax, breaking changes or new dependencies.
2. Branch from `main`, keep the pull request focused, describe the why.
3. `npm run check`; for rendering changes, also render `examples/` and look at the result.
4. Fill in the checklist of the pull request template. CI runs tests on Node 20/22/24 and renders the
   examples.
5. A maintainer reviews; see [GOVERNANCE.md](GOVERNANCE.md).

Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree your work is released under the MIT license.
