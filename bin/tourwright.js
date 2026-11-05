#!/usr/bin/env node
import { main } from '#cli/index.js'
import { redact, UserError } from '#core/util.js'

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`tourwright: ${redact(error instanceof UserError ? error.message : (error.stack ?? error))}\n`)
  if (error.screenshot) process.stderr.write(`tourwright: screenshot of the failure: ${error.screenshot}\n`)
  process.exit(error instanceof UserError ? 2 : 1)
})
