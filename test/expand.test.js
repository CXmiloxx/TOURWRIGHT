import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandScript } from '../src/script/expand.js'
import { fromData } from '../src/script/load.js'

test('variables replace text and keep the type of a whole value', () => {
  const s = expandScript({ vars: { product: 'Acme', wait: 1500, user: { name: 'Ana' } }, title: '{{product}} tour', steps: [{ say: 'Hi {{ user.name }}' }, { pause: '{{wait}}' }] })
  assert.deepEqual(s, { title: 'Acme tour', steps: [{ say: 'Hi Ana' }, { pause: 1500 }] })
})

test('unknown variables are an error that names the known ones', () => {
  assert.throws(() => expandScript({ vars: { a: 1 }, steps: [{ say: '{{b}}' }] }), /\{\{b\}\} is not defined \(variables: a\)/)
})

test('blocks are inserted with their own variables, also inside nested steps', () => {
  const s = expandScript({
    vars: { who: 'world' },
    blocks: { greet: [{ say: 'Hello {{who}}' }] },
    steps: [{ use: 'greet' }, { use: { block: 'greet', with: { who: 'Ana' } } }, { offCamera: [{ use: 'greet' }] }, { if: { visible: '#x', then: [{ use: 'greet' }] } }],
  })
  assert.deepEqual(s.steps, [{ say: 'Hello world' }, { say: 'Hello Ana' }, { offCamera: [{ say: 'Hello world' }] }, { if: { visible: '#x', then: [{ say: 'Hello world' }] } }])
  assert.throws(() => expandScript({ steps: [{ use: 'nope' }] }), /no block "nope"/)
  assert.throws(() => expandScript({ blocks: { a: [{ use: 'a' }] }, steps: [{ use: 'a' }] }), /nested more than/)
})

test('repeat by count and by list', () => {
  const s = expandScript({ steps: [{ repeat: { times: 2, steps: [{ say: 'n{{index}}' }] } }, { repeat: { each: ['a', 'b'], as: 'tab', steps: [{ click: { text: '{{tab}}' } }] } }] })
  assert.deepEqual(s.steps, [{ say: 'n1' }, { say: 'n2' }, { click: { text: 'a' } }, { click: { text: 'b' } }])
  assert.throws(() => expandScript({ steps: [{ repeat: { times: 500, steps: [{ repeat: { times: 500, steps: [{ pause: 1 }] } }] } }] }), /more than 5000 steps/)
})

test('fromData expands, takes vars from outside and validates the result', () => {
  const loaded = fromData({ vars: { url: '/a' }, steps: [{ goto: '{{url}}' }] }, { vars: { url: '/b' } })
  assert.ok(loaded.kind === 'browser')
  assert.deepEqual(loaded.script.steps, [{ goto: '/b' }])
  assert.equal(loaded.script.vars, undefined)
  // An already expanded script (a queued job) is not expanded again
  const queued = fromData({ steps: [{ say: 'literal {{x}}' }] }, { expand: false })
  assert.ok(queued.kind === 'browser')
  assert.equal(queued.script.steps[0].say, 'literal {{x}}')
})

test('a huge repeat is refused before anything is allocated', () => {
  assert.throws(() => expandScript({ steps: [{ repeat: { times: 1e9, steps: [{ pause: 1 }] } }] }), /from 1 to 500/)
  assert.throws(() => expandScript({ steps: [{ repeat: { times: 'x', steps: [] } }] }), /from 1 to 500/)
})
