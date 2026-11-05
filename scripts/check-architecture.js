#!/usr/bin/env node
// The architecture rules of src/, checked on every `npm run check` (AGENTS.md explains them):
//   - a module has at most MAX_LINES lines: past that it holds more than one concern and is split;
//   - every module starts with a comment saying what it is for;
//   - file names are kebab-case;
//   - imports are relative only inside a module's own folder (./x.js, ./sub/x.js), never ../: anything else goes
//     through the package's aliases (#core/…, #render/…), so a file can move without breaking the others;
//   - each domain imports only from the domains below it (LAYERS): nothing low depends on something high.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
export const MAX_LINES = 400

// What each domain may import, besides itself. From the bottom (core) to the entry points (server, cli).
export const LAYERS = {
  core: [],
  voice: ['core'],
  script: ['core'],
  video: ['core', 'voice'],
  plugins: ['core', 'script', 'voice'],
  render: ['core', 'plugins', 'script', 'video', 'voice'],
  ai: ['core', 'render', 'script', 'video', 'voice'],
  install: ['core', 'render', 'voice'],
  authoring: ['ai', 'core', 'render', 'script', 'video', 'voice'],
  server: ['ai', 'authoring', 'core', 'plugins', 'render', 'script', 'video', 'voice'],
  cli: ['ai', 'authoring', 'core', 'install', 'plugins', 'render', 'script', 'server', 'video', 'voice'],
}

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
const SPECIFIER = /(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm

/** Every rule broken in src/, as lines to print */
export const checkArchitecture = (src = SRC) => {
  const problems = []
  for (const file of walk(src)) {
    const rel = relative(src, file).split('\\').join('/')
    const name = rel.split('/').at(-1)
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*\.(?:js|json|py|d\.ts)$/.test(name) || (name.endsWith('.js') && name.includes('_'))) {
      problems.push(`${rel}: file names are kebab-case (letters, digits and -)`)
    }
    if (!name.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    if (lines > MAX_LINES) problems.push(`${rel}: ${lines} lines, over ${MAX_LINES}: split it by concern`)
    if (!/^(#!.*\n)?\/\//.test(text)) problems.push(`${rel}: start with a comment that says what the module is for`)
    const domain = rel.includes('/') ? rel.split('/')[0] : null
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[1] ?? m[2]
      if (spec.startsWith('../')) problems.push(`${rel}: imports ${spec}; outside its folder use an alias (#domain/…)`)
      if (!spec.startsWith('#') || !domain) continue
      const target = spec.slice(1).split('/')[0]
      if (!(target in LAYERS)) problems.push(`${rel}: ${spec} is not an alias of package.json`)
      else if (target !== domain && !LAYERS[domain]?.includes(target)) {
        problems.push(`${rel}: ${domain} may not import ${target} (${spec}); allowed: ${LAYERS[domain]?.join(', ') || 'nothing'}`)
      }
    }
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkArchitecture()
  if (problems.length) {
    process.stderr.write(`architecture: ${problems.length} problem${problems.length > 1 ? 's' : ''}\n${problems.map(p => `  ${p}`).join('\n')}\n`)
    process.exit(1)
  }
  process.stdout.write('architecture: ok\n')
}
