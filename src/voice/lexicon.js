import { readFileSync } from 'node:fs'

// What narration says for what is written for the eye: tech words, acronyms and numbers. A voice reads
// "API" or "JSON" letter by letter in the wrong language, or as a word; these say them the way people who
// work with them do. Captions keep the original text. The config's `tts.pronounce` and a script's
// `pronounce` win over these.

// Spanish as spoken in Latin American offices: spelled with Spanish letter names, English words written
// the way they sound to a Spanish voice
const ES = {
  API: 'a pe i', APIs: 'a pe is', 'API key': 'a pe i qui', 'API keys': 'a pe i quis',
  JSON: 'yei son', CSV: 'ce ese ve', PDF: 'pe de efe', PDFs: 'pe de efes', URL: 'u erre ele', URLs: 'u erre eles',
  HTTP: 'hache te te pe', HTTPS: 'hache te te pe ese', HTML: 'hache te eme ele', CSS: 'ce ese ese',
  SQL: 'ese cu ele', XML: 'equis eme ele', SDK: 'ese de ca', CRM: 'ce erre eme', ERP: 'e erre pe',
  SaaS: 'sas', UI: 'u i', UX: 'u equis', ID: 'i de', IDs: 'i des', QR: 'cu erre', SMS: 'ese eme ese',
  OTP: 'o te pe', IA: 'i a', AI: 'ei ai', USB: 'u ese be', GPS: 'ge pe ese', CPU: 'ce pe u', VPN: 've pe ene',
  DNS: 'de ene ese', SSL: 'ese ese ele', SSO: 'ese ese o', '2FA': 'doble factor', MFA: 'eme efe a',
  REST: 'rest', PWA: 'pe doble ve a', iOS: 'ai o ese', macOS: 'mac o ese', npm: 'ene pe eme',
  JavaScript: 'yavascript', TypeScript: 'taipscript', Python: 'páiton', curl: 'kerl', Postman: 'póstman',
  GitHub: 'guit jab', GitLab: 'guit lab', Docker: 'dóquer', Excel: 'éxcel', Word: 'uord', PowerPoint: 'páuer point',
  email: 'imeil', emails: 'imeils', 'e-mail': 'imeil', Gmail: 'yi meil', Outlook: 'áutluk',
  login: 'loguin', logout: 'lógaut', dashboard: 'dáshbord', dashboards: 'dáshbords',
  endpoint: 'éndpoint', endpoints: 'éndpoints', webhook: 'uébjuk', webhooks: 'uébjuks',
  backend: 'bákend', frontend: 'fróntend', online: 'onláin', software: 'sóftuer', hardware: 'járduer',
  app: 'ap', apps: 'aps', WhatsApp: 'guatsap', Google: 'gúgol', YouTube: 'iutiub', OK: 'oquéi',
  'Wi-Fi': 'uaifai', WiFi: 'uaifai', Ctrl: 'control', Windows: 'uíndous', iPhone: 'aifon',
  streaming: 'estrímin', cookies: 'cúquis', feedback: 'fídbak', checkout: 'chékaut', check: 'chek',
  Slack: 'eslak', Teams: 'tims', Zoom: 'zum', Microsoft: 'máicrosoft', Office: 'ófis', Stripe: 'estráip',
}

const EN = {
  JSON: 'jay-son', SaaS: 'sass', GUI: 'gooey', npm: 'N P M', nginx: 'engine X', SQL: 'sequel', CLI: 'C L I',
  '2FA': 'two-factor', iOS: 'eye O S', macOS: 'mac O S',
}

const LEXICONS = { es: ES, en: EN }

const LETTERS = {
  es: { A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'efe', G: 'ge', H: 'hache', I: 'i', J: 'jota', K: 'ca', L: 'ele', M: 'eme', N: 'ene', Ñ: 'eñe', O: 'o', P: 'pe', Q: 'cu', R: 'erre', S: 'ese', T: 'te', U: 'u', V: 've', W: 'doble ve', X: 'equis', Y: 'ye', Z: 'zeta' },
}

