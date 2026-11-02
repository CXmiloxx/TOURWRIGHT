import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { reloadConfig, userConfigFile } from '../src/config.js'
import { listSettings, setSetting, unsetSetting } from '../src/settings.js'

test('each person sets their own defaults; the environment still wins', () => {
  const home = mkdtempSync(join(tmpdir(), 'tw-settings-'))
  const before = { home: process.env.TOURWRIGHT_HOME, quality: process.env.TOURWRIGHT_QUALITY }
  process.env.TOURWRIGHT_HOME = home
  delete process.env.TOURWRIGHT_QUALITY
  try {
    assert.equal(reloadConfig().render.quality, 'hd')
    assert.equal(reloadConfig().render.fps, 30)
    setSetting('quality', 'fullhd')
    setSetting('fps', '24')
    assert.deepEqual(JSON.parse(readFileSync(userConfigFile(), 'utf8')).render, { quality: 'fullhd', fps: 24 })
    assert.equal(reloadConfig().render.quality, 'fullhd')
    assert.equal(listSettings(reloadConfig()).find(s => s.key === 'quality')?.from, userConfigFile())
    // A typo is refused before it is written
    assert.throws(() => setSetting('quality', '4k'), /must be one of sd, hd, fullhd/)
    assert.throws(() => setSetting('fps', '120'), /from 1 to 60/)
    assert.throws(() => setSetting('colour', 'red'), /unknown setting "colour"/)
    process.env.TOURWRIGHT_QUALITY = 'sd'
    assert.equal(reloadConfig().render.quality, 'sd')
    assert.equal(listSettings(reloadConfig()).find(s => s.key === 'quality')?.from, 'TOURWRIGHT_QUALITY')
    delete process.env.TOURWRIGHT_QUALITY
    unsetSetting('quality')
    assert.equal(reloadConfig().render.quality, 'hd')
  } finally {
    for (const [k, v] of [['TOURWRIGHT_HOME', before.home], ['TOURWRIGHT_QUALITY', before.quality]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    reloadConfig()
    rmSync(home, { recursive: true, force: true })
  }
})
