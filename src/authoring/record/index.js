// `tourwright record <url>`: write a script by doing the tour by hand. A browser window opens; every click,
// every field filled and every choice made is written down as a step with a stable target (role and name,
// label, placeholder — the same ones `explore` lists), with a first narration to rewrite. Closing the window
// (or Ctrl+C) writes the script. A password is never written: it becomes ${secret:…}.
export { LISTEN } from './listen.js'
export { stepsFrom, introStep, outroStep, studioTheme, recordedScript, secretsTyped } from './steps.js'
export { record } from './session.js'
