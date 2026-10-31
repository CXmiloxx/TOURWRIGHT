// Calibrates how each voice engine is told to say tech words, acronyms and loanwords.
//
// A neural voice (Edge, Pocket TTS) often says "JavaScript" or "Python" right as written, and gets worse
// with a Spanish respelling; Piper needs the respelling. So each engine gets its own list: every term is
// said in a carrier sentence written several ways (as is, respelled, spelled out), Whisper writes down
// what it heard, and the way it heard the term best wins (ties keep the term as written). The result is
// src/voice/calibrated.json, which src/voice/lexicon.js uses for that engine.
//
//   node scripts/calibrate-voices.js [es|en] [engine…]      needs: tourwright install --pocket --whisper
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, venvBin } from '../src/config.js'
import { findBinary } from '../src/util.js'
import { ENGINES } from '../src/voice/engines.js'
import { parseVoice } from '../src/voice/index.js'
import { pythonProcess } from '../src/voice/python.js'

// For each term: the ways to write it for the voice (the first is the term itself), and what Whisper may
// write when it heard it right besides the term
const TERMS = {
  es: {
    API: [['API', 'a pe i', 'a, pe, i', 'ei pi ai']],
    'API key': [['API key', 'a pe i ki', 'a pe i kei', 'a pe i, ki']],
    APIs: [['APIs', 'a pe is']],
    JSON: [['JSON', 'yei son', 'yéison', 'jeison'], ['jason', 'yeison']],
    CSV: [['CSV', 'ce ese ve', 'ce ese uve']],
    PDF: [['PDF', 'pe de efe']],
    URL: [['URL', 'u erre ele']],
    HTTP: [['HTTP', 'hache te te pe']],
    HTTPS: [['HTTPS', 'hache te te pe ese']],
    HTML: [['HTML', 'hache te eme ele']],
    CSS: [['CSS', 'ce ese ese']],
    SQL: [['SQL', 'ese cu ele']],
    XML: [['XML', 'equis eme ele']],
    SDK: [['SDK', 'ese de ca']],
    CRM: [['CRM', 'ce erre eme']],
    ERP: [['ERP', 'e erre pe', 'e, erre, pe']],
    SaaS: [['SaaS', 'sas', 'saas']],
    UI: [['UI', 'u i']],
    UX: [['UX', 'u equis']],
    ID: [['ID', 'i de']],
    QR: [['QR', 'cu erre', 'ku erre']],
    SMS: [['SMS', 'ese eme ese']],
    OTP: [['OTP', 'o te pe']],
    IA: [['IA', 'i a']],
    USB: [['USB', 'u ese be']],
    GPS: [['GPS', 'ge pe ese']],
    CPU: [['CPU', 'ce pe u', 'ce, pe, u']],
    RAM: [['RAM', 'ram']],
    VPN: [['VPN', 've pe ene', 'uve pe ene']],
    DNS: [['DNS', 'de ene ese']],
    SSL: [['SSL', 'ese ese ele']],
    '2FA': [['2FA', 'doble factor', 'dos efe a'], ['doble factor', '2fa']],
    REST: [['REST', 'rest', 'res']],
    iOS: [['iOS', 'ai o ese']],
    npm: [['npm', 'ene pe eme']],
    JavaScript: [['JavaScript', 'yavascript', 'yava script']],
    TypeScript: [['TypeScript', 'taipscript', 'taip script']],
    Python: [['Python', 'páiton', 'paiton']],
    curl: [['curl', 'kerl', 'cúrl'], ['kerl']],
    Postman: [['Postman', 'póstman']],
    GitHub: [['GitHub', 'guit jab', 'git hab']],
    Docker: [['Docker', 'dóquer']],
    Excel: [['Excel', 'éxcel']],
    email: [['email', 'imeil', 'i meil'], ['e mail', 'mail']],
    login: [['login', 'loguin']],
    dashboard: [['dashboard', 'dáshbord', 'dash bord']],
    endpoint: [['endpoint', 'éndpoint', 'end point']],
    webhook: [['webhook', 'uébjuk', 'web juk']],
    backend: [['backend', 'bákend', 'back end']],
    frontend: [['frontend', 'fróntend', 'front end']],
    software: [['software', 'sóftuer']],
    WhatsApp: [['WhatsApp', 'guatsap', 'uatsap']],
    Google: [['Google', 'gúgol']],
    YouTube: [['YouTube', 'iutiub']],
    'Wi-Fi': [['Wi-Fi', 'uaifai'], ['wifi']],
    Ctrl: [['Ctrl', 'control'], ['control']],
    iPhone: [['iPhone', 'aifon']],
    streaming: [['streaming', 'estrímin']],
    cookies: [['cookies', 'cúquis']],
    feedback: [['feedback', 'fídbak']],
    checkout: [['checkout', 'chékaut']],
    Slack: [['Slack', 'eslak', 'eslák']],
    Teams: [['Teams', 'tims']],
    Microsoft: [['Microsoft', 'máicrosoft']],
    logs: [['logs', 'logues', 'log']],
    link: [['link', 'link', 'linc']],
    app: [['app', 'ap']],
  },
  en: {
    JSON: [['JSON', 'jay-son', 'jason'], ['jason']],
    SaaS: [['SaaS', 'sass']],
    GUI: [['GUI', 'gooey']],
    SQL: [['SQL', 'sequel', 'S Q L'], ['sequel']],
    CLI: [['CLI', 'C L I']],
    '2FA': [['2FA', 'two-factor', 'two F A'], ['two factor']],
    iOS: [['iOS', 'eye O S']],
    npm: [['npm', 'N P M']],
    nginx: [['nginx', 'engine X'], ['engine x']],
    Ctrl: [['Ctrl', 'control'], ['control']],
    curl: [['curl', 'kurl']],
    CSV: [['CSV', 'C S V']],
    PDF: [['PDF', 'P D F']],
    API: [['API', 'A P I']],
    'API key': [['API key', 'A P I key']],
    URL: [['URL', 'U R L']],
    OAuth: [['OAuth', 'oh auth'], ['o auth']],
    YAML: [['YAML', 'yammel'], ['yamel']],
    webhook: [['webhook', 'web hook']],
  },
}

