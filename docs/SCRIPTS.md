# Writing Tourwright scripts

A script describes a video. Tourwright turns it into an `.mp4` with narration, captions drawn on the
video, chapters, an `.srt`/`.vtt`, a thumbnail and a JSON manifest.

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
language: en                              # narration language (audio track, browser locale)
voice: lessac                             # see "Voices"
quality: hd                               # sd 854×480 · hd 1280×720 · fullhd 1920×1080 · vertical 1080×1920 · square 1080×1080
# device: iphone                          # film it as an iphone, iphone-se, android or ipad shows it (instead of quality)
scale: 1                                  # how big the page is drawn: 1 desktop (default), 2 phone (default on vertical)
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
| `title` | text, or `{ text, subtitle?, kicker?, animation?, background?, ms?, say? }` | Full-screen title card, animated (3.5 s by default). Starts a chapter. See [Title cards](#title-cards) |
| `say` | text, `{ caption?, speak?, ms? }` or `null` | Caption at the bottom, **narrated aloud**. `speak` is said instead of the caption when it must explain more. `null` clears it |
| `caption` | text or `null` | Caption without narration |
| `chapter` | text | Starts a chapter here with nothing on screen: in the chapters of the video and as a section of the guide |
| `click` | target | Moves the cursor smoothly to the element and clicks |
| `dblclick` | target | Same, with a double click |
| `rightClick` | target | Same, with the right button |
| `hover` | target | Moves the cursor over the element |
| `check` / `uncheck` | target | Ticks or unticks a checkbox (or picks a radio button) |
| `drag` | `{ from, to }` | Drags an element and drops it on another |
| `type` | `{ target, text, delay?, clear? }` | Clicks a field and types letter by letter |
| `fill` | `{ target, text }` | Fills a field instantly |
| `press` | key | `Enter`, `Tab`, `Control+A`… |
| `select` | `{ target, value, search? }` | The cursor clicks the list, then the option is chosen. Works on a `<select>` and on lists of their own (React Select, MUI, Ant, a search box over a list): `search` is typed into the field the list brings, the wait for the results is cut from the video, and the option is picked by its text (or part of it). `value` can be a list, for multi-selects |
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
| `upload` | `{ target, files }` | The cursor clicks where the file goes (a hidden input's drop zone too), a drawn file chooser picks the files, and they go into the `<input type=file>` (the system's own chooser never shows in a recording) |
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

A field whose `<label>` is not linked to it (apps that wrap the input to add an icon) is still found by
`{ label: … }`: Tourwright tries the placeholder, the accessible name and the first field after that visible
text, and warns with the target that matches it directly. A value with a comma or a colon goes in quotes:
`{ placeholder: "Nombres, apellidos o celular" }`.

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

- Order on screen: the narration (and its caption) starts while the cursor glides to the element, and at the
  marked word the camera moves in and the focus appears. It holds until the narration ends plus `ms`
  (default 600; 150 with `click`), fades, and the camera pulls back. The next step starts while the focus
  fades, so a `type` into the field just focused begins as the voice stops, with no silence in between.
- Without a `{word}` the focus appears as the narration starts; without `say` it is silent.
- The zoom happens in the browser, so text stays sharp at any zoom (nothing is upscaled).
- The camera never goes closer than the element fits whole on screen: a wide field on a phone gets a gentler
  zoom than the one asked, and under 8 % there is no push in at all.
- After a zoomed focus the camera stays close: typing in that field or the click is seen up close, and the next
  zoomed focus glides there without pulling back. A title, a page opened with `goto`, a scroll, a highlight, a
  spotlight, a callout or a `zoom` step take it back to the whole page first.
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

### Invented data on screen

A video made on a real account shows real people. `mask` replaces them with invented data in the page itself,
so the screen stays natural (blur hides, mask replaces):

```yaml
mask:
  - email                                   # ana.perez@gmail.com → luis31@ejemplo.com
  - phone                                   # 300 555 1234 → 905 042 1655
  - id                                      # CC 1.023.456.789 → CC 7.144.349.251 (amounts like $ 1.250.000 stay)
  - date                                    # 05/11/1987 → 08/06/1984, 5 de noviembre de 1987, November 5, 1987…
  - { text: "Ana Pérez", as: "Laura Gómez" }
  - { pattern: "P-\\d{5}", as: "P-00000" }  # anything else, by regular expression
```

The same real value always becomes the same invented one, on every page, also in what loads later. Only what
is drawn changes: the app keeps working with the real data, and a field that can be edited keeps its real
value (a form would send the invented one; blur those). `examples/app.yaml` shows it on a customer table.

`date` also blurs every filled date field (`<input type="date">` and its kin), which keeps its real value. A
birth date or the issue date of an ID helps prove who someone is: without `date`, the review says when a filled
date field is seen in the video (`privacy`).

Steps still name the real text: `{ text: 1.200.000 - 1.600.000 }` finds the option even when the screen shows
it with other digits, and so do `wait: { text }`, `if: { text }` and the options of `select`.

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

### How big the page is drawn

`scale` decides how many CSS pixels the page gets: `width / scale`, drawn at that density, so the video stays
sharp. The app picks its layout from that width.

| | Video | Page (CSS) | Layout |
|---|---|---|---|
| `quality: hd` (default `scale: 1`) | 1280×720 | 1280×720 | desktop |
| `quality: vertical` (default `scale: 2`) | 1080×1920 | 540×960 | phone, filling the screen |
| `quality: vertical`, `scale: 2.75` | 1080×1920 | 393×698 | an iPhone |
| `quality: fullhd`, `scale: 1.5` | 1920×1080 | 1280×720 | desktop, everything bigger |

Raise it when the app looks small with empty space around it; lower it when the page does not fit. With
`--capture screen` (Xvfb) the page is always drawn at 1×: `auto` uses a screencast for any other scale.

`device` films the app as a real phone or tablet shows it, without working out a `scale`: the device's width in CSS
pixels, its browser (user agent, touch, `pointer: coarse`, mobile layout) and a video in its shape. An app that
serves another page to phones, or hides a menu behind a tap, shows that version.

| `device` | Page (CSS) | Video, unless `quality`/`width`/`height` choose one |
|---|---|---|
| `iphone` | 393 px wide (iPhone 15) | 1080×1920 |
| `iphone-se` | 320 px | 1080×1920 |
| `android` | 412 px (Pixel 7) | 1080×1920 |
| `ipad` | 810 px (iPad) | 1080×1440 |

```yaml
device: iphone      # the scale comes from the device; `scale` still wins when set
```

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

### Title cards

A title card comes in with an animation and has something behind it. The same options work on a `title` step
and on a slide with `title`; the theme sets the defaults for the whole video.

```yaml
  - title:
      text: Your first invoice
      subtitle: Step by step, in two minutes
      kicker: Tutorial · 2 min     # a small label above the title
      animation: rise              # how it comes in
      background: aurora           # what is behind it
```

| `animation` | How the title comes in |
|---|---|
| `rise` (default) | The logo pops in, the words come up one by one, the accent line draws itself, the subtitle follows |
| `type` | Letter by letter, with a caret that follows the text and blinks at the end |
| `zoom` | Everything comes into focus, from big and blurred |
| `split` | Aligned to the left: the title comes from the left and the subtitle from the right |
| `fade` | The card simply fades in |

| `background` | Behind the title |
|---|---|
| `gradient` (default) | The theme's `gradient` |
| `aurora` | Soft lights in the accent color that drift slowly |
| `grid` | A grid in the accent color that moves slowly, fading at the edges |
| `page` | The page itself, blurred and darkened (walkthroughs; slides use the gradient) |

```yaml
theme: { accent: "#22C55E", titleAnimation: split, titleBackground: grid }
```

Cards leave with a short blur. In slides the animation is drawn frame by frame, so it is smooth on any machine.

### Studio frame

`theme.frame: window` puts a walkthrough inside a browser window, with rounded corners, a soft shadow and the
video's title in its bar, on a wallpaper of lights in the theme colors. It is drawn when the video is encoded:
the page is recorded as usual, so targets, zoom and captions do not change. Pair it with an `accent` from the
app's own palette, `titleBackground: aurora` and `zoom` on the focus steps for a finished, studio look.

```yaml
theme: { frame: window, accent: "#3B82F6", titleBackground: aurora }
```

Each slide stays on screen while its narration lasts (plus a short margin), or `duration` seconds if longer.
Slides with `title` and no image start a chapter; `chapter` names one explicitly.

## Voices and how they speak

With no `voice` in the script, on the command line (`--voice`) or in your settings (`tourwright config set voice`),
each render picks the most natural voice it has **for the script's `language`**: Pocket TTS when it is installed
(offline), else Microsoft's neural voices when they answer (internet: `salome` in Spanish, `ava` in English and
the other languages), else Piper (offline everywhere, more synthetic). `tourwright voices` says which one it is on
this machine.

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

