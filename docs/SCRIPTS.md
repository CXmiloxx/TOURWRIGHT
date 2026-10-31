# Writing Tourwright scripts

A script describes a video. Tourwright turns it into an `.mp4` with narration, captions (burned in and as a
subtitle track), chapters, an `.srt`/`.vtt`, a thumbnail and a JSON manifest.

There are two kinds of video:

| `type` | What it is | Needs |
|---|---|---|
| `browser` (default) | A walkthrough of a website: a real browser, an animated cursor, captions and narration | Chromium |
| `slides` | A narrated slideshow: title cards, images, HTML | Chromium (or nothing, if every slide is an image) |

Scripts are YAML or JSON (data: what the API, MCP and agents use) or JavaScript (code: for people who
need loops, conditions or custom logic). The JSON Schema is at `schema/script.schema.json`
(`tourwright schema`).

## Start from your site

You don't have to find selectors by hand. Point Tourwright at the site and it writes the first script:

```bash
tourwright explore https://app.example.com/login --draft app.yaml
tourwright render app.yaml --dry-run    # every step in seconds: checks the targets
tourwright render app.yaml --open       # the video, with narration; opens it when done
```

`explore` opens the page. If it is a login, it finds the form, asks for the user and the password (they are
not shown while you type and are saved for the next renders, see [Secrets](#secrets)) and logs in off camera.
Then it visits every section of the site's menu and, for each page, prints its title, the sentence that says
what the page is for and the targets you can paste into a script (`{ role: button, name: Export }`). It saves
a screenshot of each page in `videos/<name>/explore/`, with table rows blurred.

`--draft app.yaml` writes all of it as a working script: the login in `setup`, `blur` for the tables, `dismiss`
for the app's own product tour if it has one, and one narrated stop per section, taken from what each page says
about itself, and a `focus` (a bubble, a numbered badge, a gentle zoom) on the key controls of each page: its
filters, tabs and main buttons. The other targets of each page are listed under it as comments: rewrite the
narration in your own words and point at whatever else matters. `tourwright explore app.yaml` later shows the targets again, logged in.

To show the login itself in the video, add `--login camera`: the draft starts logged out on the login page and
types each field on camera, with a focus that says what goes in it, then presses the button. The password
shows as dots, as in any password field, and a secret typed in any other field (the user) is blurred. To show
a demo user instead, write it in the script in place of its `${secret:…}`.

```bash
tourwright explore https://app.example.com/login --draft app.yaml --login camera
```

## Browser walkthrough

```yaml
title: Create your first invoice
language: en                              # narration language (subtitle track, browser locale)
voice: lessac                             # see "Voices"
quality: hd                               # sd 854×480 · hd 1280×720 · fullhd 1920×1080 · vertical 1080×1920 · square 1080×1080
baseUrl: https://app.example.com
blur: ['[data-private]', '.email']        # CSS selectors blurred for the whole video (personal data)
music: { file: music.mp3, volume: 0.12 }  # optional, looped and lowered while someone speaks

# Off camera, before recording (log in…). Skipped while the saved session is still valid.
session: demo-user
sessionCheck: { goto: /, notUrl: /login }
setup:
  - goto: /login
  - fill: { target: { label: Email }, text: "${secret:APP_USER}" }        # tourwright secret set APP_USER
  - fill: { target: { label: Password }, text: "${secret:APP_PASSWORD}" }
  - click: { role: button, name: Sign in }
  - wait: { url: /dashboard }
warmup: [/invoices/new]                   # opened before recording so they load fast on camera
dismiss: [{ role: button, name: Skip tour }]   # the app's own tour, a cookie banner…: closed off camera

steps:
  - goto: /invoices/new
  - title: { text: Your first invoice, subtitle: Step by step }
  - say: Pick the <b>customer</b> first.
  - click: { role: combobox, name: Customer }
  - click: { text: Acme Inc. }
  - say: { caption: Then add the items., speak: Then add each item, with its quantity and price. }
  - type: { target: { placeholder: Description }, text: Consulting }
  - zoom: { target: { testId: total }, ms: 2000 }
  - click: { role: button, name: Save }
  - wait: { text: Invoice saved, timeout: 60000 }   # off camera: cut from the video
  - say: Done. The invoice is ready to send.
  - say: null                                       # clears the caption
```

### Actions

Each step is an object with **exactly one** action.

| Action | Value | What it does |
|---|---|---|
| `goto` | path or URL | Opens a page (paths resolve against `baseUrl`; in a local script `baseUrl` may be a folder next to it, like `./site/`) |
| `title` | text, or `{ text, subtitle?, ms?, say? }` | Full-screen title card (3.5 s by default). Starts a chapter |
| `say` | text, `{ caption?, speak?, ms? }` or `null` | Caption at the bottom, **narrated aloud**. `speak` is said instead of the caption when it must explain more. `null` clears it |
| `caption` | text or `null` | Caption without narration |
| `click` | target | Moves the cursor smoothly to the element and clicks |
| `dblclick` | target | Same, with a double click |
| `rightClick` | target | Same, with the right button |
| `hover` | target | Moves the cursor over the element |
| `check` / `uncheck` | target | Ticks or unticks a checkbox (or picks a radio button) |
| `drag` | `{ from, to }` | Drags an element and drops it on another |
| `type` | `{ target, text, delay?, clear? }` | Clicks a field and types letter by letter |
| `fill` | `{ target, text }` | Fills a field instantly |
| `press` | key | `Enter`, `Tab`, `Control+A`… |
| `select` | `{ target, value }` | Chooses an option of a `<select>` |
| `highlight` | target or `{ target, ms? }` | Draws a frame around the element |
| `spotlight` | target or `{ target, ms? }` | Dims everything except the element |
| `callout` | `{ target, text, ms?, position? }` | A speech bubble pointing at the element (`auto`, `top`, `bottom`, `left`, `right`); text may have `<b>` |
| `focus` | `{ target, say?, text?, step?, zoom?, pulse?, click?, caption?, ms?, position? }` | Onboarding-style focus timed to the voice: see [Guided focus](#guided-focus) |
| `zoom` | target or `{ target, ms?, scale? }` | Pushes the camera in on the element (and pans it toward the middle), then back |
| `scrollTo` | target | Scrolls until the element is centered |
| `scroll` | pixels | Scrolls by that much (negative = up) |
| `cursor` | `show` or `hide` | Shows or hides the animated cursor |
| `back` / `reload` | `true` | Goes back to the previous page / reloads it |
| `pause` | ms | Lets the viewer look |
| `sound` | name, file or `{ file, volume?, wait? }` | Plays a sound: built-in `click`, `pop`, `ding`, `whoosh`, or a file. `wait: true` waits until it ends |
| `wait` | ms or `{ target?, text?, url?, timeout?, state? }` | Waits **off camera** (cut from the video) |
| `blur` | target or list | Blurs elements from now on |
| `upload` | `{ target, files }` | Puts files into an `<input type=file>` |
| `offCamera` | list of steps | Steps that happen but are cut from the video |
| `if` | `{ visible? \| text? \| url?, timeout?, then, else? }` | Runs steps only if an element, a text or a URL is there |
| `try` | list of steps, or `{ steps, timeout? }` | Steps that may fail without stopping the video |
| `use` | block name, or `{ block, with }` | Inserts a block of steps (see "Variables, blocks and repeats") |
| `repeat` | `{ times \| each, as?, steps }` | Repeats steps |

`say` and `title` also take `voice`, `rate`, `pitch`, `volume` and `style` (see "Voices and how they speak").

### Targets

How to find an element. Prefer the object forms: they survive redesigns.

```yaml
click: "#buy"                           # a Playwright selector: CSS, text=…, xpath=…
click: { role: button, name: Buy now }  # by accessible role and name (best)
click: { label: Email }                 # the field with that label
click: { placeholder: Search }
click: { text: Pricing }                # visible text (add exact: true for an exact match)
click: { testId: checkout }             # data-testid
click: { css: .card, nth: 2 }           # the third match
```

### Rhythm and timing

- A new `say`, a `title` or an off-camera wait **waits for the previous narration to finish**: write
  steps in the order you want them heard; never add pauses to "wait for the voice".
- The time it takes to synthesize a voice, and everything inside `wait`/`offCamera`, is cut from the video.
- The video starts at the first `title` or `say`: page loading before it is cut.
- Write narration in short sentences. Each sentence is synthesized whole; a short, even pause separates them.

### Guided focus

`focus` is the "first time in the app" tour step: everything dims except the element, a ring marks it,
a bubble explains it, and the camera can push in, all landing on the word the voice is saying.

```yaml
- focus:
    target: { role: button, name: Pay }
    say: "When everything looks right, press {Pay}."   # {word}: the focus lands when this word is heard
    text: "Secure payment by <b>card</b> or <b>bank transfer</b>"   # the bubble
    step: 3/3          # badge in the bubble
    zoom: 1.3          # camera push-in (1 to 3)
    pulse: true        # the ring pulses
    click: true        # and then the cursor clicks it
```

- Order on screen: the cursor glides to the element, the narration (and its caption) starts, and at the
  marked word the camera moves in and the focus appears. It holds until the narration ends plus `ms`
  (default 1200), fades, and the camera pulls back.
- Without a `{word}` the focus appears as the narration starts; without `say` it is silent.
- The zoom happens in the browser, so text stays sharp at any zoom (nothing is upscaled).
- `caption` shows a different text than the one said; `voice`, `rate`, `pitch`… work as in `say`.

### Variables, blocks and repeats

One script can make many videos, and repeated steps are written once:

```yaml
vars:
  product: Acme
  customer: { name: Ana, plan: Pro }
blocks:
  open-menu:
    - click: { role: button, name: Menu }
    - click: { text: "{{section}}" }
steps:
  - title: "{{product}} in two minutes"
  - say: "Hi {{customer.name}}, this is your {{customer.plan}} plan."
  - use: { block: open-menu, with: { section: Reports } }
  - repeat:
      each: [Sales, Costs, Margin]
      as: tab
      steps:
        - click: { role: tab, name: "{{tab}}" }
        - say: "This is {{tab}}."      # also {{index}} (1, 2, 3…) and {{item}}
  - repeat: { times: 3, steps: [ { press: ArrowDown } ] }
```

- `{{name}}` works in any text. A value that is only `{{name}}` keeps its type (`pause: "{{ms}}"` is a number).
- Values come from `vars`, from `--var name=value` on the command line, or from `vars` in an API/MCP request,
  which override the script's own. An unknown variable is an error.
- `use` inserts a block's steps; `with` gives it its own variables. Blocks may use other blocks.

### Conditions and steps that may fail

```yaml
- if: { visible: { text: Accept cookies }, then: [ { click: { text: Accept cookies } } ] }
- if: { url: /onboarding, timeout: 3000, then: [ { click: { text: Skip } } ], else: [ { say: Welcome back. } ] }
- try: [ { click: { role: button, name: Close } } ]        # if there is nothing to close, go on
```

`if` checks once by default; with `timeout` it waits up to that long, off camera. Inside `try` each step waits
at most `timeout` ms (default 3000) instead of 30 s, and the first one that fails ends the `try`.

For what the app opens on its own (its product tour, a cookie banner, a chat bubble) use `dismiss` instead: it
is closed whenever it shows up, on any page, off camera. On each new page the recording waits a moment for it.

```yaml
dismiss:
  - { role: button, name: Skip the tour }
  - { text: Accept cookies }
```

### Secrets

Passwords and keys never go in the script. Save them once:

```bash
tourwright secret set APP_USER          # asks for the value; nothing is shown while you type
tourwright secret set APP_PASSWORD
tourwright secret list                  # the names saved (never the values)
```

and write `"${secret:APP_PASSWORD}"` where the value goes. They are kept in `TOURWRIGHT_HOME/secrets.json`,
readable only by you; `tourwright secret delete APP_PASSWORD` removes one. A value can also be piped
(`… | tourwright secret set APP_PASSWORD`) or come from the environment as `TOURWRIGHT_SECRET_APP_PASSWORD`,
which wins over the saved one: that is how a server or CI passes them. The older `${env:TOURWRIGHT_SECRET_NAME}`
still works and means the same.

- A secret's value is replaced with `•••` in every log line and error, a failing `fill` included.
- Missing secrets are all named at once, with the command that saves each one; `tourwright validate` checks them too.
- A secret can be typed on camera with `type` or `fill`: a password field shows dots, and any other field is
  blurred while it holds a secret. Anything else in `steps` that holds a secret (a narration, a caption) can
  be seen or heard: Tourwright warns about it, in `validate` too.
- API jobs can use secrets only with `TOURWRIGHT_ALLOW_SECRETS=true`.

#### Codes from an authenticator app

When the site asks for a code from an authenticator app, save the key it shows under its QR code ("can't scan
it? enter this key") and write `${totp:NAME}` where the code goes. The code is made the moment it is typed,
and one about to expire waits for the next, so it is always valid.

```bash
tourwright secret set APP_TOTP            # the key, like JBSW Y3DP EHPK 3PXP
```

```yaml
  - fill: { target: { label: Verification code }, text: "${totp:APP_TOTP}" }
```

Codes sent by SMS or email cannot be read by a script: log in by hand once (below).

### Sessions

With `session: name`, the login of `setup` is saved after the first render and reused: the next renders skip it
while `sessionCheck` says it is still valid. If the login fails, the render stops right there and says so.

A login no script can do, with a Google or Microsoft account, a captcha or a code by SMS, is done by hand once:
`tourwright session login app.yaml` opens a browser window, you log in as usual, press Enter in the terminal
and the session is saved under the script's `session`. The renders start logged in and skip `setup` while it
lasts; when it expires the render stops and says to log in again. Give the script a `sessionCheck` so that
is noticed.

```bash
tourwright session login app.yaml       # log in by hand, once
tourwright render app.yaml --fresh      # log in again, ignoring the saved session
tourwright session list                 # saved logins
tourwright session delete app           # forget one
tourwright forget                       # delete every saved secret and session at once
```

### Serving a site from another origin

```yaml
hosts:
  app.example.com: http://localhost:3000
```

The browser opens `https://app.example.com/…` and Tourwright serves it from `http://localhost:3000` (cookies,
WebSockets and live event streams included). Useful to film a local or staging copy under its real domain.
Not available to API jobs.

## Narrated slides

```yaml
type: slides
title: Quarterly results
language: en
voice: lessac
transition: 0.5          # crossfade seconds (0 = cut)
music: music.mp3
slides:
  - title: Q3 2026
    subtitle: Results and next steps
    say: Welcome. Here are the results of the third quarter.
  - image: chart.png      # relative to the script (or an API asset)
    caption: Revenue grew <b>18%</b>
    say: Revenue grew eighteen percent, driven by the new plans.
    motion: zoom-in       # none · zoom-in · zoom-out · pan
  - html: |
      <h1>Next steps</h1>
      <ul><li>Launch in <b>Brazil</b></li><li>Hire two engineers</li></ul>
    say: Next, we launch in Brazil and grow the team.
    duration: 6           # minimum seconds; narration extends it
    chapter: Next steps
    voice: cfo            # a voice from `voices`; also rate, pitch, volume, style
    sound: whoosh         # a sound when the slide appears
```

`voices`, `pronounce`, `audio`, `music` and `vars` work in slides too.

Each slide stays on screen while its narration lasts (plus a short margin), or `duration` seconds if longer.
Slides with `title` and no image start a chapter; `chapter` names one explicitly.

## Voices and how they speak

`voice` is `engine:id[?options]` or a name:

| Voice | Engine | Notes |
|---|---|---|
| `pocket:lola` (Spanish), `pocket:alba` (English)… | [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) | The most natural offline voices: an open model (Kyutai, MIT code) on the CPU. `tourwright install --pocket`. The default voice once installed |
| `piper:es_MX-claude-high`, `piper:en_US-lessac-medium`… | Piper | Offline and open source, very light, more synthetic. `tourwright install-voice <name>`; catalogue at huggingface.co/rhasspy/piper-voices |
| `edge:es-CO-SalomeNeural` | edge-tts | Neural Microsoft voices, free, needs internet (unofficial service) |
| `openai:alloy?model=tts-1-hd` | OpenAI-compatible | OpenAI, Kokoro-FastAPI, LocalAI… (`TOURWRIGHT_OPENAI_TTS_URL`) |
| `command:<id>` | Your command | `TOURWRIGHT_TTS_COMMAND` |
| `none` | — | Silent video |

Names: `lola` (Pocket TTS, Spanish), `lola-rapida` (the same voice with the smaller model: about three times faster,
a bit flatter), `gonzalo`, `salome` (Spanish, Colombia), `jorge`, `dalia` (Mexico), `alonso`, `paloma` (US Spanish),
`andrew`, `ava`, `emma`, `brian` (multilingual), `claude`, `davefx`, `lessac` (Piper), plus the server's
aliases and plugins. `tourwright voices` lists what this server can use.

**Listen before choosing.** A sample of every voice comes with Tourwright in `docs/voices/` (the same text: tech
words, numbers, a question), so you can choose before installing anything: `tourwright voices --open` opens that
folder. `tourwright voices --samples` records them again with the voices of your machine, and `--text "…"` with
your own words. Then write the name in the script: `voice: lola`.

**How they were tuned.** Every built-in voice reads a set of sentences full of what narrations hold (API, JSON,
PDF, `25.800`, `95 %`, `$ 409.360`, an email, Ctrl K…); Whisper, an open speech-to-text model, writes down what it
heard. Then each engine was calibrated on its own (`scripts/calibrate-voices.js`): every term was said written several
ways (as is, respelled, spelled out) and the one Whisper understood best was kept, in `src/voice/calibrated.json`.
Neural voices (Edge, Pocket TTS) say most English words right as written, so they only get the respellings that
won; Piper needs more of them. You can check any voice, yours too:

```bash
tourwright install --whisper           # once: Whisper (about 500 MB)
tourwright voices --check lola salome  # the share of words understood, and each word that failed
```

**Which one?** For a natural voice offline, `lola` (Pocket TTS): it takes about as long to make a sentence as the
sentence lasts, once, and the cache keeps it. `salome` and `gonzalo` (Edge) sound as natural and are instant, but
need internet and use an unofficial Microsoft service. Piper (`claude`) is the lightest and the most robotic.

Pocket TTS models: `pocket:lola` uses `spanish_24l` (the best); `?model=spanish` is the fast one. Other languages
have their own voice (`giovanni` Italian, `juergen` German, `rafael` Portuguese, `estelle` French, `alba` English).
A `.wav` of 10–20 s of clean speech in the voices folder (`TOURWRIGHT_HOME/voices/ana.wav`) becomes `pocket:ana`:
the narration in that voice. Only with the consent of whoever it belongs to.

### A cast of voices

`voices` names the voices of a script; any line can use one:

```yaml
voice: guide                      # the default voice of the video
voices:
  guide: salome
  customer: "gonzalo?rate=-5%"
  robot: "claude?pitch=-4st"
steps:
  - say: Welcome to the support desk.
  - say: { caption: "My invoice is wrong.", voice: customer }
  - say: { caption: "Let me check.", voice: guide, rate: "+5%" }
```

### How a line is said

Every voice, on every engine, takes these (in a step, a slide, or after a name: `salome?rate=+10%&pitch=+1st`):

| Option | Example | |
|---|---|---|
| `rate` | `-15%`, `+10%` | Speed |
| `pitch` | `+2st` (semitones), `-5%`, `+20Hz` (Edge only) | Pitch |
| `volume` | `+3dB`, `-20%` | Loudness of this line |
| `style` | `"warm and calm"` | For engines that take instructions (OpenAI `gpt-4o-mini-tts`); others ignore it |

```yaml
- say: { caption: "Careful!", pitch: "+2st", rate: "+10%", volume: "+3dB" }
- title: { text: Chapter 2, say: "Now, the reports.", voice: robot }
```

### Inside the text

- `[[800ms]]` or `[[1.5s]]`: an exact silence. Captions do not show it.
- `|`: a short pause (reads as a comma).
- Tech words, acronyms and numbers are said the way people say them, in the voice's language: in Spanish "API"
  is "a pe i", "JSON" "yei son", "CSV" "ce ese ve", "25.800" "veinticinco mil ochocientos", "95 %" "noventa y cinco
  por ciento", "21 consultas" "veintiuna consultas"; an id like 1088248203 is read digit by digit, and acronyms
  without vowels ("CC") are spelled. The list is in `src/voice/lexicon.js`; captions keep what is written.
- `pronounce` fixes any other word (and wins over the built-in list); captions keep the written form:

```yaml
pronounce:
  SaaS: sas
  CRM: ce erre eme
  Tourwright: rro-DA-je
```

### The sound of the video

```yaml
audio:
  polish: warm        # default · clean · warm · radio · podcast · none
  pause: 0.35         # seconds between sentences (server default 0.5)
  clicks: true        # a click on every click (or a sound file)
  typing: true        # keyboard sound while typing
  effects: 0.8        # volume of sound effects
music: { file: music.mp3, volume: 0.12, fadeIn: 2, fadeOut: 3 }   # looped, lowered while someone speaks
```

| `polish` | Sound |
|---|---|
| `default` | Warmth, presence, gentle compression, a small room, loudness at -16 LUFS |
| `clean` | The voice as the engine made it, at even loudness |
| `warm` | Closer and rounder, no room |
| `radio` | Telephone band, compressed |
| `podcast` | Dense and upfront |
| `none` | No processing |

Sound effects (`sound`, clicks, typing) are mixed apart from the voice: they are not processed and do not
lower the music.

## JavaScript scripts

```js
export const options = { baseUrl: 'https://app.example.com', voice: 'lessac', blur: ['.email'] }

// Optional: runs off camera before recording, unless a saved session is still valid
export const setup = async ({ page }) => {
  await page.goto('https://app.example.com/login')
  // …
}

export default async ({ page, v }) => {
  await v.goto('/reports')
  await v.title('Monthly report', 'Where to find it')
  await v.say('Open <b>Reports</b> in the menu.')
  await v.click(page.getByRole('link', { name: 'Reports' }))
  for (const row of await page.locator('tr').all()) await v.highlight(row, 800)
  await v.offCamera(() => page.getByText('Ready').waitFor({ timeout: 180_000 }))
  await v.say(null)
}
```

`v` has `goto, back, reload, title, say, click, check, drag, hover, type, highlight, spotlight, callout, focus, zoom,
scrollTo, scroll, cursor, sound, pause, offCamera, blur, upload` (with Playwright locators) plus `page`,
`context` and `dryRun`. `v.say(html, { voice, rate, pitch, volume, style })` speaks with another voice;
`v.click(locator, { clickCount: 2 })` double-clicks. The helpers also have Spanish names: `ir, titulo,
leyenda, clic, escribir, resaltar, acercar, ocultar, bajarHasta, fueraDeCamara, subir`.

## Plugins

A server may load plugins that add actions (and voices). They appear in `tourwright schema` and in the errors of
`tourwright validate` like any other action. Writing one: [PLUGINS.md](PLUGINS.md).

## Where the files go, and what you get

Each video gets its own folder: `videos/<name>/`, named after the script.

```text
videos/
  consultar/
    consultar.yaml        the script (the draft from explore goes wherever you say)
    consultar.mp4         the narrated video
    consultar.srt  .vtt   subtitles (also inside the .mp4, as a track)
    consultar.jpg         poster
    consultar.json        manifest: duration, chapters, captions, files
    explore/              screenshots from tourwright explore
  voces/                  voice samples you recorded (tourwright voices --samples)
```

`--out` puts it somewhere else (a folder, or a file ending in .mp4). What is delivered is chosen with `export`, in
the script or on the command line:

```bash
tourwright render app.yaml                          # the narrated video (default)
tourwright render app.yaml --export audio           # only the sound: consultar.mp3 (narration, music, effects)
tourwright render app.yaml --export silent          # the video without sound: consultar-silent.mp4
tourwright render app.yaml --export video,audio,silent
```

```yaml
export: [video, audio]
```

Subtitles, poster and manifest always come. `--quality` picks the size: `sd`, `hd` (default), `fullhd`,
`vertical` (1080×1920, for phones and reels) or `square`.

## Testing a script

```bash
tourwright validate video.yaml          # the format, without running it (blocks and variables expanded)
tourwright render video.yaml --dry-run  # runs every step fast, no voice or video: tests the selectors
tourwright explore video.yaml           # logs in like the script and lists each page's targets
```

When a step fails, Tourwright saves a screenshot of the page (`failure-<name>.png`) next to the output.
