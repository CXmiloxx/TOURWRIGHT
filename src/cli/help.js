// What `tourwright help` prints, and the script `tourwright init` writes.
import { DEFAULT_VOICES } from '#install/index.js'

export const HELP = `tourwright — scripts into narrated videos

From a site to a video:
  tourwright explore https://app.example.com/login --draft app.yaml
                                              finds the login (asks for the credentials, never shows them),
                                              the sections and their targets, and writes a first script
  tourwright render app.yaml --dry-run        runs every step in seconds: checks the targets
  tourwright render app.yaml --open           records it with narration; opens the video when done

Usage:
  tourwright render <script> [options]        render a video (.yaml, .json, .js)
      --out <file.mp4|dir>                    where to write it (default: ./videos/<script>/<script>.mp4)
      --export video,audio,silent             what to deliver: the narrated video (default), only the sound
                                              (.mp3), the video without sound; subtitles and poster always come
      --open                                  open the video (or its folder) when it is ready
      --voice <voice>                         engine:id or alias (see \`tourwright voices\`); "none" = silent
      --quality sd|hd|fullhd|vertical|square
      --capture auto|screen|screencast|playwright
      --dry-run                               run the script fast, without voice or video (tests selectors)
      --safe                                  a dry run that finds every element but presses, types and chooses
                                              nothing: nothing real happens in the app (no sign-up, no SMS)
      --keep                                  keep the recording, the voices and the timeline next to the video
                                              (<name>.source/), to make it again with \`tourwright recompose\`
      --fresh                                 log in again instead of reusing the saved session
      --step <n|a-b>                          film only that step (or range), with its voice: the steps before
                                              run fast off camera. Saved as <name>-step<n>.mp4
      --timeout <s>                           maximum seconds
      --var name=value                        set a script variable ({{name}}); repeatable
      --json                                  print the manifest as JSON on stdout
      --lock <file>                           one browser at a time on this machine: wait for this lock file
                                              (on Linux the same lock as flock <file>; also TOURWRIGHT_BROWSER_LOCK)
  tourwright explore <url|script> [options]   the sections of a site and the targets to write a script
      --draft <file.yaml>                     write a first script that goes through every section
      --pages /a,/b                           these pages instead of the site's navigation
      --login setup|camera                    the draft logs in off camera (setup, default) or on camera
      --fresh                                 log in again instead of reusing the saved session
      --json                                  the report as JSON on stdout
  tourwright record <url> [--out f.yaml]      do the tour by hand in a browser window, close it, and get the
                                              script and the narrated video: what you typed in the login is
                                              saved as secrets, the AI writes the narration when one is set up
      --no-video                              only the script, to edit before rendering
      --plain                                 without the studio look (window frame, zoom, closing card)
      --language es|en                        language of the narration
  tourwright validate <script> [--var n=v]    check a script without running it (and its secrets)
      --no-vars                               only the format and the names: variables and secrets without values
  tourwright recompose <video folder> [options]
                                              make a video rendered with --keep again, without the browser: edit
                                              captions, sentences or blurs in <name>.source/timeline.json first
      --voice <voice>                         say every sentence again with another voice
      --polish default|clean|warm|radio|podcast|none
      --no-clicks                             without click and typing sounds
      --quality, --out                        as in render
  tourwright guide <script> [--out d] [--open] the script as a step-by-step guide with screenshots: one HTML file
                                              to send or print as PDF, and Markdown with its images
  tourwright narrate <script> [--write]       the narration rewritten by your AI from what each screen shows
                                              (tourwright config set ai anthropic|openai|ollama); --write saves it
  tourwright translate <script> --to en       the same video in another language (es, en, pt, fr, de, it), by your
                                              AI: narration, captions and titles; the app's own words stay.
                                              Writes <script>.en.yaml (--out to choose, --yes to replace)
  tourwright check <script…> [--json]         dry-run each one: every broken step, with the likely fix; exit 1
      --report <file.md>                      if one broke (CI). In GitHub Actions it also fills the job summary
  tourwright fix <script> [--write]           propose the new target for each broken step; --write saves them
  tourwright voices [--json] [--open]         voices and engines here; --open opens the samples of each voice
  tourwright voices --samples [names] [--text "…"] [--out dir]
                                              record a sample of each voice (default: ./videos/voces/)
  tourwright say "<text>" [--voice v] [--out file.wav]
                                              say one text ([[1s]] = exact pause; voice?rate=+10%&pitch=+2st)
  tourwright install [options]                ffmpeg, Piper, voices, edge-tts and Chromium into TOURWRIGHT_HOME
                                              (Linux, macOS, Windows; no root, no Docker)
      --voices a,b                            Piper voices (default: ${DEFAULT_VOICES.join(',')})
      --no-edge                               skip edge-tts (Microsoft voices, online)
      --no-chromium                           skip Chromium
      --plan                                  only show what is used from this PC and what would be downloaded
      --yes, -y                               download without asking (it asks only in a terminal)
      --pocket                                Pocket TTS: open, natural voices (Spanish: pocket:lola), CPU only;
                                              about 1 GB with PyTorch. Becomes the default voice
  tourwright install-voice <piper-voice>      download a Piper voice (es_MX-claude-high, en_US-lessac-medium…)
  tourwright doctor                           check ffmpeg, Xvfb, Chromium and TTS engines
  tourwright config [--json]                  your defaults (quality, voice, fps…) and where each one comes from
  tourwright config set <setting> <value>     change one for every project on this machine (e.g. quality fullhd)
  tourwright config unset <setting>           back to the default
  tourwright init [file]                      write an example script
  tourwright schema                           print the JSON Schema of declarative scripts
  tourwright serve [--port 4700] [--host h]   HTTP API (+ an embedded worker with --worker)
  tourwright worker                           process queued jobs
  tourwright mcp                              MCP server over stdio, for AI agents

Credentials and sessions (kept in TOURWRIGHT_HOME, readable only by you):
  tourwright secret set <NAME>                save a credential; the value is asked for and never shown.
                                              A script uses it as "\${secret:NAME}"
  tourwright secret list                      the names saved (never the values)
  tourwright secret delete <NAME>
  tourwright session login <script>           log in by hand in a browser window (Google, SSO, a captcha,
                                              a code by SMS) and save it as the script's \`session\`
  tourwright session list                     logins saved by \`session:\` in scripts
  tourwright session delete <name>
  tourwright forget                           delete every saved credential and session

Disk:
  tourwright clean [options]                  what each part takes, and removes downloads and leftovers
      --voice-cache                           also the sentences already said (made again when needed)
      --pocket                                also Pocket TTS and its models (the default voice goes back to Piper)
      --whisper                               also Whisper and its models (installed by Tourwright 1.1, no longer used)

Configuration: environment variables TOURWRIGHT_* or tourwright.config.json (see docs/CONFIGURATION.md).
`

export const EXAMPLE = `# Tourwright script — https://github.com/CXmiloxx/tourwright
title: My first video
voice: piper:es_MX-claude-high
baseUrl: https://example.com
steps:
  - goto: /
  - title: { text: "Example Domain", subtitle: "A narrated walkthrough" }
  - say: "This is <b>example.com</b>, a page reserved for documentation."
  - highlight: h1
  - say: "Below the title there is a link with more information."
  - zoom: a
  - say: null
`
