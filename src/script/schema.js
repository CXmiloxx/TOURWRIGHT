// The declarative script format (JSON or YAML). It is what agents and the HTTP API use: data, not code.
//
// Two kinds of video:
//   type: browser  a walkthrough of a website: a real browser, a cursor, captions and narration
//   type: slides   a narrated slideshow: title cards, images and HTML, no website needed
//
// A step is an object with exactly one action key: { click: "#buy" }, { say: "Hello" }…
import { z } from 'zod'

// How to find an element. A string is a Playwright selector (CSS, `text=…`, `xpath=…`); the object forms
// are the robust ones (by role and accessible name, label, placeholder, visible text or test id).
const target = z.union([
  z.string().min(1),
  z.object({
    css: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    testId: z.string().optional(),
    exact: z.boolean().optional(),
    nth: z.number().int().optional(),
  }).strict().refine(o => o.css || o.role || o.text || o.label || o.placeholder || o.testId, 'a target needs css, role, text, label, placeholder or testId'),
])

const ms = z.number().int().min(0).max(600_000)

const targetWith = extra => z.union([target, z.object({ target, ...extra }).strict()])

// How a line is spoken. Every engine understands them: what it cannot do natively, ffmpeg does.
const prosody = {
  voice: z.string().min(1).max(200).optional().describe('Voice for this line: a name from `voices`, an alias or engine:id'),
  rate: z.string().regex(/^[+-]?\d{1,3}(\.\d+)?%$/).optional().describe('Speed: -20% slower, +15% faster'),
  pitch: z.string().regex(/^[+-]?\d{1,3}(\.\d+)?(%|st|Hz)$/).optional().describe('Pitch: +2st (semitones), -5%, +10Hz'),
  volume: z.string().regex(/^[+-]?\d{1,3}(\.\d+)?(%|dB)$/).optional().describe('Loudness: +3dB, -20%'),
  style: z.string().max(300).regex(/^[^&=?]*$/).optional().describe('How to say it, for engines that take instructions (openai): "cheerful and calm"'),
}

// A short sound: a built-in one (click, pop, ding, whoosh) or a file next to the script / a job asset.
const sound = z.union([
  z.string().min(1),
  z.object({ file: z.string().min(1), volume: z.number().min(0).max(2).optional(), wait: z.boolean().optional() }).strict(),
])

const condition = {
  visible: target.optional().describe('An element is visible'),
  text: z.string().optional().describe('A text is visible'),
  url: z.string().optional().describe('The URL contains this'),
  timeout: ms.optional().describe('Wait up to this long for the condition (default: check once)'),
}