// The language of a voice, from its name: es_MX-claude-high, es-CO-SalomeNeural, pocket's lola
const POCKET_LANGUAGES = { lola: 'es', giovanni: 'it', juergen: 'de', rafael: 'pt', estelle: 'fr' }
const MODEL_LANGUAGES = { spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', english: 'en' }
export const voiceLanguage = voice => {
  if (!voice) return undefined
  if (voice.engine === 'pocket') return MODEL_LANGUAGES[String(voice.options.model ?? '').split('_')[0]] ?? POCKET_LANGUAGES[voice.id] ?? 'en'
  return /(?:^|[:_-])(es|en|pt|fr|de|it)[_-]/i.exec(voice.id)?.[1]?.toLowerCase()
}

// Per engine, measured once with a speech-to-text model (Whisper): how each term is best written for that engine
// (null: as it is). Neural engines (Edge, Pocket TTS) say most English words right as written and only get
// the respellings that won; Piper also keeps the rest of the list above.
const CALIBRATED = JSON.parse(readFileSync(new URL('./calibrated.json', import.meta.url), 'utf8'))

/** @param {string} language @param {string} [engine] @returns {Record<string, string>} */
export const lexicon = (language, engine) => {
  const lang = String(language ?? '').slice(0, 2).toLowerCase()
  const base = LEXICONS[lang] ?? {}
  const tuned = engine ? CALIBRATED[lang]?.[engine] : undefined
  if (!tuned) return base
  const said = Object.fromEntries(Object.entries(tuned).filter(([, t]) => t.say).map(([term, t]) => [term, t.say]))
  if (engine !== 'piper') return said
  return { ...Object.fromEntries(Object.entries(base).filter(([term]) => !(term in tuned))), ...said }
}

// Acronyms no dictionary knows: "RUT" is read as a word, but "CC" or "NNA" (no vowels) and "UE" (only
// vowels) are spelled with the language's letter names. "PDFs" → "pe de efes".
const spellAcronyms = (text, letters) =>
  text.replace(/(?<![\p{L}\p{N}])([A-ZÑ]{2,5})(s?)(?![\p{L}\p{N}])/gu, (word, caps, plural) => {
    const vowels = (caps.match(/[AEIOU]/g) ?? []).length
    if (vowels && vowels < caps.length) return word
    return [...caps].map(c => letters[c] ?? c).join(' ') + plural
  })

// Numbers in Spanish words. Some voices (Pocket TTS) cannot read digits at all; the others read
// "25.800" as twenty-five point eight hundred. Words work with every voice.
const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
  'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

const below1000 = n => {
  if (n === 100) return 'cien'
  const h = Math.floor(n / 100)
  const r = n % 100
  const rest = r < 30 ? (r ? UNITS[r] : '') : TENS[Math.floor(r / 10)] + (r % 10 ? ` y ${UNITS[r % 10]}` : '')
  return [HUNDREDS[h], rest].filter(Boolean).join(' ')
}

// "uno" before what it counts: "veintiún mil", "un millón"
const apocope = words => words.replace(/(^|\s)uno$/, '$1un').replace(/veintiuno$/, 'veintiún')

/** @param {number} n a whole number below a trillion */
export const spanishNumber = n => {
  if (n < 1000) return n === 0 ? 'cero' : below1000(n)
  const millions = Math.floor(n / 1_000_000)
  const thousands = Math.floor((n % 1_000_000) / 1000)
  const rest = n % 1000
  const parts = []
  if (millions) parts.push(millions === 1 ? 'un millón' : `${apocope(spanishNumber(millions))} millones`)
  if (thousands) parts.push(thousands === 1 ? 'mil' : `${apocope(below1000(thousands))} mil`)
  if (rest) parts.push(below1000(rest))
  return parts.join(' ')
}

// "21 consultas" → "veintiuna consultas"; "1 fuente" → "una fuente"; "31 días" → "treinta y un días"
// The gender of the noun, by its ending, with the common words that break the rule
const MASCULINE_A = /^(d[ií]as?|mapas?|problemas?|sistemas?|programas?|temas?|idiomas?|climas?|esquemas?|planetas?|sofás?)$/i
const FEMININE = /(i[oó]n(es)?|dad(es)?|tud(es)?|umbres?)$|^(fuentes?|claves?|llaves?|noches?|tardes?|gentes?|partes?|redes|red|vez|veces|imagen|imágenes|bases?|mujer(es)?|ley(es)?)$/i
const feminine = word => !MASCULINE_A.test(word) && (/as?$/i.test(word) || FEMININE.test(word))

const counting = (words, next) => {
  if (!/uno$/.test(words) || !next) return words
  return feminine(next) ? words.replace(/uno$/, 'una') : apocope(words)
}

const numbersEs = text =>
  text
    .replace(/(\d)\s?%/g, '$1 por ciento')
    .replace(/(?<![\p{L}\d.,-])(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?![\d\p{L}])(\s+(\p{L}+))?/gu, (all, whole, decimals, after, next) => {
      // Codes (00021) and long numbers written without separators (an id, a phone) are read digit by digit
      if (/^0\d/.test(whole) || /^\d{7,}$/.test(whole)) return [...whole].map(d => UNITS[Number(d)]).join(' ') + (after ?? '')
      if (whole.replace(/\./g, '').length > 12) return all
      const n = Number(whole.replace(/\./g, ''))
      let words = counting(spanishNumber(n), decimals ? undefined : next)
      if (decimals) words += ` coma ${[...decimals].length <= 2 ? spanishNumber(Number(decimals)) : [...decimals].map(d => UNITS[Number(d)]).join(' ')}`
      return words + (after ?? '')
    })

/**
 * The text as the voice should read it, in `language`.
 * @param {string} text @param {string | undefined} language
 */
export const speakable = (text, language) => {
  const lang = String(language ?? '').slice(0, 2).toLowerCase()
  let s = String(text)
  // An email address, said the way people dictate it
  const at = { es: ['arroba', 'punto'], en: ['at', 'dot'] }[lang]
  if (at) s = s.replace(/([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)/g, (_, user, domain) => `${user.replace(/\./g, ` ${at[1]} `)} ${at[0]} ${domain.replace(/\./g, ` ${at[1]} `)}`)
  if (LETTERS[lang]) s = spellAcronyms(s, LETTERS[lang])
  if (lang === 'es') {
    // "$ 409.360": voices say dollars, pesos or nothing; in Spanish narration the sign is the local currency
    const amount = '(\\d+(?:[.,]\\d+)*)'
    s = s.replace(new RegExp(`(?:US\\$|USD)\\s?${amount}`, 'g'), '$1 dólares').replace(new RegExp(`€\\s?${amount}`, 'g'), '$1 euros')
      .replace(new RegExp(`\\$\\s?${amount}`, 'g'), '$1 pesos')
    s = numbersEs(s)
  }
  return s
}
