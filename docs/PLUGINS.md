# Writing a Tourwright plugin

A plugin adds step actions, TTS engines or voice names without changing Tourwright. It is an ES module; the
server loads it at start-up from the config:

```bash
TOURWRIGHT_PLUGINS=./plugins/banner.js,tourwright-plugin-confetti tourwright serve --worker
```

```json
{ "plugins": ["./plugins/banner.js", "tourwright-plugin-confetti"] }
```

Paths are relative to the working directory; bare names are packages installed there (`npm i tourwright-plugin-…`).
Every entry point (CLI, API, worker, MCP, library `render()`) loads the same list. Library users can also call
`registerPlugin(plugin)` directly.

## Shape

```js
export default {
  name: 'my-plugin',
  steps: {
    // - banner: { text: Hello }
    banner: {
      description: 'Shown in the JSON Schema and to agents',
      schema: z => z.object({ text: z.string() }).strict(),      // receives Tourwright's zod
      run: async (arg, { page, v, locate, dryRun }) => { /* … */ },
    },
  },
  engines: {
    // voice: "mytts:speaker-1?rate=+10%"
    mytts: {
      native: ['rate'],                                          // options it applies itself; the rest ffmpeg does
      available: async config => ({ ok: true }),                 // or { ok: false, reason: 'set MYTTS_URL' }
      synthesize: async ({ text, voice, out, config }) => { /* write audio of `text` to `out` */ },
    },
  },
  voices: { narrator: 'mytts:speaker-1?rate=-5%' },              // names usable in `voice:`
}
```

The default export may also be a function `({ z, config }) => plugin` (sync or async), to read settings.

### Steps

- `arg` is the step's value, already validated by `schema`.
- `page` is the Playwright page; `locate(target)` turns a Tourwright target (`{ role, name }`, a selector…)
  into a Playwright locator.
- `v` has the same helpers as JavaScript scripts: `v.click(locator)`, `v.say(html, { voice })`,
  `v.highlight(locator, ms)`, `v.pause(ms)`, `v.offCamera(fn)`, `v.sound({ file })`… Use them to keep the
  cursor, captions, narration and cuts consistent.
- In a rehearsal (`--dry-run`) `dryRun` is true: skip slow or visual work.
- Inside `setup` (off camera) `v` is a plain version without animations; visual helpers do nothing.
- A step name cannot replace a built-in action.

### Engines

`synthesize` receives one sentence at a time and writes any format ffmpeg reads to `out`. Tourwright trims the
silence, applies the options listed outside `native` (`rate`, `pitch`, `volume`), caches the result and
joins the sentences. `voice.id` is the part after `engine:`; `voice.options` the `?a=b` options.

## Security

Plugins are code chosen by whoever runs the server; a script or an API request can never load one. But a
plugin's steps are available to every script, including API jobs: validate arguments with a strict schema,
write text with `textContent` rather than `innerHTML`, and never build shell commands or file paths from them.

## Sharing

Publish it to npm as `tourwright-plugin-<name>` with the keyword `tourwright-plugin`, and open a pull request adding
it to the list below.

| Plugin | What it adds |
|---|---|
| [`examples/plugins/banner.js`](../examples/plugins/banner.js) | `banner`: a strip of text at the top of the page |
