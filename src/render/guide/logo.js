// The brand's logo in a document: its size read from the file (PNG, JPEG, WebP or SVG) so it keeps its shape,
// and drawn at a given height in the PDF's page header.

/** Width and height of a JPEG, from its frame header; null when it cannot be read */
export const jpegSize = buf => {
  let i = 2
  while (buf && i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null
    const marker = buf[i + 1]
    const length = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + length
  }
  return null
}

/** Width and height of a PNG, from its IHDR chunk */
const pngSize = buf => (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null)

/** Width and height of a WebP: lossy (VP8), lossless (VP8L) or extended (VP8X) */
const webpSize = buf => {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('latin1', 12, 16)
  if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  return null
}

/** Width and height of an SVG: its width/height attributes, else its viewBox */
const svgSize = text => {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
  const attr = name => Number.parseFloat(new RegExp(`\\s${name}="([\\d.]+)(px)?"`).exec(tag)?.[1] ?? '')
  const [w, h] = [attr('width'), attr('height')]
  if (w > 0 && h > 0) return { width: w, height: h }
  const box = /viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/i.exec(tag)
  return box ? { width: Number(box[1]), height: Number(box[2]) } : null
}

/**
 * A logo given as a data URL: its type, bytes and size.
 * @param {string | null | undefined} dataUrl
 * @returns {{ type: 'png' | 'jpeg' | 'svg' | 'webp', bytes: Buffer, width: number, height: number } | null}
 */
export const readLogo = dataUrl => {
  const m = /^data:image\/(png|jpe?g|svg\+xml|webp)(;base64)?,(.*)$/is.exec(String(dataUrl ?? ''))
  if (!m) return null
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  const type = m[1].startsWith('svg') ? 'svg' : m[1].startsWith('png') ? 'png' : m[1] === 'webp' ? 'webp' : 'jpeg'
  const size = { svg: svgSize, png: pngSize, jpeg: jpegSize, webp: webpSize }[type](type === 'svg' ? bytes.toString('utf8') : bytes)
  return size && size.width > 0 && size.height > 0 ? { type, bytes, ...size } : null
}

/**
 * The logo `height` px tall in a page header, as CSS: an @page box takes no width or height, so the picture is
 * given a density (image-set) that draws it at that size, and as sharp as its pixels allow.
 * @param {string} dataUrl @param {number} height  in CSS px
 * @returns {string | null}  a CSS image, or null when the logo cannot be read
 */
export const headerImage = (dataUrl, height) => {
  const logo = readLogo(dataUrl)
  const url = logoUrl(dataUrl)
  if (!logo || !url) return null
  return logo.type === 'svg' ? `url("${url}")` : `image-set(url("${url}") ${(logo.height / height).toFixed(3)}x)`
}

/**
 * The logo written again as base64 from its own bytes: only letters, digits, `+`, `/` and `=` reach the page,
 * so a logo cannot close the CSS or HTML around it. Anything but a picture that can be read (a URL, a file
 * the document would have to fetch) is left out.
 * @param {string | null | undefined} dataUrl
 * @returns {string | null}
 */
export const logoUrl = dataUrl => {
  const m = /^data:image\/(png|jpe?g|svg\+xml|webp)(;base64)?,(.*)$/is.exec(String(dataUrl ?? ''))
  if (!m) return null
  let bytes
  try {
    bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  } catch {
    return null
  }
  return `data:image/${m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()};base64,${bytes.toString('base64')}`
}
