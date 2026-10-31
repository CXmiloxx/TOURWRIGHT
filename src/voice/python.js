// A Python helper kept running: models that take seconds to load (Pocket TTS) are loaded once and
// then get one JSON line per job and answer one JSON line. Jobs go one at a time. While idle the process
// does not keep Tourwright running, and it ends with it.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const running = new Map()

/**
 * @param {string} python  the Python that has the packages
 * @param {string} script  a file next to this one (pocket.py)
 * @param {string[]} args
 * @returns {{ send: (job: object) => Promise<any> }}
 */
export const pythonProcess = (python, script, args) => {
  const key = [python, script, ...args].join('|')
  if (running.has(key)) return running.get(key)
  const child = spawn(python, ['-u', fileURLToPath(new URL(`./${script}`, import.meta.url)), ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_PROGRESS_BARS: '1' },
  })
  let stderr = ''
  child.stderr.on('data', c => (stderr = (stderr + c).slice(-2000)))
  child.on('error', () => {})
  const lines = createInterface({ input: child.stdout })
  const waiting = []
  lines.on('line', line => waiting.shift()?.(line))
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)))
  process.once('exit', () => child.kill())
  // Its pipes are sockets: unref'd while idle, so a finished render can exit
  const pipes = [child.stdout, child.stderr, child.stdin].map(p => /** @type {import('node:net').Socket} */ (/** @type {unknown} */ (p)))
  const idle = () => {
    child.unref()
    for (const p of pipes) p.unref?.()
  }
  const busy = () => {
    child.ref()
    pipes[0].ref?.()
  }
  const next = () => new Promise((resolve, reject) => {
    waiting.push(resolve)
    exited.then(code => reject(new Error(`${script} stopped (${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`)))
  })
  busy()
  const ready = next().then(line => {
    idle()
    if (!JSON.parse(line).ready) throw new Error(`${script} did not start: ${line}`)
  })
  let queue = ready
  const proc = {
    send: job => {
      const turn = queue.then(async () => {
        busy()
        try {
          child.stdin.write(`${JSON.stringify(job)}\n`)
          const answer = JSON.parse(await next())
          if (answer.error) throw new Error(`${script}: ${answer.error}`)
          return answer
        } finally {
          idle()
        }
      })
      queue = turn.catch(() => {})
      return turn
    },
  }
  running.set(key, proc)
  ready.catch(() => running.delete(key))
  return proc
}
