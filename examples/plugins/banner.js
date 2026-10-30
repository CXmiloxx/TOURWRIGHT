// An example plugin: a `banner` action that shows a strip of text at the top of the page.
//
//   TOURWRIGHT_PLUGINS=./examples/plugins/banner.js tourwright render examples/features.yaml
//
//   - banner: New in version 2
//   - banner: { text: Beta, ms: 3000, color: "#7c3aed" }
export default {
  name: 'banner',
  steps: {
    banner: {
      description: 'A strip of text at the top of the page',
      // `z` is Tourwright's own zod: the step is validated (and appears in the JSON Schema) like a built-in one
      schema: z => z.union([
        z.string().min(1),
        z.object({ text: z.string().min(1), ms: z.number().int().min(0).max(60_000).optional(), color: z.string().regex(/^#[0-9a-f]{3,8}$/i).optional() }).strict(),
      ]),
      // `v` has the same helpers as JavaScript scripts; `dryRun` is true in rehearsals
      run: async (arg, { page, v }) => {
        const { text, ms = 2500, color = '#0ea5e9' } = typeof arg === 'string' ? { text: arg } : arg
        await page.evaluate(([text, color]) => {
          const b = document.createElement('div')
          b.id = 'tw-banner'
          // textContent, not innerHTML: arguments come from scripts, maybe from the API
          b.textContent = text
          Object.assign(b.style, {
            position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483646', padding: '14px', textAlign: 'center',
            font: '600 22px system-ui, sans-serif', color: '#fff', background: color, transform: 'translateY(-100%)', transition: 'transform .4s',
          })
          document.body.appendChild(b)
          requestAnimationFrame(() => (b.style.transform = 'none'))
        }, [text, color])
        await v.pause(ms)
        await page.evaluate(() => document.getElementById('tw-banner')?.remove())
      },
    },
  },
}
