// Credentials for scripts. `tourwright secret set USER` asks for the value without echoing it and keeps it in
// one file of the user's own folder (TOURWRIGHT_HOME/secrets.json, readable only by its owner), so it never
// sits in the script, the shell history or a terminal. A script reads it as "${secret:USER}".
//
// The environment wins over the file: TOURWRIGHT_SECRET_USER=… is how a server or CI passes the same secret.
import { createHmac } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { sleep, UserError } from './util.js'

const PREFIX = 'TOURWRIGHT_SECRET_'

// "user", "USER" and "TOURWRIGHT_SECRET_USER" are the same secret
export const secretName = name => {
  const n = String(name ?? '').trim().toUpperCase().replace(new RegExp(`^${PREFIX}`), '')
  if (!/^[A-Z][A-Z0-9_]*$/.test(n)) throw new UserError(`"${name}" is not a secret name: letters, digits and _ (USER, PASSWORD, API_KEY)`)
  return n
}

/** @returns {Record<string, { value: string, savedAt: string }>} */
const read = file => {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new UserError(`${file} is damaged: delete it (tourwright forget) and set the secrets again`)
  }
}

// Only the owner can read it. On Windows the folder under the user profile is already private.
const write = (file, data) => {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
}

export const setSecret = (config, name, value) => {
  const n = secretName(name)
  if (!value) throw new UserError(`the value of ${n} is empty`)
  const data = read(config.secretsFile)
  data[n] = { value, savedAt: new Date().toISOString() }
  write(config.secretsFile, data)
  return n
}

/** @returns {string | undefined} */
export const getSecret = (config, name) => {
  const n = secretName(name)
  return process.env[PREFIX + n] ?? read(config.secretsFile)[n]?.value
}

// Names and where each comes from; never the values
export const listSecrets = config => {
  const saved = Object.entries(read(config.secretsFile)).map(([name, s]) => ({ name, source: 'saved', savedAt: s.savedAt }))
  const fromEnv = Object.keys(process.env).filter(k => k.startsWith(PREFIX) && k.length > PREFIX.length)
    .map(k => ({ name: k.slice(PREFIX.length), source: 'environment', savedAt: undefined }))
  return [...fromEnv, ...saved.filter(s => !fromEnv.some(e => e.name === s.name))].sort((a, b) => a.name.localeCompare(b.name))
}

export const deleteSecret = (config, name) => {
  const n = secretName(name)
  const data = read(config.secretsFile)
  if (!(n in data)) return false
  delete data[n]
  if (Object.keys(data).length) write(config.secretsFile, data)
  else rmSync(config.secretsFile, { force: true })
  return true
}

export const clearSecrets = config => {
  const count = Object.keys(read(config.secretsFile)).length
  rmSync(config.secretsFile, { force: true })
  return count
}

// Reads a value typed by the user without showing it. Piped input (`echo x | tourwright secret set X`)
// is read whole instead, so scripts and CI can use it too.
export const promptHidden = async (question, input = process.stdin, output = process.stderr) => {
  if (!input.isTTY) {
    let text = ''
    for await (const chunk of input) text += chunk
    return text.replace(/\r?\n$/, '')
  }
  output.write(question)
  input.setRawMode(true)
  input.resume()
  input.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let value = ''
    const done = (error, result) => {
      input.setRawMode(false)
      input.pause()
      input.off('data', onData)
      output.write('\n')
      if (error) reject(error)
      else resolve(result)
    }
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done(null, value)
        if (char === '\u0003') return done(new UserError('cancelled'))
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (char >= ' ') value += char
      }
    }
    input.on('data', onData)
  })
}

// Codes from an authenticator app (TOTP, RFC 6238): the secret is the key the site shows under its QR code
// ("can't scan it? enter this key"), saved like any other secret and written in a script as "${totp:NAME}".
// The code is made when it is typed, not when the script is loaded: it only lasts 30 seconds.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** @param {string} key  base32, spaces and case ignored */
export const totpKey = key => {
  const clean = String(key).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  if (!clean || [...clean].some(c => !BASE32.includes(c))) return null
  let bits = ''
  for (const c of clean) bits += BASE32.indexOf(c).toString(2).padStart(5, '0')
  return Buffer.from(bits.match(/.{8}/g)?.map(b => Number.parseInt(b, 2)) ?? [])
}

/** @param {string} key  base32 @param {number} [now]  ms */
export const totp = (key, now = Date.now()) => {
  const secret = totpKey(key)
  if (!secret?.length) throw new UserError('that secret is not an authenticator key (letters A-Z and digits 2-7)')
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const mac = createHmac('sha1', secret).update(counter).digest()
  const at = mac[mac.length - 1] & 0xf
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

// In a loaded script a code stands as a marker holding its key, until it is typed
const CODE = /⟦totp:([A-Z2-7]+)⟧/g
export const codeMarker = key => `⟦totp:${String(key).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')}⟧`

// The text with fresh codes. One about to expire is not typed: it waits for the next one.
export const withCodes = async (text, now = Date.now) => {
  if (typeof text !== 'string' || !text.includes('⟦totp:')) return text
  const left = 30_000 - (now() % 30_000)
  if (left < 4_000) await sleep(left + 200)
  return text.replace(CODE, (_, key) => totp(key, now()))
}
