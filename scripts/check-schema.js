// Fails when schema/script.schema.json is out of date (`npm run schema` writes it). Plain Node, so it runs
// on Windows too, where there is no `diff`.
import { readFileSync } from 'node:fs'
import { jsonSchema } from '../src/script/schema.js'

const file = new URL('../schema/script.schema.json', import.meta.url)
const current = `${JSON.stringify(jsonSchema(), null, 2)}\n`
if (readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== current) {
  console.error('schema/script.schema.json is out of date: run `npm run schema`')
  process.exit(1)
}
