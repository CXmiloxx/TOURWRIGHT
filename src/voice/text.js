// The words of a narration: exact pauses ([[1.5s]]), the {marked} word a focus lands on, pronunciation, and
// the sentences it is split into.

// Exact pauses inside a narration: "First this. [[1.5s]] Then that." or [[800ms]].
const PAUSE = /\[\[\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*\]\]/g

// The text of a narration as it is shown (captions): without pause marks.
export const stripMarks = text => String(text ?? '').replace(PAUSE, ' ').replace(/[ \t]{2,}/g, ' ').trim()

// "Then press {Pay}." → what is said ("Then press Pay.") and what comes before the first marked word
// ("Then press "), whose length tells when that word is heard.
export const markedLine = line => {
  const text = String(line ?? '')
  const mark = /\{([^{}]+)\}/.exec(text)
  const unmark = s => s.replace(/\{([^{}]+)\}/g, '$1')
  return { spoken: unmark(text), before: mark ? unmark(text.slice(0, mark.index)) : null }
}

// Words said differently from how they are written. Whole words only; captions keep the original.
export const applyPronunciation = (text, words = {}) => {
  const keys = Object.keys(words).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!keys.length) return text
  const literal = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map(literal).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  return String(text).replace(re, w => words[w])
}

// Splits a narration into sentences. "|" (pause mark) reads as a comma; *emphasis* marks are dropped.
export const splitSentences = text =>
  String(text)
    .replace(/\*/g, '')
    .replace(/,?\s*\|\s*/g, ', ')
    .split(/(?<=[.?!…])\s+/)
    .map(s => s.trim())
    .filter(s => s && !/^[.,;:?!…]+$/.test(s))

// Pieces of a narration: sentences, and the exact silences written between them.
export const splitNarration = text => {
  const parts = []
  let last = 0
  for (const m of String(text).matchAll(PAUSE)) {
    for (const s of splitSentences(text.slice(last, m.index))) parts.push({ text: s })
    parts.push({ silence: Math.min(10, Number(m[1]) / (m[2] === 'ms' ? 1000 : 1)) })
    last = m.index + m[0].length
  }
  for (const s of splitSentences(String(text).slice(last))) parts.push({ text: s })
  return parts
}
