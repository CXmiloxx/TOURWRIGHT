import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = file => readFileSync(join(root, file), 'utf8')

test('the image and `tourwright install` use the same piper-tts', () => {
  const image = /^ARG PIPER_TTS=(\S+)$/m.exec(read('Dockerfile'))?.[1]
  const installer = /const PIPER_TTS = 'piper-tts==([^']+)'/.exec(read('src/install.js'))?.[1]
  assert.ok(image && installer, 'both versions are written where this test looks')
  assert.equal(image, installer)
})

test('docker-deps keeps the optional peers as dependencies and drops the dev tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-docker-'))
  try {
    copyFileSync(join(root, 'package.json'), join(dir, 'package.json'))
    mkdirSync(join(dir, 'scripts'))
    execFileSync(process.execPath, [join(root, 'scripts', 'docker-deps.js')], { cwd: dir, stdio: 'ignore' })
    const before = JSON.parse(read('package.json'))
    const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(after.devDependencies, undefined)
    for (const name of Object.keys(before.peerDependencies)) assert.equal(after.dependencies[name], before.devDependencies[name])
    for (const name of Object.keys(before.dependencies)) assert.equal(after.dependencies[name], before.dependencies[name])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
