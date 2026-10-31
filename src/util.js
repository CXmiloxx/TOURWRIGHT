// Small helpers shared by every module: processes, paths, hashing, logging.
import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

export const run = promisify(execFile)
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const hash = (text, length = 16) => createHash('sha1').update(text).digest('hex').slice(0, length)
export const newId = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`

export const isWindows = process.platform === 'win32'

// Windows finds `ffmpeg` as ffmpeg.exe (or .cmd, .bat… as PATHEXT says); elsewhere the name is the file.
const executableNames = name => {
  if (!isWindows || extname(name)) return [name]
  const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
  return [...exts.map(e => name + e.toLowerCase()), name]
}

const isExecutable = file => {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// First executable named `name` found in PATH (or null).
export const which = name => {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const file of executableNames(name)) if (isExecutable(join(dir, file))) return join(dir, file)
  }
  return null
}

// True when `path` is `dir` or inside it, whatever the platform's separator.
export const isInside = (path, dir) => {
  const rel = relative(resolve(dir), resolve(path))
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel))
}

// A line of an ffmpeg concat list: a quote in the path is escaped, and Windows paths use forward slashes
// (ffmpeg takes them, and a backslash is never mistaken for an escape).
export const concatEntry = file => `file '${(isWindows ? file.replaceAll('\\', '/') : file).replaceAll("'", "'\\''")}'`

// First candidate that exists: an explicit path, a name looked up in PATH, or a fallback location.
export const findBinary = (...candidates) => {
  for (const c of candidates.flat()) {
    if (!c) continue
    if (isAbsolute(c) || c.includes('/') || c.includes('\\')) {
      const found = executableNames(c).find(f => existsSync(f))
      if (found) return found
    } else {
      const found = which(c)
      if (found) return found
    }
  }
  return null
}

// Runs a command, feeding `input` to stdin. Rejects with stderr on a non-zero exit.
/** @param {string} command @param {string[]} args @param {string} input @param {{ timeout?: number, env?: NodeJS.ProcessEnv }} [options] */
export const runWithInput = (command, args, input, { timeout = 120_000, env = undefined } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], env })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('exit', code => {
      clearTimeout(timer)
      code === 0 ? resolve(undefined) : reject(new Error(`${command} exited with ${code}: ${stderr.trim().slice(-500)}`))
    })
    child.stdin.end(input)
  })

// Secret values a script used: every log line and error shown to the user has them replaced, so a password
// typed by a failing `fill` never ends up in a terminal, a job record or an API answer.
const hidden = new Set()
export const hideSecret = value => {
  if (typeof value === 'string' && value.length >= 3) hidden.add(value)
}
export const redact = text => {
  let s = String(text)
  for (const value of hidden) s = s.split(value).join('•••')
  return s
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }
const threshold = () => LEVELS[process.env.TOURWRIGHT_LOG_LEVEL ?? 'info'] ?? 20
// Logs go to stderr so stdout stays clean for machine-readable output (JSON, MCP stdio).
export const log = Object.fromEntries(
  Object.entries(LEVELS)
    .filter(([level]) => level !== 'silent')
    .map(([level, value]) => [
      level,
      (...parts) => {
        if (value < threshold()) return
        const msg = redact(parts.join(' '))
        if (process.env.TOURWRIGHT_LOG_FORMAT === 'json') {
          process.stderr.write(`${JSON.stringify({ level, time: new Date().toISOString(), msg })}\n`)
        } else {
          process.stderr.write(`[tourwright] ${level === 'info' ? '' : `${level}: `}${msg}\n`)
        }
      },
    ])
)

export const plainText = html =>
  String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

export const escapeHtml = text =>
  String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// A problem with the input (the script, a request, a setting) that the user can fix: never retried, shown
// as is. `status` is the HTTP status the API answers with; `code` a stable name clients can test.
export class UserError extends Error {
  /** @param {string} message @param {{ status?: number, code?: string }} [details] */
  constructor(message, { status = 400, code = 'invalid' } = {}) {
    super(message)
    this.name = 'UserError'
    this.status = status
    this.code = code
  }
}
