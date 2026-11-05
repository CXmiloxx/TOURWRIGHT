// Getting files safely: downloads checked by size and hash, archives unpacked in a scratch folder on the same
// disk, commands run with their output shown.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isWindows, log, run, UserError } from '#core/util.js'
import { SHA256 } from './sources.js'

// A cut download leaves a file that looks fine but is not ("Protobuf parsing failed" for a voice): check
// the size against content-length, retry, and only then put the file in place. `sha256`: the file must have
// that hash (a mismatch is not retried: the same server would send the same file).
export const download = async (url, target, attempts = 3, sha256 = SHA256[url]) => {
  const partial = `${target}.part`
  mkdirSync(dirname(target), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status === 404) throw new UserError(`not found (404): ${url}`)
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      // A site that moved or blocks the download answers with a web page and 200: not the file
      if (/^text\/html/i.test(response.headers.get('content-type') ?? '')) throw new UserError(`${url} answered with a web page instead of the file`)
      const expected = Number(response.headers.get('content-length'))
      const hash = createHash('sha256')
      const body = Readable.fromWeb(/** @type {any} */ (response.body))
      body.on('data', chunk => hash.update(chunk))
      await pipeline(body, createWriteStream(partial))
      const got = statSync(partial).size
      if (expected && got !== expected) throw new Error(`incomplete download: ${got} of ${expected} bytes`)
      const digest = hash.digest('hex')
      if (sha256 && digest !== sha256) throw new UserError(`checksum mismatch (sha256 ${digest}, expected ${sha256}): the file was not installed`)
      renameSync(partial, target)
      return
    } catch (error) {
      rmSync(partial, { force: true })
      if (error instanceof UserError || attempt >= attempts) throw new UserError(`could not download ${url}: ${error.message}`)
      log.warn(`${url}: ${error.message} — retrying`)
    }
  }
}
// A scratch folder inside TOURWRIGHT_HOME: same disk as the destination, so moving out of it is a rename.
export const inScratch = async (home, fn) => {
  mkdirSync(home, { recursive: true })
  const dir = mkdtempSync(join(home, 'download-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// `tar` opens .tar.gz and .tar.xz everywhere, and .zip with Windows' own tar (bsdtar, Windows 10+). The
// GNU tar that Git for Windows puts in PATH cannot open a .zip, so Windows uses its own by full path.
const tar = () => {
  const own = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return isWindows && existsSync(own) ? own : 'tar'
}

export const fetchAndExtract = async (url, dir) => {
  const archive = join(dir, basename(new URL(url).pathname))
  log.info(`downloading ${url}`)
  await download(url, archive)
  await run(tar(), ['-xf', archive, '-C', dir], { maxBuffer: 16 * 1024 * 1024 })
}

export const findFile = (dir, name) => {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) return join(entry.parentPath ?? entry.path, entry.name)
  }
  return null
}

// Runs a program with its output on the terminal (downloads show their progress)
export const runVisible = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve(undefined) : reject(new Error(`${basename(command)} exited with ${code}`))))
  })
