// A machine-wide "one browser at a time" lock (`--lock <file>`, TOURWRIGHT_BROWSER_LOCK). Held from the moment a
// browser starts until it closes, so renders, explore and workers on one machine take turns.
//
// On Linux with `flock` the lock is a flock(2) on the file: the same lock a shell script takes with
// `flock <file> …`, so Tourwright and the machine's other tools respect each other. Elsewhere it is a file
// created exclusively next to it (<file>.tourwright) holding the owner's pid; a lock left by a process that
// died is taken over.
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { log, sleep, which } from './util.js'

// Prints "locked" once flock holds the lock, then holds it until its stdin closes
const HOLDER = "process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"

const withFlock = (flock, file, waiting) =>
  new Promise((resolve, reject) => {
    const child = spawn(flock, ['--exclusive', file, process.execPath, '-e', HOLDER], { stdio: ['pipe', 'pipe', 'inherit'] })
    const timer = setTimeout(waiting, 2000)
    const release = () => child.stdin.end()
    process.once('exit', () => child.kill())
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`flock ${file} stopped (${code})`))
    })
    createInterface({ input: child.stdout }).once('line', () => {
      clearTimeout(timer)
      child.removeAllListeners('exit')
      // While held it must not keep Node running on its own
      child.unref()
      resolve(release)
    })
  })

const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// A lock file with no pid yet is being written by its new owner; only an old one was left by a process that died
const UNWRITTEN_STALE_MS = 10_000

// The pid in the lock file; 0 when it holds none yet; null when it is gone
const ownerOf = path => {
  try {
    return Number(readFileSync(path, 'utf8').trim() || 0)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

const ageOf = path => {
  try {
    return Date.now() - statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Takes away a lock left by a process that died. Two waiters may find the same dead owner: they take turns on a
 * second file, and each looks again before removing, so neither removes the lock the other has just taken.
 */
const takeOver = (path, dead) => {
  const turn = `${path}.takeover`
  try {
    closeSync(openSync(turn, 'wx'))
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    // A waiter that died in the middle of a takeover
    if (ageOf(turn) > UNWRITTEN_STALE_MS) rmSync(turn, { force: true })
    return
  }
  try {
    if (ownerOf(path) === dead) rmSync(path, { force: true })
  } finally {
    rmSync(turn, { force: true })
  }
}

const withLockFile = async (file, waiting) => {
  const path = `${file}.tourwright`
  let warned = false
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      let released = false
      const release = () => {
        if (released) return
        released = true
        rmSync(path, { force: true })
      }
      process.once('exit', release)
      return release
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = ownerOf(path)
      // Released between the two looks: try again at once
      if (owner === null) continue
      if (owner ? !alive(owner) : ageOf(path) > UNWRITTEN_STALE_MS) {
        takeOver(path, owner)
        await sleep(50)
        continue
      }
      if (owner && !warned) {
        warned = true
        waiting()
      }
      await sleep(owner ? 1000 : 50)
    }
  }
}

/**
 * Waits for the lock and returns the function that releases it.
 * @param {string} file
 * @returns {Promise<() => void>}
 */
export const acquireLock = async file => {
  mkdirSync(dirname(file), { recursive: true })
  const waiting = () => log.info(`waiting for the browser lock ${file} (another browser is running)`)
  const flock = process.platform === 'linux' ? which('flock') : null
  return flock ? withFlock(flock, file, waiting) : withLockFile(file, waiting)
}
