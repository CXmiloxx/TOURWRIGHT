import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chaptersFrom, cutFilter, normalizeCuts, toFfmetadata, toOutput, toSrt, toVtt } from '../src/timeline.js'

test('normalizeCuts merges overlapping and drops empty cuts', () => {
  assert.deepEqual(normalizeCuts([[5, 7], [0, 2], [6, 9], [3, 3]]), [[0, 2], [5, 9]])
})

test('toOutput removes the cut time before an instant', () => {
  const cuts = [[0, 2], [5, 9]]
  assert.equal(toOutput(3, cuts), 1)
  assert.equal(toOutput(10, cuts), 4)
  // Inside a cut, the instant lands where the cut started
  assert.equal(toOutput(6, cuts), 3)
})

test('cutFilter selects everything outside the cuts', () => {
  assert.equal(cutFilter([], 30), 'fps=30')
  assert.match(cutFilter([[1, 2]], 30), /not\(between\(t,1\.000,2\.000\)\)/)
})

test('subtitles in SRT and WebVTT', () => {
  const caps = [{ start: 0, end: 1.5, text: 'Hola' }, { start: 61.25, end: 3725.5, text: 'Adiós' }, { start: 2, end: 2, text: 'empty' }]
  assert.equal(toSrt(caps), '1\n00:00:00,000 --> 00:00:01,500\nHola\n\n2\n00:01:01,250 --> 01:02:05,500\nAdiós\n')
  assert.match(toVtt(caps), /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.500\nHola/)
})

test('chapters last until the next one and metadata is escaped', () => {
  const ch = chaptersFrom([{ title: 'A', start: 0 }, { title: 'B=1', start: 10 }], 30)
  assert.deepEqual(ch, [{ title: 'A', start: 0, end: 10 }, { title: 'B=1', start: 10, end: 30 }])
  assert.match(toFfmetadata('T', ch), /title=B\\=1/)
})
