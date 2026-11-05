import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spokenLines } from '#render/steps/index.js'
import { mapLimit, sleep } from '#core/util.js'

test('mapLimit keeps the order of the list and never runs more than the limit at once', async () => {
  let running = 0
  let most = 0
  const out = await mapLimit([30, 5, 20, 1, 10], 2, async (ms, i) => {
    running++
    most = Math.max(most, running)
    await sleep(ms)
    running--
    return i
  })
  assert.deepEqual(out, [0, 1, 2, 3, 4])
  assert.equal(most, 2)
  assert.deepEqual(await mapLimit([], 4, async x => x), [])
})

test('spokenLines lists what a walkthrough will say, as the helpers say it', () => {
  const lines = spokenLines([
    { goto: '/' },
    { say: 'Hola <b>mundo</b>.' },
    { say: null },
    { say: { caption: 'Se ve', speak: 'Se dice', rate: '+10%' } },
    { caption: 'Solo texto' },
    { title: { text: 'T', say: 'Bienvenido' } },
    { focus: { target: '#pay', say: 'Luego pulsa {Pagar}.' } },
    { focus: { target: '#x', say: '{Aquí} empieza.' } },
    { offCamera: [{ say: 'Fuera' }] },
    { if: { visible: '#a', then: [{ say: 'Sí' }], else: [{ say: 'No' }] } },
    { try: { steps: [{ say: 'Quizá' }] } },
  ])
  assert.deepEqual(lines.map(([text]) => text), ['Hola mundo.', 'Se dice', 'Bienvenido', 'Luego pulsa Pagar.', 'Luego pulsa', 'Aquí empieza.', 'Fuera', 'Sí', 'No', 'Quizá'])
  assert.equal(lines[1][1].rate, '+10%')
})
