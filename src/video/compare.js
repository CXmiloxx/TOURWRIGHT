// `tourwright guide --compare`: which steps of a guide look different from the last time it was made. The
// steps are matched by their text, in order; each pair of pictures is measured with ffmpeg's SSIM (1 = the
// same picture). Docs that change with the app are rebuilt in CI, and a person sees what moved.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffmpegReport } from './ffmpeg.js'

// Below this, a picture changed: a renamed button or a moved field; above it, a clock or a cursor blink
export const DEFAULT_THRESHOLD = 0.97

/**
 * The guide already at `base` (its .guide.json and pictures), copied aside before a new one overwrites it.
 * @param {string} base  the output path without extension (render/index.js `outputBase`)
 * @returns {{ json: string, discard: () => void } | null}  null when there is no earlier guide
 */
export const keepGuide = base => {
  const json = `${base}.guide.json`
  if (!existsSync(json)) return null
  const dir = mkdtempSync(join(tmpdir(), 'tw-compare-'))
  const kept = join(dir, 'before.guide.json')
  copyFileSync(json, kept)
  const index = JSON.parse(readFileSync(json, 'utf8'))
  mkdirSync(join(dir, 'before.guide'), { recursive: true })
  for (const s of index.steps ?? []) {
    if (s.file && existsSync(join(`${base}.guide`, s.file))) copyFileSync(join(`${base}.guide`, s.file), join(dir, 'before.guide', s.file))
  }
  return { json: kept, discard: () => rmSync(dir, { recursive: true, force: true }) }
}

/** How alike two pictures are, 0 to 1: both scaled to the same size and to gray, then SSIM */
export const similarity = async (a, b, config) => {
  const report = await ffmpegReport(['-i', a, '-i', b, '-lavfi', '[0]scale=640:400,format=gray[a];[1]scale=640:400,format=gray[b];[a][b]ssim', '-f', 'null', '-'], config)
  const all = /All:\s*([\d.]+)/.exec(report)?.[1]
  return all === undefined ? 0 : Number(all)
}

/**
 * Steps of two guides matched in order by their text: the same text later in the guide is the same step.
 * @param {{ text: string }[]} before @param {{ text: string }[]} after
 * @returns {{ pairs: [number, number][], added: number[], removed: number[] }}  indexes into each list
 */
export const matchSteps = (before, after) => {
  const pairs = []
  const used = new Set()
  let from = 0
  for (const [j, step] of after.entries()) {
    const i = before.findIndex((b, k) => k >= from && !used.has(k) && b.text === step.text)
    if (i < 0) continue
    used.add(i)
    pairs.push([i, j])
    from = i + 1
  }
  const matched = new Set(pairs.map(([, j]) => j))
  return { pairs, added: after.map((_, j) => j).filter(j => !matched.has(j)), removed: before.map((_, i) => i).filter(i => !used.has(i)) }
}

/**
 * @param {string} beforeJson @param {string} afterJson  .guide.json files, their pictures in the folder next to them
 * @param {{ threshold?: number }} options
 * @returns {Promise<{ changed: { n: number | null, text: string, similarity: number }[], added: any[], removed: any[], same: number }>}
 */
export const compareGuides = async (beforeJson, afterJson, { threshold = DEFAULT_THRESHOLD } = {}, config) => {
  const read = file => JSON.parse(readFileSync(file, 'utf8')).steps ?? []
  const pictures = file => file.replace(/\.json$/, '')
  const [before, after] = [read(beforeJson), read(afterJson)]
  const { pairs, added, removed } = matchSteps(before, after)
  const changed = []
  let same = 0
  for (const [i, j] of pairs) {
    const [b, a] = [before[i], after[j]]
    const fb = b.file && join(pictures(beforeJson), b.file)
    const fa = a.file && join(pictures(afterJson), a.file)
    if (!fb || !fa || !existsSync(fb) || !existsSync(fa)) {
      same++
      continue
    }
    const s = await similarity(fb, fa, config)
    if (s < threshold) changed.push({ n: a.n, text: a.text, similarity: s })
    else same++
  }
  return { changed, added: added.map(j => after[j]), removed: removed.map(i => before[i]), same }
}
