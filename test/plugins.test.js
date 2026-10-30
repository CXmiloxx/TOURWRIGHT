import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerPlugin } from '../src/plugins.js'
import { jsonSchema, PLUGIN_STEPS, validateScript } from '../src/script/schema.js'
import { ENGINES } from '../src/voice/engines.js'
import { parseVoice } from '../src/voice/index.js'
import { loadConfig } from '../src/config.js'

test('a plugin adds a validated step, an engine and a voice name', () => {
  registerPlugin({
    name: 'demo',
    steps: { banner: { description: 'A banner', schema: z => z.object({ text: z.string() }).strict(), run: async () => {} } },
    engines: { robot: { synthesize: async () => {} } },
    voices: { beep: 'robot:r2?rate=+10%' },
  })
  assert.ok(PLUGIN_STEPS.has('banner'))
  assert.equal(validateScript({ steps: [{ banner: { text: 'Hi' } }] }).ok, true)
  assert.match(validateScript({ steps: [{ banner: { txt: 'Hi' } }] }).errors[0], /^steps\.0\.banner/)
  assert.ok(jsonSchema().$defs.step.oneOf.some(o => o.required[0] === 'banner'))
  assert.ok(ENGINES.robot)
  assert.equal(parseVoice('beep', loadConfig({ tts: { aliases: {}, defaultVoice: 'beep' } })).spec, 'robot:r2?rate=+10%')
})

test('a plugin cannot replace a built-in action or skip run()', () => {
  assert.throws(() => registerPlugin({ steps: { click: { run: async () => {} } } }), /built-in action/)
  assert.throws(() => registerPlugin({ steps: { other: {} } }), /no run function/)
})
