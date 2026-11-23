// The site's own brand, read from its first page when the script gives no colors: so title cards, captions, the
// cursor and the studio window wear the site's colors instead of Tourwright's, and nobody has to pick them by hand.
// Background and text from the page, the accent from what the site says its brand color is (theme-color, the
// --primary / --accent of its design system) or else its most colorful button, and the font of its text.

/**
 * What the page says its brand is, in plain colors (#rrggbb) and a font stack; fields it cannot tell are left out.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ background?: string, text?: string, accent?: string, font?: string }>}
 */
export const readBrand = page =>
  page
    .evaluate(() => {
      const probe = document.createElement('i')
      document.body.appendChild(probe)
      // Any CSS color (named, rgb, hsl, oklch…) as #rrggbb, or null when it is transparent or not a color
      const hex = value => {
        if (!value) return null
        probe.style.color = ''
        probe.style.color = value
        if (!probe.style.color) return null
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.fillStyle = getComputedStyle(probe).color
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
        return a < 200 ? null : `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
      }
      // A design system's variable: a color, or bare HSL numbers (shadcn: "222 47% 11%")
      const variable = name => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
        if (!raw) return null
        return hex(raw) ?? hex(`hsl(${raw.replace(/\s+/g, ' ')})`) ?? hex(`hsl(${raw.split(/\s+/).join(',')})`)
      }
      const saturation = color => {
        const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16) / 255)
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        return max === 0 ? 0 : (max - min) / max
      }
      const backgroundOf = el => {
        for (let e = el; e; e = e.parentElement) {
          const c = hex(getComputedStyle(e).backgroundColor)
          if (c) return c
        }
        return null
      }
      const background = backgroundOf(document.body) ?? '#ffffff'
      const text = hex(getComputedStyle(document.body).color)
      // The brand color: what the site declares first, else the most colorful button or call to action in view
      let accent = [hex(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')), variable('--primary'),
        variable('--brand'), variable('--accent'), variable('--color-primary')].find(c => c && c !== background && saturation(c) > 0.18)
      if (!accent) {
        const buttons = [...document.querySelectorAll('button, a, [role=button]')].filter(e => {
          const r = e.getBoundingClientRect()
          return r.width > 40 && r.height > 20 && r.top < innerHeight * 1.5
        })
        accent = buttons.map(e => hex(getComputedStyle(e).backgroundColor)).filter(c => c && c !== background && saturation(c) > 0.18)
          .sort((a, b) => saturation(b) - saturation(a))[0]
      }
      // The body's font: captions and titles stay easy to read (a display face is for headings only)
      const font = getComputedStyle(document.body).fontFamily
      probe.remove()
      return Object.fromEntries(Object.entries({ background, text, accent, font }).filter(([, v]) => v))
    })
    .catch(() => ({}))