export const STEPS = {
  goto: z.string().min(1).describe('Open a URL or a path relative to baseUrl'),
  title: z.union([z.string(), z.object({ text: z.string(), subtitle: z.string().optional(), ms: ms.optional(), say: z.string().optional(), ...prosody }).strict()])
    .describe('Full-screen title card; also starts a chapter'),
  say: z.union([z.string(), z.null(), z.object({ caption: z.string().optional(), speak: z.string().optional(), ms: ms.optional(), ...prosody }).strict()])
    .describe('Caption at the bottom, narrated aloud. `speak` is said instead of the caption when it must explain more; voice, rate, pitch, volume and style change how. null clears it'),
  caption: z.union([z.string(), z.null()]).describe('Caption without narration; null clears it'),
  click: targetWith({}).describe('Move the cursor to an element and click it'),
  dblclick: targetWith({}).describe('Move the cursor to an element and double-click it'),
  rightClick: targetWith({}).describe('Move the cursor to an element and right-click it'),
  hover: target.describe('Move the cursor over an element'),
  check: target.describe('Tick a checkbox or radio button'),
  uncheck: target.describe('Untick a checkbox'),
  drag: z.object({ from: target, to: target }).strict().describe('Drag an element and drop it on another'),
  type: z.object({ target, text: z.string(), delay: z.number().int().min(0).max(1000).optional(), clear: z.boolean().optional() }).strict()
    .describe('Click a field and type letter by letter'),
  fill: z.object({ target, text: z.string() }).strict().describe('Fill a field instantly'),
  press: z.string().describe('Press a key: Enter, Tab, Control+A…'),
  select: z.object({ target, value: z.union([z.string(), z.array(z.string())]) }).strict().describe('Choose an option of a <select>'),
  highlight: targetWith({ ms: ms.optional() }).describe('Draw a frame around an element'),
  spotlight: targetWith({ ms: ms.optional() }).describe('Dim everything except an element'),
  focus: z.object({
    target,
    text: z.string().optional().describe('Bubble next to the element; may have <b>'),
    say: z.string().optional().describe('Narration (and caption). {word} marks the word the focus lands on: "Then press {Pay}."'),
    caption: z.string().optional().describe('Caption to show instead of the narration'),
    step: z.string().max(16).optional().describe('Badge in the bubble, like "3/5"'),
    zoom: z.number().min(1).max(3).optional().describe('Camera zoom on the element (1.3 is a gentle push in)'),
    pulse: z.boolean().optional().describe('A ring that pulses around the element'),
    click: z.boolean().optional().describe('Click the element when the focus ends'),
    ms: ms.optional().describe('How long the focus stays after the narration ends (default 1200)'),
    position: z.enum(['auto', 'top', 'bottom', 'left', 'right']).optional(),
    ...prosody,
  }).strict()
    .describe('Onboarding-style focus: dims everything but the element, rings it, explains it in a bubble and zooms in, timed to the narration'),
  callout: z.object({ target, text: z.string().min(1), ms: ms.optional(), position: z.enum(['auto', 'top', 'bottom', 'left', 'right']).optional() }).strict()
    .describe('A speech bubble pointing at an element'),
  zoom: targetWith({ ms: ms.optional(), scale: z.number().min(1).max(4).optional() }).describe('Zoom the camera into an element and back'),
  scrollTo: target.describe('Scroll smoothly until an element is centered'),
  scroll: z.number().describe('Scroll by this many pixels (negative = up)'),
  cursor: z.enum(['show', 'hide']).describe('Show or hide the animated cursor'),
  back: z.union([z.literal(true), z.null()]).describe('Go back to the previous page'),
  reload: z.union([z.literal(true), z.null()]).describe('Reload the page'),
  pause: ms.describe('Let the viewer look'),
  sound: sound.describe('Play a sound: click, pop, ding, whoosh or a file; { file, volume, wait }'),
  wait: z.union([ms, z.object({ target: target.optional(), url: z.string().optional(), text: z.string().optional(), timeout: ms.optional(), state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional() }).strict()])
    .describe('Wait off camera (cut from the video): an element, a URL, a text or milliseconds'),
  blur: z.union([target, z.array(target)]).describe('Blur personal data from now on'),
  upload: z.object({ target, files: z.union([z.string(), z.array(z.string())]) }).strict().describe('Put files in an <input type=file> (paths relative to the script or job assets)'),
  offCamera: z.lazy(() => z.array(step)).describe('Steps that happen but are cut from the video'),
  if: z.lazy(() => z.object({ ...condition, then: z.array(step), else: z.array(step).optional() }).strict()
    .refine(c => c.visible || c.text || c.url, 'if needs visible, text or url'))
    .describe('Run steps only when an element, a text or a URL is there (a cookie banner, an optional dialog…)'),
  try: z.lazy(() => z.union([z.array(step), z.object({ steps: z.array(step), timeout: ms.optional() }).strict()]))
    .describe('Steps that may fail without stopping the video; each one waits at most `timeout` ms (default 3000)'),
  use: z.union([z.string(), z.object({ block: z.string(), with: z.record(z.string(), z.unknown()).optional() }).strict()])
    .describe('Insert the steps of a block from `blocks`, with optional variables'),
  repeat: z.lazy(() => z.object({ times: z.number().int().min(1).max(500).optional(), each: z.array(z.unknown()).max(500).optional(), as: z.string().regex(/^\w+$/).optional(), steps: z.array(step) }).strict()
    .refine(r => r.times || r.each, 'repeat needs times or each'))
    .describe('Repeat steps `times` times, or once per item of `each` ({{index}}, {{item}} or the name in `as`)'),
}