**Listen before choosing.** A sample of every voice is in [`docs/voices/`](voices/) (the same text: tech words,
numbers, a question), so you can choose before installing anything: `tourwright voices --open` opens them.
`tourwright voices --samples` records them on your machine, and `--text "…"` with your own words. Then write
the name in the script: `voice: lola`.

**How they were tuned.** Every built-in voice read sentences full of what narrations hold (API, JSON, PDF,
`25.800`, `95 %`, `$ 409.360`, an email, Ctrl K…) and a speech-to-text model wrote down what it heard. Each term
was said written several ways (as is, respelled, spelled out) and the one understood best was kept for each
engine, in `src/voice/calibrated.json`: neural voices (Edge, Pocket TTS) say most English words right as
written, Piper needs more respellings. If a voice still says a word wrong, `pronounce` fixes it in your script.

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
| `default` | Clear and close: warmth, presence where the consonants are, softer "s", gentle compression, no room |
| `clean` | The voice as the engine made it, at even loudness |
| `warm` | Closer and rounder |
| `radio` | Telephone band, compressed |
| `podcast` | Dense and upfront, with a hint of room |
| `none` | No processing, not even the leveling |

Every preset but `none` levels each sentence on its own: it is measured, then brought to -16 LUFS (the web and
podcast standard, peaks under -1.5 dB) with a plain gain, so every sentence is as loud as the others and nothing
swells in the pauses.

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
    captions.srt  .vtt    subtitles for YouTube or a translation (the video already shows them; named
                          apart so players do not draw them a second time)
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

