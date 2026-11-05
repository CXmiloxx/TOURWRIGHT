// The architecture rules hold for src/, and the checker really catches each kind of break.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkArchitecture, LAYERS, MAX_LINES } from '../scripts/check-architecture.js'

test('src/ follows the architecture rules', () => {
  assert.deepEqual(checkArchitecture(), [])
})

test('every domain of the rules has its alias in package.json, and the other way round', () => {
  const imports = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).imports
  assert.deepEqual(Object.keys(imports).map(k => k.slice(1, -2)).sort(), Object.keys(LAYERS).sort())
  for (const [alias, target] of Object.entries(imports)) assert.equal(target, `./src/${alias.slice(1, -2)}/*`)
})

test('a long file, a missing header, a ../ import, a layer upside down and a bad name are each reported', () => {
  const src = mkdtempSync(join(tmpdir(), 'tw-arch-'))
  try {
    mkdirSync(join(src, 'core'))
    mkdirSync(join(src, 'render'))
    writeFileSync(join(src, 'core', 'ok.js'), '// Fine.\nexport const a = 1\n')
    writeFileSync(join(src, 'core', 'long.js'), `// Too long.\n${'export const x = 1\n'.repeat(MAX_LINES)}`)
    writeFileSync(join(src, 'core', 'up.js'), "// Reaches up.\nimport { b } from '#render/page.js'\n")
    writeFileSync(join(src, 'render', 'page.js'), "import { a } from '../core/ok.js'\nexport const b = a\n")
    writeFileSync(join(src, 'render', 'BadName.js'), '// Name.\n')
    const problems = checkArchitecture(src).join('\n')
    assert.match(problems, /core\/long\.js: \d+ lines, over 400/)
    assert.match(problems, /core\/up\.js: core may not import render/)
    assert.match(problems, /render\/page\.js: start with a comment/)
    assert.match(problems, /render\/page\.js: imports \.\.\/core\/ok\.js/)
    assert.match(problems, /render\/BadName\.js: file names are kebab-case/)
    assert.doesNotMatch(problems, /^core\/ok\.js:/m)
  } finally {
    rmSync(src, { recursive: true, force: true })
  }
})
