// Script macros, resolved before validation, so renderers only ever see plain steps:
//
//   vars     { product: Acme }      "{{product}}" in any text becomes Acme; "{{user.name}}" reads objects
//   blocks   { login: [steps] }     reusable groups of steps…
//   use      login | { block, with } …inserted where they are used, with their own variables
//   repeat   { times | each, as, steps }   the same steps several times ({{index}}, {{item}})
//
// Pure data in, pure data out: safe for scripts that come from the API.
import { UserError } from '../util.js'

// A script from the API may not explode into millions of steps
const MAX_STEPS = 5000
const MAX_DEPTH = 20
const MAX_REPEAT = 500
const VAR = /\{\{\s*([\w.]+)\s*\}\}/g
const WHOLE = /^\{\{\s*([\w.]+)\s*\}\}$/

const lookup = (name, scope) => {
  let value = scope
  for (const part of name.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) {
      throw new UserError(`{{${name}}} is not defined (variables: ${Object.keys(scope).join(', ') || 'none'})`)
    }
    value = value[part]
  }
  return value
}

// "{{n}}" alone keeps the value's type (a number stays a number); inside a text it becomes text.
export const substitute = (value, scope) => {
  if (typeof value === 'string') {
    const whole = WHOLE.exec(value)
    if (whole) return lookup(whole[1], scope)
    return value.replace(VAR, (_, name) => {
      const v = lookup(name, scope)
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    })
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, scope))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, scope)]))
  return value
}

export const expandScript = (data, { vars: extra = {} } = {}) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const { vars = {}, blocks = {}, ...rest } = data
  if (typeof vars !== 'object' || Array.isArray(vars) || !vars) throw new UserError('vars: must be an object of name: value')
  if (typeof blocks !== 'object' || Array.isArray(blocks) || !blocks) throw new UserError('blocks: must be an object of name: [steps]')
  const scope = { ...vars, ...extra }
  let count = 0

  const expandSteps = (steps, scope, depth, where) => {
    if (!Array.isArray(steps)) return substitute(steps, scope)
    if (depth > MAX_DEPTH) throw new UserError(`${where}: blocks and repeats nested more than ${MAX_DEPTH} levels (does a block use itself?)`)
    const out = []
    for (const step of steps) {
      if (!step || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).length !== 1) {
        out.push(step) // validation explains what is wrong with it
        continue
      }
      const [[action, arg]] = Object.entries(step)
      if (action === 'use') {
        const { block, with: vars = {} } = typeof arg === 'string' ? { block: arg } : (arg ?? {})
        const name = substitute(block, scope)
        if (!Object.hasOwn(blocks, name)) throw new UserError(`use: there is no block "${name}" (blocks: ${Object.keys(blocks).join(', ') || 'none'})`)
        out.push(...expandSteps(blocks[name], { ...scope, ...substitute(vars, scope) }, depth + 1, `block ${name}`))
        continue
      }
      if (action === 'repeat' && arg && typeof arg === 'object') {
        const times = arg.each === undefined ? Number(substitute(arg.times, scope)) : 0
        // Checked before anything is allocated: validation only sees the expanded script
        if (arg.each === undefined && !(Number.isInteger(times) && times >= 1 && times <= MAX_REPEAT)) throw new UserError(`${where}: repeat.times must be a whole number from 1 to ${MAX_REPEAT}`)
        const items = arg.each !== undefined ? substitute(arg.each, scope) : Array.from({ length: times }, (_, i) => i + 1)
        if (!Array.isArray(items)) throw new UserError(`${where}: repeat.each must be a list`)
        if (items.length > MAX_REPEAT) throw new UserError(`${where}: repeat.each has more than ${MAX_REPEAT} items`)
        items.forEach((item, i) => {
          out.push(...expandSteps(arg.steps, { ...scope, index: i + 1, item, ...(arg.as ? { [arg.as]: item } : {}) }, depth + 1, `${where} repeat`))
        })
        continue
      }
      count++
      if (count > MAX_STEPS) throw new UserError(`the script expands to more than ${MAX_STEPS} steps`)
      out.push({ [action]: expandNested(action, arg, scope, depth, where) })
    }
    return out
  }

  // Steps inside other steps (offCamera, try, if) expand with the same rules
  const expandNested = (action, arg, scope, depth, where) => {
    if (action === 'offCamera') return expandSteps(arg, scope, depth + 1, where)
    if (action === 'try') return Array.isArray(arg) ? expandSteps(arg, scope, depth + 1, where) : { ...substitute({ ...arg, steps: undefined }, scope), steps: expandSteps(arg?.steps, scope, depth + 1, where) }
    if (action === 'if' && arg && typeof arg === 'object') {
      const { then, else: otherwise, ...condition } = arg
      return {
        ...substitute(condition, scope),
        then: expandSteps(then, scope, depth + 1, where),
        ...(otherwise !== undefined ? { else: expandSteps(otherwise, scope, depth + 1, where) } : {}),
      }
    }
    return substitute(arg, scope)
  }

  const out = {}
  for (const [key, value] of Object.entries(rest)) {
    out[key] = key === 'steps' || key === 'setup' ? expandSteps(value, scope, 0, key) : substitute(value, scope)
  }
  return out
}
