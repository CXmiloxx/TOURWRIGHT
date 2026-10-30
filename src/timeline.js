// Recording time → final video time. Pure functions, no I/O.
//
// While recording, some stretches are cut out of the video: everything before the first title card
// (the page loading) and every off-camera wait (voice being synthesized, slow pages, long jobs).
// Cuts are [from, to] in seconds since the recording started.

// Sorted, merged cuts: overlapping or touching stretches become one.
export const normalizeCuts = cuts => {
  const sorted = cuts.filter(([a, b]) => b > a).map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0])
  const merged = []
  for (const c of sorted) {
    const last = merged.at(-1)
    if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1])
    else merged.push(c)
  }
  return merged
}

// A recording instant, in seconds of the final video. An instant inside a cut lands where the cut was.
export const toOutput = (t, cuts) => {
  const inside = cuts.find(([a, b]) => t > a && t < b)
  const at = inside ? inside[0] : t
  return Math.max(0, at - cuts.reduce((sum, [a, b]) => (b <= at ? sum + (b - a) : sum), 0))
}

// ffmpeg filter that drops the cut stretches and closes the gaps.
export const cutFilter = (cuts, fps) =>
  cuts.length
    ? `fps=${fps},select='not(${cuts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')})',setpts=N/FRAME_RATE/TB`
    : `fps=${fps}`

const stamp = (t, separator) => {
  const ms = Math.round(t * 1000)
  const two = n => String(n).padStart(2, '0')
  return `${two(Math.floor(ms / 3_600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)}${separator}${String(ms % 1000).padStart(3, '0')}`
}

// captions: [{ start, end, text }] in final-video seconds
export const toSrt = captions =>
  captions
    .filter(c => c.text && c.end > c.start)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`)
    .join('\n')

export const toVtt = captions =>
  `WEBVTT\n\n${captions
    .filter(c => c.text && c.end > c.start)
    .map(c => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`)
    .join('\n')}`

const escapeMeta = t => String(t).replace(/[=;#\\\n]/g, m => `\\${m}`)

// chapters: [{ start, end, title }] in final-video seconds → ffmpeg FFMETADATA1
export const toFfmetadata = (title, chapters) =>
  [';FFMETADATA1', `title=${escapeMeta(title)}`,
    ...chapters.flatMap(c => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${escapeMeta(c.title)}`]),
  ].join('\n')

// Chapters from title marks: each one lasts until the next one (the last, until the end).
export const chaptersFrom = (marks, total) =>
  marks.map((m, i) => ({ title: m.title, start: m.start, end: i + 1 < marks.length ? marks[i + 1].start : total }))
