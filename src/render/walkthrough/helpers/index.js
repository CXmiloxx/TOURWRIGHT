// The helpers `v` a filmed walkthrough runs on: steps.js calls them for declarative steps, and a JavaScript
// script gets them as its `v`. Each group lives in its own module; this one puts them together with what spans
// every step (the step being filmed, `dismiss`, the page hooks) and the Spanish names.
import { locate } from '#render/steps/index.js'
import { cameraHelpers } from './camera.js'
import { narrationHelpers } from './narration.js'
import { navigationHelpers } from './navigation.js'
import { pointerHelpers } from './pointer.js'

/**
 * @param {import('#render/walkthrough/stage.js').Stage} s
 * @param {{ blocker: { pending: (ms?: number) => Promise<import('playwright').Locator | null> }, progress: (p: Record<string, any>) => void, total: number }} options
 */
export const createHelpers = (s, { blocker, progress, total }) => {
  const { page, context, clock, script } = s
  /** @type {Record<string, any>} */
  const v = { page, context, dryRun: s.dryRun, safe: s.safe, step: undefined }
  Object.assign(v, navigationHelpers(s, v), narrationHelpers(s, v), pointerHelpers(s, v), cameraHelpers(s, v))
  // What goes wrong on the page, from a step (a target that matches several elements)
  v.note = finding => s.watcher.add(finding)
  // Which step is being filmed, for the CLI and the job's progress, and when it starts (for `--keep`)
  v.progress = step => {
    clock.stepStarts(step)
    progress({ stage: 'recording', step, steps: total })
  }
  // Spanish names for the helpers of JavaScript scripts
  Object.assign(v, { ir: v.goto, titulo: v.title, leyenda: (h, o) => v.say(h, o && typeof o === 'object' && 'dice' in o ? { ...o, speak: o.dice } : o),
    clic: v.click, escribir: v.type, resaltar: v.highlight, acercar: v.zoom, ocultar: v.blur, bajarHasta: v.scrollTo, fueraDeCamara: v.offCamera, subir: v.upload, elegir: v.select })

  // Before each step: whatever `dismiss` names is closed off camera, so the viewer never sees it
  // On a page it has not seen yet it also waits a moment, cut from the video: tours open just after the page.
  if (script.dismiss?.length) {
    let seen = ''
    v.beforeStep = async () => {
      let open = await blocker.pending()
      if (!open && page.url() !== seen) {
        seen = page.url()
        open = await v.offCamera(() => blocker.pending(1500))
      }
      if (open) await v.offCamera(async () => {
        await open.click().catch(() => {})
        await page.waitForTimeout(400)
      })
    }
  }

  // Elements blurred by a target (not a selector) are blurred again on every page; a hidden cursor stays hidden
  for (const t of (script.blur ?? []).filter(t => typeof t !== 'string')) {
    page.on('load', () => v.blur(locate(page, t)).catch(() => {}))
  }
  page.on('domcontentloaded', () => {
    if (s.state.cursorHidden) page.evaluate(() => document.documentElement.classList.add('tw-no-cursor')).catch(() => {})
  })
  return v
}