// Steps added by plugins: name → { run }. Their schemas join STEPS.
export const PLUGIN_STEPS = new Map()

export const step = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  const keys = Object.keys(value)
  if (keys.length !== 1) return ctx.addIssue({ code: 'custom', message: `a step has exactly one action, got ${keys.length ? keys.join(', ') : 'none'} (actions: ${Object.keys(STEPS).join(', ')})` })
  const [action] = keys
  const schema = STEPS[action]
  if (!schema) return ctx.addIssue({ code: 'custom', message: `unknown action "${action}" (actions: ${Object.keys(STEPS).join(', ')})` })
  const r = schema.safeParse(value[action])
  if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: [action, ...issue.path] })
})

const common = {
  title: z.string().max(200).optional().describe('Video title (metadata and manifest)'),
  language: z.string().max(10).optional().describe('Language of the narration: es, en, pt… (subtitle track)'),
  voice: z.string().optional().describe('engine:id or alias. See `tourwright voices`'),
  quality: z.enum(['sd', 'hd', 'fullhd', 'vertical', 'square']).optional(),
  width: z.number().int().min(320).max(3840).optional(),
  height: z.number().int().min(320).max(3840).optional(),
  fps: z.number().int().min(10).max(60).optional(),
  theme: z.object({
    accent: z.string().optional(), background: z.string().optional(), text: z.string().optional(),
    gradient: z.string().optional(), font: z.string().optional(), logo: z.string().optional(),
  }).strict().optional().describe('Colors, font and logo of title cards, captions and cursor'),
  voices: z.record(z.string().regex(/^[\w-]+$/), z.string().min(1).max(200)).optional()
    .describe('The cast: names for the voices of this script, { ana: salome, guide: "piper:es_MX-claude-high?rate=-5%" }'),
  pronounce: z.record(z.string().min(1).max(100), z.string().max(200)).optional()
    .describe('How to say words the voice reads wrong: { SaaS: sas, CRM: ce erre eme }. Captions keep the original'),
  audio: z.object({
    polish: z.enum(['default', 'clean', 'warm', 'radio', 'podcast', 'none']).optional().describe('Sound of the narration'),
    pause: z.number().min(0).max(3).optional().describe('Seconds of silence between sentences'),
    clicks: z.union([z.boolean(), z.string()]).optional().describe('A click sound on every click (true, or a sound file)'),
    typing: z.boolean().optional().describe('Keyboard sound while typing'),
    effects: z.number().min(0).max(2).optional().describe('Volume of sound effects (1 = as recorded)'),
  }).strict().optional(),
  music: z.union([z.string(), z.object({
    file: z.string(), volume: z.number().min(0).max(1).optional(), duck: z.boolean().optional(),
    fadeIn: z.number().min(0).max(30).optional(), fadeOut: z.number().min(0).max(30).optional(),
  }).strict()]).optional().describe('Background music file (looped and lowered under the voice)'),
  vars: z.record(z.string().regex(/^\w+$/), z.unknown()).optional().describe('Variables: {{name}} in any text is replaced with its value'),
}

const browser = z.object({
  type: z.literal('browser').optional(),
  ...common,
  baseUrl: z.string().optional().describe('Relative paths in goto resolve against it. Local scripts may use a folder next to them ("./site/"): pages without a server'),
  session: z.string().regex(/^[\w.-]+$/).optional().describe('Name of a saved browser session (cookies) reused between renders'),
  setup: z.array(step).optional().describe('Steps run off camera before recording (log in…). Skipped while `session` is still valid'),
  sessionCheck: z.object({ goto: z.string(), notUrl: z.string() }).strict().optional()
    .describe('How to know the saved session is valid: open `goto`; valid if the URL does not contain `notUrl`'),
  warmup: z.array(z.string()).optional().describe('Pages opened before recording so they load fast on camera'),
  hosts: z.record(z.string(), z.string().url()).optional().describe('Serve a hostname from another origin: { "app.example.com": "http://localhost:3000" }'),
  blur: z.array(target).optional().describe('Selectors blurred during the whole video'),
  blocks: z.record(z.string().regex(/^[\w-]+$/), z.array(step)).optional().describe('Reusable groups of steps, inserted with `use`'),
  steps: z.array(step).min(1),
}).strict()