Subtitles, poster and manifest always come. `--quality` picks the size: `sd`, `hd` (default; yours with `tourwright config set quality`), `fullhd`,
`vertical` (1080×1920, for phones and reels) or `square`.

A vertical video is filmed the way a phone shows the app: the page is 540 CSS pixels wide at twice the density,
so the app uses its own mobile layout, big and sharp, and the frames still come out at 1080×1920. Captions and
titles grow, and the captions sit above the bottom of the screen that Reels, Shorts and TikTok cover with their
own buttons. (With `--capture screen`, the virtual display draws at 1×: there the page keeps the full width.)

## Testing a script

```bash
tourwright validate video.yaml          # the format, without running it (blocks and variables expanded)
tourwright validate video.yaml --no-vars  # only the format and the names: no --var nor secrets needed
tourwright render video.yaml --dry-run  # runs every step fast, no voice or video: tests the selectors
tourwright render video.yaml --safe     # a dry run that presses, types and chooses nothing
tourwright explore video.yaml           # logs in like the script and lists each page's targets
```

`--dry-run` presses the buttons: on a real app it signs people up and sends codes like a recording does.
`--safe` finds every element and checks it could be used (visible, still, enabled, nothing on top), but performs
no click, typing, choice, upload, key or plugin step. Steps that only exist after one of those (the next page
after a login) are listed as not checked, not as failures. The off-camera `setup` (a login) still runs, as it must to reach the
pages; a saved `session` avoids even that.

When several elements match a target, the one with exactly those words wins over a longer text that contains
them, and a visible one over a hidden copy (the same link in a closed mobile menu). If it is still ambiguous,
the first is used and the review says so (`ambiguous`): add `exact: true`, `nth` or `css` to choose. A step
that clicks waits until its element can be clicked (not moving, enabled, nothing on top), and when it never
can, the error says why: `the link named "Pagar" is there but cannot be used (<div class="loader"> intercepts pointer events)`.

When a step fails, Tourwright saves a screenshot of the page (`failure-<name>.png`) next to the output, and the
error names the element it looked for and what the page offers instead, as targets to paste:

```text
step 3 (type): cannot find the field labelled "Clave"
    on this page (https://app.example.com/login): { placeholder: Tu usuario o tu correo } · { label: Contraseña } · { role: button, name: Ingresar }
```