const CARRIER = {
  es: term => `Ahora revisamos ${term} en el sistema.`,
  en: term => `Now we check ${term} in the system.`,
}
const VOICES = {
  es: { edge: 'edge:es-CO-SalomeNeural', pocket: 'pocket:lola', piper: 'piper:es_MX-claude-high' },
  en: { edge: 'edge:en-US-JennyNeural', pocket: 'pocket:alba', piper: 'piper:en_US-lessac-medium' },
}

const unaccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const squash = s => unaccent(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim()
// Heard right: the term (or an accepted form) is in what Whisper wrote, spaces and dots aside
const heardRight = (heard, accepted) => {
  const h = ` ${squash(heard)} `
  const tight = squash(heard).replace(/ /g, '')
  return accepted.some(a => h.includes(` ${squash(a)} `) || tight.includes(squash(a).replace(/ /g, '')))
}

const [lang = 'es', ...only] = process.argv.slice(2)
const config = loadConfig()
const whisper = process.env.TOURWRIGHT_WHISPER_PYTHON ?? findBinary(venvBin(config.home, 'python'))
const listener = pythonProcess(whisper, 'transcribe.py', ['small', config.ffmpeg])
const work = join(tmpdir(), `tourwright-calibrate-${process.pid}`)
mkdirSync(work, { recursive: true })
const file = new URL('../src/voice/calibrated.json', import.meta.url)
const result = JSON.parse(readFileSync(file, 'utf8'))
result[lang] ??= {}

try {
  for (const [engine, spec] of Object.entries(VOICES[lang]).filter(([e]) => !only.length || only.includes(e))) {
    const voice = parseVoice(spec, config)
    const chosen = {}
    let n = 0
    for (const [term, [writings, extra = []]] of Object.entries(TERMS[lang])) {
      const accepted = [term, ...extra]
      const scores = []
      for (const writing of writings) {
        const out = join(work, `${engine}-${n++}.wav`)
        try {
          await ENGINES[voice.engine].synthesize({ text: CARRIER[lang](writing), voice, out, config })
          const { text } = await listener.send({ file: out, language: lang })
          scores.push({ writing, ok: heardRight(text, accepted), heard: text })
        } catch (error) {
          scores.push({ writing, ok: false, heard: `(error: ${String(error.message).split('\n')[0]})` })
        }
      }
      // Ties keep the term as written: the first that was heard right
      const best = scores.find(s => s.ok)
      chosen[term] = { say: best ? (best.writing === term ? null : best.writing) : null, heard: Boolean(best), tried: scores }
      process.stderr.write(`${engine} ${term.padEnd(12)} ${best ? `✔ ${best.writing}` : `✘ none (${scores.map(s => s.heard).join(' | ')})`}\n`)
    }
    result[lang][engine] = Object.fromEntries(Object.entries(chosen).map(([t, c]) => [t, { say: c.say, heard: c.heard, tried: c.tried.map(s => `${s.ok ? '✔' : '✘'} ${s.writing} → ${s.heard}`) }]))
    // Read again before writing: another language may be calibrating at the same time
    const latest = JSON.parse(readFileSync(file, 'utf8'))
    latest[lang] = { ...latest[lang], [engine]: result[lang][engine] }
    writeFileSync(file, `${JSON.stringify(latest, null, 2)}\n`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
  process.exit(0)
}
