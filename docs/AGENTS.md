# Tourwright for AI agents

Tourwright gives an agent one capability: **turn a description into a narrated video**. The agent writes a
declarative script (YAML/JSON), Tourwright renders it and returns the files and their links.

## Connect

MCP over stdio (Claude Code, Claude Desktop, Cursor, any MCP client):

```json
{
  "mcpServers": {
    "tourwright": { "command": "tourwright", "args": ["mcp"] }
  }
}
```

With Docker: `"command": "docker", "args": ["run", "-i", "--rm", "-v", "tourwright:/var/lib/tourwright", "ghcr.io/cxmiloxx/tourwright", "mcp"]`.

Against a shared server: add `"env": { "TOURWRIGHT_API_URL": "https://tourwright.example.com", "TOURWRIGHT_API_TOKEN": "…" }`.

Claude Code: `claude mcp add tourwright -- tourwright mcp`.

No MCP? Use the HTTP API ([API.md](API.md)) or the CLI (`tourwright render script.yaml --json`).

## Tools

| Tool | Use |
|---|---|
| `tourwright_guide` | The full script format. Call it first |
| `tourwright_voices` | Voices that work on the server |
| `tourwright_validate` | Check a script; returns precise errors (`steps.3.click: …`) |
| `tourwright_render` | Render; waits by default and returns links, local paths, duration, chapters, captions |
| `tourwright_job` | Status of a job started with `wait: false` |
| `tourwright_render_file` | Render a file from disk (only with `TOURWRIGHT_MCP_ALLOW_FILES=true`) |

## A good loop

1. `tourwright_guide` once per session.
2. Look at the target site yourself (a browser tool, or fetch the HTML) to choose robust targets:
   `{ role, name }`, `{ label }`, `{ placeholder }`, `{ text }` — not brittle CSS.
3. Write the script. Short narrated sentences; one idea per `say`; a `title` per section.
4. `tourwright_validate`, then `tourwright_render` with `options.dryRun: true`: it runs every step in seconds and
   fails on the first selector that does not match, with the error.
5. Fix, then render for real. Return the `links.video` to the user.

For slides, send images as `assets` (base64) and refer to them by name. To make the same video for several
customers or products, write `{{variables}}` in the script and pass `vars` to `tourwright_render`.

## Writing narration that sounds human

- Sentences of 6–18 words. Each is synthesized whole; a pause separates them.
- Say what the viewer sees *now*, in the order it happens. Tourwright waits for each narration to end
  before the next caption, title or off-camera wait: never add pauses to wait for the voice.
- Captions can be shorter than the narration: `{ say: { caption: "Save", speak: "When you're done, save the form." } }`.
- `|` adds a short pause.
- Pick the voice language that matches `language` (`tourwright_voices`).