A dry run waits 5 s for each element (a recording waits 30 s) and does not stop at the first missing one: it
goes to the end and lists every step that failed. The screenshot marks every field, button and link the page
has, each with the target that finds it.

### When the site changed: check and fix

```bash
tourwright check videos/*.yaml                # every script, in seconds: what broke and the likely fix
tourwright check videos/*.yaml --report r.md  # the same as Markdown (exit code 1 when one broke)
tourwright fix videos/login.yaml              # the new target for each broken step
tourwright fix videos/login.yaml --write      # …and saves them in the file, keeping its comments
```

`fix` proposes the element of the same kind whose text is closest to the old one (accents, case and filler
words aside), or the only one of its kind on the page ("Entrar" became "Ingresar"). It writes the new target
wherever the old one is written, also inside `blocks`. In GitHub Actions, `check` also fills the job summary,
so a deploy that breaks a video says which one and at which step:

```yaml
- run: npx tourwright check videos/*.yaml
```

Agents get the same with the MCP tool `tourwright_check`, which also returns the fixed script.

### One step at a time

```bash
tourwright render video.yaml --step 7      # films step 7 with its voice; steps 1–6 run fast off camera
tourwright render video.yaml --step 7-9
```

The preview is saved as `<name>-step7.mp4`, next to the full video, which it never replaces.

### From doing the tour to the video, in one command

```bash
tourwright record https://app.example.com/login --out tour.yaml
```

A browser window opens: do the tour by hand and close it. You get the script **and the narrated video**, with
nothing to write: the user and password you typed are saved as secrets (encrypted on this machine, never in the
script), the AI rewrites the narration when one is set up (below), and the video has the studio look: the app
in a window in its own main color, a gentle zoom on each field, a pulse on the button that saves or sends and a
closing card. `--no-video` stops after the script, to edit it first; `--plain` leaves out the studio look. A
login with a 2FA code needs the authenticator key once (`tourwright secret set FACTURERO_TOTP`): the code you typed
is no longer valid.

No programming: each click, field and choice becomes
a step with a stable target (role and name, label, placeholder — what a screen reader says about it) and a
first narration that knows where the element is:

```yaml
  - chapter: Iniciar sesión
  - focus: { target: { placeholder: Tu usuario o tu correo }, say: "Escribe tu {usuario o tu correo}." }
  - type: { target: { placeholder: Tu usuario o tu correo }, text: "${secret:FACTURERO_USER}" }
  - focus: { target: { label: Código de verificación }, say: "Escribe el {código} de tu aplicación de autenticación." }
  - type: { target: { label: Código de verificación }, text: "${totp:FACTURERO_TOTP}" }
  - chapter: Clientes
  - focus: { target: { role: link, name: Facturas }, say: "Abre {Facturas} en el menú.", click: true }
  - focus: { target: { placeholder: Documento o celular }, say: "Para buscar, escribe en {documento o celular}." }
```

- A menu link is "opened in the menu", a search field "searched in", a Save or Upload button "pressed when
  everything is ready", a tab "switched to". `--language en` writes it in English.
- Each screen starts a `chapter`: the video gets its chapters, and the guide its sections.
- The user and the password of a login become `${secret:…}`, a 2FA code `${totp:…}`: nobody's account is in
  the script, and it works for whoever has the secrets saved.

The narration is correct but plain: rewrite it in your own words, let your AI rewrite it (below), or let an agent
do it through MCP.

### Narration written by your AI

Tourwright does not ship an AI: it connects to the one you bring, as it does with voices.

```bash
tourwright config set ai anthropic        # Claude (key: ANTHROPIC_API_KEY, or tourwright secret set AI_KEY;
                                          #   once: npm install -g @anthropic-ai/sdk, already in the Docker image)
tourwright config set ai openai           # OpenAI, or any OpenAI-compatible server: also set aiUrl
tourwright config set ai ollama           # free, on this PC, nothing leaves it: ollama pull gemma3
tourwright narrate tour.yaml              # shows the new line for each step
tourwright narrate tour.yaml --write      # saves them (the old script is kept as tour.before-narrate.yaml)
```