const slide = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  image: z.string().optional().describe('Image path (relative to the script) or https URL'),
  html: z.string().optional().describe('Custom HTML for the slide'),
  caption: z.string().optional().describe('Text shown at the bottom'),
  say: z.string().optional().describe('Narration of this slide'),
  duration: z.number().min(0.5).max(600).optional().describe('Minimum seconds on screen (narration extends it)'),
  chapter: z.string().optional(),
  motion: z.enum(['none', 'zoom-in', 'zoom-out', 'pan']).optional().describe('Slow camera movement over the slide'),
  sound: sound.optional().describe('A sound when the slide appears'),
  ...prosody,
}).strict().refine(s => s.title || s.image || s.html || s.say, 'a slide needs title, image, html or say')

const slides = z.object({
  type: z.literal('slides'),
  ...common,
  transition: z.number().min(0).max(3).optional().describe('Crossfade seconds between slides'),
  slides: z.array(slide).min(1),
}).strict()

export const scriptSchema = z.union([slides, browser])

// Script types come from the schema: one source of truth for validation, editors and tsc.
/** @typedef {z.infer<typeof browser>} BrowserScript */
/** @typedef {z.infer<typeof slides>} SlidesScript */
/** @typedef {z.infer<typeof slide>} Slide */
/** @typedef {BrowserScript | SlidesScript} Script */

export const validateScript = data => {
  const schema = data?.type === 'slides' ? slides : browser
  const r = schema.safeParse(data)
  if (r.success) return { ok: true, script: r.data }
  return {
    ok: false,
    errors: r.error.issues.map(i => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`),
  }
}

// JSON Schema for editors and agents. Steps are spelled out as "one of these single-key objects",
// which zod cannot express on its own.
export const jsonSchema = () => {
  const toJson = s => z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' })
  const stepRef = { $ref: '#/$defs/step' }
  const steps = { type: 'array', items: stepRef }
  // Actions that hold steps: zod cannot point back to the step definition
  const nested = {
    offCamera: steps,
    if: { type: 'object', properties: { ...strip(toJson(z.object(condition))).properties, then: steps, else: steps }, required: ['then'], additionalProperties: false },
    try: { oneOf: [steps, { type: 'object', properties: { steps, timeout: { type: 'integer', minimum: 0 } }, required: ['steps'], additionalProperties: false }] },
    repeat: { type: 'object', properties: { times: { type: 'integer', minimum: 1, maximum: 500 }, each: { type: 'array' }, as: { type: 'string' }, steps }, required: ['steps'], additionalProperties: false },
  }
  const stepDef = {
    oneOf: Object.entries(STEPS).map(([action, s]) => ({
      type: 'object',
      description: s.description,
      properties: { [action]: nested[action] ?? strip(toJson(s)) },
      required: [action],
      additionalProperties: false,
    })),
  }
  const browserJson = strip(toJson(browser))
  browserJson.properties.steps.items = stepRef
  browserJson.properties.setup.items = stepRef
  browserJson.properties.blocks.additionalProperties = steps
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/CXmiloxx/tourwright/schema/script.schema.json',
    title: 'Tourwright script',
    oneOf: [{ ...strip(toJson(slides)), title: 'Slides video' }, { ...browserJson, title: 'Browser walkthrough' }],
    $defs: { step: stepDef },
  }
}

const strip = schema => {
  const { $schema, ...rest } = schema
  return rest
}
