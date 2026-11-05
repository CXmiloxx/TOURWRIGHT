// Where Tourwright's own files are, whatever folder a module lives in: the package root, its docs and its version.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The folder of package.json (src/core/ is two levels down) */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** A path inside the package: fromRoot('docs', 'SCRIPTS.md') */
export const fromRoot = (...parts) => join(ROOT, ...parts)

/** The version of this Tourwright, from package.json */
export const version = () => JSON.parse(readFileSync(fromRoot('package.json'), 'utf8')).version