The script runs fast and the AI gets the steps in order with a picture of each one, so it writes from what the
screen shows ("Para encontrar a un cliente, escribe su documento, su nombre o su celular") instead of from the
element's name. Every line is checked before it is proposed: the `{word}` the focus lands on stays (put back
around the element's name when the AI drops the braces), and a line that holds a secret, a password or a code is
refused and the old one stays. Lines written with `{{variables}}` are never touched. `aiModel` picks the model
(default `claude-opus-5-5`, `gpt-4o-mini`, `gemma3`); a model that sees pictures writes better narration.

### The same video in another language

```bash
tourwright translate tour.yaml --to en    # writes tour.en.yaml (es, en, pt, fr, de, it)
tourwright render tour.en.yaml
```

Your AI (the same as `narrate`) translates what the viewer reads or hears: narration, captions, title cards,
bubbles and callouts. The targets stay as they are, because the app keeps its own language, and so does what is
typed into it. `{{variables}}`, `${secrets}`, HTML tags and the `{marked}` word come back as they were; a line
where the AI changed one stays in the original language, and the command lists it. The new script has the new
`language`, no fixed `voice` (the render picks a natural one for it) and none of the old pronunciations. Comments
are kept.

### A step-by-step guide from the same script

```bash
tourwright guide tour.yaml --open
```

Runs the script fast and, before each action, captures the page with the element marked. The narration becomes
the text of each numbered step, chapters and title cards become sections, and what was typed is shown as an
example (never a secret or a code). You get `tour.guide.html` — one file with its pictures inside, to send, put
in a help center or print as PDF — and `tour.guide.md` with its pictures in `tour.guide/`.

### The review of every video

While a video is filmed and once it is finished, Tourwright looks for what a viewer would notice. Each finding is
printed with its step and saved under `review` in the video's `.json` manifest; none of them stops the render.

| `kind` | What it means | What usually fixes it |
|---|---|---|
| `page-error`, `http` | A JavaScript error, or a 5xx answer, on the page | The app, or the data the tour uses |
| `no-effect` | A click that changed nothing | The right target, or a `wait` before it |
| `layout` | The page's text is too small to read (under about 1.1 % of the video height), or the page is wider than the video and its right side is cut off. Once per address | `scale: 2` on a vertical video, or the app's mobile layout ([How big the page is drawn](#how-big-the-page-is-drawn)) |
| `caption` | The caption covers the element shown, even moved to the top of the screen | A smaller target, or a shorter caption |
| `blank` | A blank or black screen for more than a second | A `wait` for the content |
| `silence` | 6 s or more with nothing to hear, in a narrated video | A slow page or search filmed whole: a `wait` (always cut from the video), or a shorter `ms` |
| `loudness` | A sentence more than 4 LU quieter or louder than the narration (-16 LUFS), with its text | A `volume` in the step, or loud music over it |
| `clipping` | A true peak over -1 dBFS, with its second | A loud sound file, or `audio.effects` lower |
| `privacy` | A filled date field seen in the video | `mask: [date]`, or `blur` it |
| `ambiguous` | A target whose words match several elements; the first one was used | `exact: true`, `nth` or `css` |

Every sentence of narration is leveled on its own to -16 LUFS (measured, a linear gain, a true-peak limiter only
where a peak needs it, measured again), and the whole mix goes through a true-peak limiter at the end. Clicks and
typing made off camera (`offCamera`, waits, before the first title) are left out, instead of piling up where the
video jumps.

### Making a video again without the browser

On a real app, filming does real things: a sign-up, an SMS, a request. To change the sound, a caption or a
blur without doing them again, render with `--keep`:

```bash
tourwright render video.yaml --keep           # also videos/video/video.source/: recording, voices, timeline.json
tourwright recompose videos/video --no-clicks # the same video without click and typing sounds
tourwright recompose videos/video --voice salome --polish warm
```

`timeline.json` can be edited before `recompose`: the text of a caption, the `text` of a sentence (it is said
again with its voice), and `blurs`, boxes of the final video blurred between two of its seconds. `steps` says
when each step starts, in seconds of the video:

```json
"blurs": [{ "x": 120, "y": 340, "width": 260, "height": 48, "start": 31.5, "end": 44 }]
```

The recording is kept as filmed: what was not masked on the page can only be blurred, not replaced.
