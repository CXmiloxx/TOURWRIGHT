// A small zip writer (deflate, no streaming): enough for a Word file, without a dependency.
import zlib from 'node:zlib'

// CRC-32 of the zip format: Node's own when it has it (22.2+), else this table
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
/** @param {Buffer} data */
export const crc32 = data => {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(data) >>> 0
  let c = 0xffffffff
  for (const byte of data) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * The files as one zip archive. Pictures that are already compressed (JPEG) are stored as they are.
 * @param {{ name: string, data: Buffer | string }[]} files
 * @returns {Buffer}
 */
export const zip = files => {
  const parts = []
  const central = []
  let offset = 0
  // A fixed date (1 Jan 2024): the same guide gives the same bytes
  const time = 0
  const date = ((2024 - 1980) << 9) | (1 << 5) | 1
  for (const { name, data } of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const store = /\.(jpe?g|png)$/i.test(name)
    const body = store ? raw : zlib.deflateRawSync(raw)
    const crc = crc32(raw)
    const fileName = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // names in UTF-8
    local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    local.writeUInt16LE(0, 28)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(store ? 0 : 8, 10)
    entry.writeUInt16LE(time, 12)
    entry.writeUInt16LE(date, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(fileName.length, 28)
    entry.writeUInt32LE(offset, 42)
    parts.push(local, fileName, body)
    central.push(entry, fileName)
    offset += local.length + fileName.length + body.length
  }
  const size = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}
