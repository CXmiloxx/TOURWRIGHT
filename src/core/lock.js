// A machine-wide "one browser at a time" lock (`--lock <file>`, TOURWRIGHT_BROWSER_LOCK). Held from the moment a
// browser starts until it closes, so renders, explore and workers on one machine take turns.
//
// On Linux with `flock` the lock is a flock(2) on the file: the same lock a shell script takes with
// `flock <file> …`, so Tourwright and the machine's other tools respect each other. Elsewhere it is a file
// created exclusively next to it (<file>.tourwright) holding the owner's pid; a lock left by a process that
// died is taken over.
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync } from 'node:fs'
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
      const owner = Number(readFileSync(path, 'utf8').trim() || 0)
      if (!owner || !alive(owner)) {
        rmSync(path, { force: true })
        continue
      }
      if (!warned) {
        warned = true
        waiting()
      }
      await sleep(1000)
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
