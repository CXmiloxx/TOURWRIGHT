// `tourwright explore <url | script>`: what a person needs to write a script for a site, without devtools.
//
// It opens the site like the script would (logging in off camera with `setup` and the saved session; for a
// bare URL it finds the login form itself and asks for the credentials), finds the sections in the site's
// navigation and, for each page, prints its title, what the page says it is for and the targets to paste
// into a script. It saves a screenshot of each page (with the script's `blur`) and, with --draft, writes a
// first script that already goes through every section with narration taken from the pages.
export { outline, describe, sections, keyControls } from './page.js'
export { draftScript } from './draft.js'
export { secretPrefix } from './login.js'
export { explore, printReport } from './crawl.js'
