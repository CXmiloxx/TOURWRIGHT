// For the Docker image only: the optional peers of the npm package (the Redis queue, Claude for `narrate`) become
// dependencies and the rest of devDependencies goes, so after `npm ci --include=dev` an `npm prune` keeps exactly
// the versions of the lockfile, without the linters and type checkers. The names come from `peerDependencies`.
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const peers = Object.keys(pkg.peerDependencies ?? {})
const missing = peers.filter(name => !pkg.devDependencies?.[name])
if (missing.length) throw new Error(`${missing.join(', ')}: a peer must also be a devDependency, so the lockfile pins its version`)
pkg.dependencies = { ...pkg.dependencies, ...Object.fromEntries(peers.map(name => [name, pkg.devDependencies[name]])) }
delete pkg.devDependencies
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`kept for the image: ${peers.join(', ')}`)
