// How well a voice says what a narration usually holds: tech words, acronyms, numbers, dates, money,
// addresses. Each voice reads a fixed set of sentences through the same path as a render (lexicon,
// pronunciation, engine); Whisper writes down what it heard; both texts are compared word by word.
//
// This is how the built-in voices were calibrated (src/voice/lexicon.js). `tourwright voices --check` runs it
// on any voice, a new one or one of your own, and lists the words it gets wrong.
import { narrate, parseVoice, voiceLanguages } from './index.js'
import { spanishNumber } from './lexicon.js'
import { pythonProcess } from './python.js'

export const CORPUS = {
  es: [
    'La API responde en JSON y pide una API key en cada petición.',
    'Exporta el informe en PDF o en CSV desde el dashboard.',
    'Inicia sesión con tu usuario o tu email, y activa el 2FA.',
    'El endpoint de pagos usa un webhook para avisar cuando el cobro está listo.',
    'Este mes van 25.800 consultas, el 95 % con resultado.',
    'La factura vence el 16 de octubre de 2026.',
    'El total con IVA es de $ 409.360.',
    'Descarga la colección de Postman y prueba los ejemplos en curl, JavaScript o Python.',
    'Abre la búsqueda rápida con Ctrl K desde cualquier pantalla.',
    'El backend guarda los datos y el frontend los muestra en el navegador.',
    'Los usuarios reciben un SMS con un código de 6 dígitos.',
    'Conecta tu CRM y tu ERP por medio de la API REST.',
    'La URL del sitio empieza por HTTPS.',
    'Sube un archivo de Excel con 1.200 filas y 3 columnas.',
    'Hay 21 empresas activas, 1 suspendida y 16 usuarios.',
    'La app funciona en iPhone, en Android y en Windows.',
    'Escanea el código QR con WhatsApp para recibir el link.',
    'La consulta tarda 3,5 segundos en promedio.',
    'El sistema cumple la Ley 1581 de 2012 sobre datos personales.',
    'Escríbenos a soporte@consultar.co para cualquier duda.',
    'Los documentos CC, CE y NIT se validan en segundos.',
    'El SaaS se integra con Google, Microsoft Teams y Slack.',
    'Revisa los logs del servidor y el uso de CPU y de RAM.',
    '¿Quieres guardar los cambios? ¡Listo, ya quedaron guardados!',
  ],
  en: [
    'The API answers in JSON and asks for an API key on every request.',
    'Export the report as a PDF or a CSV from the dashboard.',
    'This month there were 25,800 searches, 95% of them with results.',
    'Open the quick search with Ctrl K from any screen.',
    'Write to support@example.com if you have any questions.',
  ],
}

// Both texts the same way, so only what was really said wrong remains: lowercase, no accents or punctuation,
// numbers in words (Whisper writes "1,200" the English way), "un/una/uno" as one word (the voice agrees with
// the noun, the digit does not), an email's dots as "punto", spelled letters joined ("c r m" is "crm")
const unaccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Ways Whisper writes a term that was said right: "Jason" for JSON, "kerl" for curl…
const SAME = { es: [[/\byei ?son\b|\byeison\b|\bjason\b/g, 'json'], [/\bkerl\b/g, 'curl'], [/\bcontrol\b/g, 'ctrl'], [/\bdoble factor\b/g, '2fa'], [/\be-? ?mail\b/g, 'email'], [/\bpeso\b/g, 'pesos']],
  en: [[/\bjason\b|\bjay-?son\b/g, 'json'], [/\bcontrol\b/g, 'ctrl'], [/\btwo[ -]factor\b/g, '2fa'], [/\be-mail\b/g, 'email']] }

export const normalizeWords = (text, language) => {
  const [at, dot, percent] = language === 'es' ? ['arroba', 'punto', 'por ciento'] : ['at', 'dot', 'percent']
  let s = String(text).toLowerCase()
    .replace(/[\w.-]+@[\w-]+(?:\.[\w-]+)+/g, m => m.replace('@', ` ${at} `).replace(/\./g, ` ${dot} `))
    .replace(/([a-z])\.([a-z])/g, `$1 ${dot} $2`)
    .replace(/%/g, ` ${percent} `)
  s = language === 'es' ? s.replace(/\$\s?(\d+(?:[.,]\d+)*)/g, '$1 pesos') : s.replace(/\$/g, ' ')
  for (const [re, to] of SAME[language] ?? []) s = s.replace(re, to)
  if (language === 'es') {
    s = s.replace(/(\d{1,3}(?:[.,]\d{3})+(?!\d)|\d+)(?:,(\d{1,2})(?!\d))?/g, (_, whole, dec) =>
      ` ${spanishNumber(Number(whole.replace(/[.,]/g, '')))}${dec ? ` coma ${spanishNumber(Number(dec))}` : ''} `)
  }
  const words = unaccent(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .map(w => (language === 'es' && /^(un|una|uno)$/.test(w) ? 'uno' : w))
  // Runs of single letters are one spelled word ("y", "o", "a", "e", "u" are words in Spanish)
  const letter = w => w.length === 1 && /[a-z]/.test(w) && !['y', 'o', 'a', 'e', 'u'].includes(w)
  const joined = []
  for (const [i, w] of words.entries()) {
    if (letter(w) && i > 0 && letter(words[i - 1])) joined[joined.length - 1] += w
    else joined.push(w)
  }
  return joined
}

/**
 * Word-level edit distance with the words that differ.
 * @param {string[]} expected @param {string[]} heard
 */
export const compareWords = (expected, heard) => {
  const n = expected.length
  const m = heard.length
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (expected[i - 1] === heard[j - 1] ? 0 : 1))
    }
  }
  // Walk back: runs of differing words become one mistake ("api key" → "apiki")
  const mistakes = []
  let i = n
  let j = m
  let said = []
  let wrote = []
  const flush = () => {
    if (said.length || wrote.length) mistakes.unshift({ expected: said.join(' '), heard: wrote.join(' ') })
    said = []
    wrote = []
  }
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === heard[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      flush()
      i--
      j--
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      said.unshift(expected[--i])
      wrote.unshift(heard[--j])
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) said.unshift(expected[--i])
    else wrote.unshift(heard[--j])
  }
  flush()
  return { errors: d[n][m], words: n, mistakes }
}

/**
 * Says the corpus with a voice and listens to it.
 * @param {string} spec @param {any} config @param {{ whisper: string, model?: string, language?: string, sentences?: string[], onSentence?: (r: any) => void }} options
 */
export const checkVoice = async (spec, config, { whisper, model = 'small', language: wanted, sentences, onSentence = () => {} }) => {
  const language = wanted ?? voiceLanguages(parseVoice(spec, config))[0]
  const listener = pythonProcess(whisper, 'transcribe.py', [model, config.ffmpeg])
  const results = []
  let errors = 0
  let words = 0
  for (const text of sentences ?? CORPUS[language] ?? CORPUS.es) {
    // A sentence that cannot be said counts as all wrong, and the check goes on
    let heard = ''
    let failed
    try {
      const said = await narrate(text, spec, config, { language })
      heard = (await listener.send({ file: said.file, language })).text
    } catch (error) {
      failed = String(error.message).split('\n')[0]
    }
    const r = { text, heard, ...(failed ? { failed } : {}), ...compareWords(normalizeWords(text, language), normalizeWords(heard, language)) }
    errors += r.errors
    words += r.words
    results.push(r)
    onSentence(r)
  }
  return { voice: spec, language, wer: words ? errors / words : 0, sentences: results }
}

