// Text-to-speech with pluggable engines and a disk cache.
//
// A voice is a string `engine:id[?option=value&…]`, or an alias (built-in, from the config or from the
// script's `voices`), optionally with more options: `salome?rate=+10%` is Salome, a bit faster.
//   pocket:lola                             offline, open, natural (default once installed)
//   piper:es_MX-claude-high                 offline, open source, light (default without Pocket TTS)
//   edge:es-CO-SalomeNeural?rate=-4%        Microsoft Edge neural voices (needs internet, unofficial)
//   openai:alloy?model=tts-1-hd             any OpenAI-compatible /v1/audio/speech server
//   command:my-voice                        TOURWRIGHT_TTS_COMMAND, for any other engine
//
// Every voice understands rate, pitch and volume: engines that cannot do one natively get it from ffmpeg.
//
// How a phrase is built: it is split only between sentences (after . ? !). Each sentence is synthesized
// whole, so commas are breathed by the voice itself; the silence around each one is trimmed and a short,
// even pause is placed between them. Every sentence and phrase is cached by engine, voice and text:
// rendering the same script twice never asks the engine again.
//
// The voice domain, one concern per module: voices.js (which voice), text.js (the words), sound.js (polish and
// prosody), narrate.js (synthesis and cache), samples.js (listing and samples).
export { ALIASES, parseVoice, autoVoice, withProsody, voiceLanguages } from './voices.js'
export { POLISH_DEFAULT, POLISH_PRESETS, LOUDNESS, polishTone, polishFilter, prosodyFilter } from './sound.js'
export { stripMarks, markedLine, applyPronunciation, splitSentences, splitNarration } from './text.js'
export { wavDuration, durationOf, narrate } from './narrate.js'
export { SAMPLES_DIR, SAMPLES_URL, recordSamples, listVoices } from './samples.js'
