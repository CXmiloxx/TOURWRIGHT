#!/usr/bin/env node
import { main } from '../src/cli.js'
import { UserError } from '../src/util.js'

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`tourwright: ${error instanceof UserError ? error.message : (error.stack ?? error)}\n`)
  if (error.screenshot) process.stderr.write(`tourwright: screenshot of the failure: ${error.screenshot}\n`)
  process.exit(error instanceof UserError ? 2 : 1)
})
