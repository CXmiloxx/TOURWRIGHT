// What a page offers, read from Playwright's aria snapshot: its elements, what it says it is for, the sections
// in its navigation and the controls worth a focus.


// Roles a script points at. Rows and cells are left out: they hold the app's data, not its interface.
const ROLES = ['heading', 'tablist', 'tab', 'radiogroup', 'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'switch', 'region', 'figure', 'list', 'navigation', 'dialog']
export const CONTROLS = ['button', 'searchbox', 'textbox', 'combobox', 'radiogroup', 'tablist', 'checkbox', 'switch']

// A line of Playwright's aria snapshot: `- role "name" [level=1]:` or `- paragraph: text`
const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?(?: \[([^\]]*)\])?(?::\s*(.*))?$/

/**
 * Elements of a page, in reading order, from its aria snapshot. Everything inside a table is skipped.
 * @param {string} snapshot
 * @returns {{ role: string, name?: string, text?: string, level?: number, url?: string, within: string[] }[]}
 */
export const outline = snapshot => {
  const items = []
  const parents = []
  const lines = snapshot.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i])
    if (!m) continue
    const [, indentText, role, rawName, attrs, rest] = m
    const indent = indentText.length
    while (parents.length && parents.at(-1).indent >= indent) parents.pop()
    if (parents.some(p => p.role === 'table')) continue
    parents.push({ indent, role })
    const name = rawName?.replace(/\\(.)/g, '$1')
    const level = Number(/level=(\d)/.exec(attrs ?? '')?.[1]) || undefined
    const url = /^\s*- \/url: (.+)$/.exec(lines[i + 1] ?? '')?.[1]
    const text = rest && !rest.startsWith('-') ? rest.replace(/^"|"$/g, '') : undefined
    items.push({ role, name, text, level, url, within: parents.slice(0, -1).map(p => p.role) })
  }
  return items
}

// What a page is: its main heading, the sentence under it, and the elements worth targeting
export const describe = items => {
  const h1 = items.find(i => i.role === 'heading' && i.level === 1 && i.name)
  const after = h1 ? items.slice(items.indexOf(h1) + 1) : items
  const description = after.find(i => i.role === 'paragraph' && i.text && i.text.length > 20)?.text
  const seen = new Set()
  const targets = items
    // A long name is a record (a person, a payment) shown as a link or button, not part of the interface
    .filter(i => ROLES.includes(i.role) && i.name && i.name.length <= 60 && !i.within.includes('navigation'))
    .filter(i => {
      const key = `${i.role}|${i.name}`
      return !seen.has(key) && seen.add(key)
    })
    .map(i => ({ role: i.role, name: i.name }))
  return { heading: h1?.name, description, targets }
}

// One page under two paths, / and /index.html, is one section
export const samePage = path => path.replace(/\/index\.(html?|php|aspx?)(?=$|\?)/i, '/')

// The sections of a site: the links of its navigation (and of its top bar), same origin, once each
export const sections = (items, pageUrl) => {
  const origin = new URL(pageUrl).origin
  const found = new Map()
  for (const i of items) {
    if (i.role !== 'link' || !i.name || !i.url || i.url.startsWith('#')) continue
    if (!i.within.includes('navigation') && !i.within.includes('banner')) continue
    const u = new URL(i.url, pageUrl)
    if (u.origin !== origin) continue
    const path = u.pathname + u.search
    if (![...found.values()].some(f => samePage(f.path) === samePage(path))) found.set(path, { name: i.name, path })
  }
  return [...found.values()]
}

// The controls worth a focus on a page: filters and tabs first, then the main buttons, then search.
// Generic ones (a calendar, "Actions", "Copy") are left for the person to add if they matter.
const GENERIC = /^(buscar|search|elegir|choose|acciones|actions|copiar|copy|cerrar|close|siguiente|next|anterior|previous|mostrar|show)\b/i
const PRIORITY = ['radiogroup', 'tablist', 'button', 'searchbox', 'combobox']
export const keyControls = (page, max = 2) =>
  page.targets
    .filter(t => PRIORITY.includes(t.role) && !GENERIC.test(t.name) && t.name.length <= 40)
    .sort((a, b) => PRIORITY.indexOf(a.role) - PRIORITY.indexOf(b.role))
    .slice(0, max)
