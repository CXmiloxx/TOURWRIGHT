import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { test } from 'node:test'
import { extraBinDirs } from '#core/locate.js'
import { cachedBuilds, isSnap } from '#render/browser/chromium.js'
import { findPiperVoice, installedPiperVoices } from '#voice/piper-voices.js'

const voice = (dir, id) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.onnx`), '')
  writeFileSync(join(dir, `${id}.onnx.json`), '{}')
}

test('Piper voices already on the PC are found: own folder, extra folders, Hugging Face cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'tw-voices-'))
  const before = process.env.HF_HUB_CACHE
  process.env.HF_HUB_CACHE = join(root, 'hub')
  try {
    const config = { tts: { piper: { voicesDir: join(root, 'own'), extraVoiceDirs: [join(root, 'extra')] } } }
    assert.equal(findPiperVoice(config, 'es_MX-claude-high'), null)
    voice(join(root, 'extra'), 'en_US-lessac-medium')
    voice(join(root, 'hub', 'models--rhasspy--piper-voices', 'snapshots', 'abc', 'es', 'es_MX', 'claude', 'high'), 'es_MX-claude-high')
    // Without its .onnx.json a model is not usable
    mkdirSync(join(root, 'own'))
    writeFileSync(join(root, 'own', 'de_DE-thorsten-high.onnx'), '')
    assert.equal(findPiperVoice(config, 'en_US-lessac-medium'), join(root, 'extra', 'en_US-lessac-medium.onnx'))
    assert.match(findPiperVoice(config, 'es_MX-claude-high') ?? '', /snapshots.abc.es.es_MX.claude.high.es_MX-claude-high\.onnx$/)
    assert.equal(findPiperVoice(config, 'de_DE-thorsten-high'), null)
    assert.deepEqual(installedPiperVoices(config).sort(), ['en_US-lessac-medium', 'es_MX-claude-high'])
    // Tourwright's own folder wins
    voice(join(root, 'own'), 'en_US-lessac-medium')
    assert.equal(findPiperVoice(config, 'en_US-lessac-medium'), join(root, 'own', 'en_US-lessac-medium.onnx'))
  } finally {
    if (before === undefined) delete process.env.HF_HUB_CACHE
    else process.env.HF_HUB_CACHE = before
    rmSync(root, { recursive: true, force: true })
  }
})

test('extra program folders exist and are absolute', () => {
  for (const dir of extraBinDirs()) assert.ok(isAbsolute(dir), dir)
})

test('browsers left by other Playwright and Puppeteer versions are found, newest first, only when complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'tw-browsers-'))
  try {
    const exe = process.platform === 'win32' ? 'chrome.exe' : 'chrome'
    const build = (dir, complete) => {
      mkdirSync(join(dir, 'chrome-x'), { recursive: true })
      writeFileSync(join(dir, 'chrome-x', exe), '')
      if (complete) writeFileSync(join(dir, 'INSTALLATION_COMPLETE'), '')
    }
    build(join(root, 'pw', 'chromium-1200'), true)
    build(join(root, 'pw', 'chromium-1300'), true)
    build(join(root, 'pw', 'chromium-1400'), false)
    build(join(root, 'pw', 'chromium_headless_shell-1300'), true)
    build(join(root, 'pp', 'chrome', 'linux-131.0.6778.85'), false)
    if (process.platform === 'darwin') return // the macOS layout is an .app bundle
    assert.deepEqual(cachedBuilds({ playwright: [join(root, 'pw')], puppeteer: [join(root, 'pp', 'chrome')] }), [
      join(root, 'pw', 'chromium-1300', 'chrome-x', exe),
      join(root, 'pw', 'chromium-1200', 'chrome-x', exe),
      join(root, 'pp', 'chrome', 'linux-131.0.6778.85', 'chrome-x', exe),
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a script that starts a snap does not count as a browser', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'tw-snap-'))
  try {
    writeFileSync(join(root, 'chromium-browser'), '#!/bin/sh\nexec /snap/bin/chromium "$@"\n')
    writeFileSync(join(root, 'chrome'), '#!/bin/sh\nexec /opt/google/chrome/chrome "$@"\n')
    assert.equal(isSnap(join(root, 'chromium-browser')), true)
    assert.equal(isSnap(join(root, 'chrome')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
