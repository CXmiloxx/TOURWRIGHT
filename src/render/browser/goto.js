// Going to a page when the network may drop for a moment: a reset, a changed network or a timeout gets two more
// tries; a page the sandbox blocks or a server that refuses is said at once. Used by the filmed `goto` and the
// quick one of `setup`.
import { log, sleep } from '#core/util.js'

// Only failures of the moment: a protocol error or a refused connection would fail the same way again
const TRANSIENT = /ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/

/**
 * page.goto that tries again when the network failed for a moment. `retrying` runs each new try: a filmed goto
 * passes its clock's offClock, so the error page and the wait are cut from the video. A link that works once (a
 * magic link, a verification token) may be spent by a try that failed on the way back: such a page is better
 * opened in `setup` or with a session.
 * @param {import('playwright').Page} page @param {string} url @param {Record<string, any>} [options]
 * @param {(fn: () => Promise<any>) => Promise<any>} [retrying]
 */
export const gotoRetrying = async (page, url, options = {}, retrying = fn => fn()) => {
  const go = () => page.goto(url, { waitUntil: 'domcontentloaded', ...options })
  for (let attempt = 1; ; attempt++) {
    try {
      return attempt === 1 ? await go() : await retrying(async () => {
        await sleep(1000 * (attempt - 1))
        return go()
      })
    } catch (error) {
      if (attempt >= 3 || !TRANSIENT.test(String(error?.message))) throw error
      log.warn(`${url}: ${String(error.message).split('\n')[0]}; trying again (${attempt + 1}/3)`)
    }
  }
}
