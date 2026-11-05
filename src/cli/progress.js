// A render's progress on stderr: a line that updates itself in a terminal (stage, step, time so far), one
// line per stage elsewhere (CI logs, pipes)
import { log, setStatus } from '#core/util.js'

export const progressLine = () => {
  const started = Date.now()
  const live = process.stderr.isTTY && process.env.TOURWRIGHT_LOG_FORMAT !== 'json'
  let stage = ''
  return {
    onProgress: p => {
      if (!live) {
        if (p.stage !== stage) log.info(`${p.stage}…`)
        stage = p.stage
        return
      }
      const s = Math.round((Date.now() - started) / 1000)
      setStatus(`[tourwright] ${p.stage}${p.step ? ` · step ${p.step}/${p.steps}` : ''} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    },
    done: () => live && setStatus(''),
  }
}
