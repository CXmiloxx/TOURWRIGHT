// Creating jobs and reading their results: shared by the HTTP API and the MCP server.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromData, parseText } from '../script/load.js'
import { newId, UserError } from '../util.js'

const ASSET_NAME = /^[\w][\w.-]{0,120}$/
const OPTION_KEYS = ['voice', 'quality', 'capture', 'dryRun', 'width', 'height']

// request: { script (object or YAML/JSON text), vars?, assets?: { name: base64 }, options?, webhook? }
/** @param {{ backend: any, blobs: any, config?: any }} deps @param {any} request @param {{ owner?: string | null, workDir: string }} who */
export const createJob = async ({ backend, blobs }, request, { owner = null, workDir }) => {
  const data = typeof request.script === 'string' ? parseText(request.script, request.format === 'json' ? 'json' : 'yaml') : request.script
  if (!data || typeof data !== 'object') throw new UserError('`script` is required: a script object, or YAML/JSON text')
  if (request.vars !== undefined && (typeof request.vars !== 'object' || Array.isArray(request.vars) || !request.vars)) throw new UserError('`vars` must be an object')
  const loaded = fromData(data, { sandboxed: true, vars: request.vars })
  const options = Object.fromEntries(Object.entries(request.options ?? {}).filter(([k]) => OPTION_KEYS.includes(k)))
  if (request.webhook && !/^https?:\/\//.test(request.webhook)) throw new UserError('webhook must be an http(s) URL')
  const assets = Object.entries(request.assets ?? {})
  for (const [name] of assets) if (!ASSET_NAME.test(name)) throw new UserError(`invalid asset name "${name}" (letters, digits, . _ -)`)

  const id = newId()
  const dir = join(workDir, `upload-${id}`)
  mkdirSync(dir, { recursive: true })
  const keys = []
  try {
    writeFileSync(join(dir, 'script.json'), JSON.stringify(loaded.script))
    await blobs.put(`jobs/${id}/input/script.json`, join(dir, 'script.json'))
    keys.push(`jobs/${id}/input/script.json`)
    for (const [name, b64] of assets) {
      writeFileSync(join(dir, name), Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64'))
      await blobs.put(`jobs/${id}/input/${name}`, join(dir, name))
      keys.push(`jobs/${id}/input/${name}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const job = {
    id,
    status: 'queued',
    kind: loaded.kind,
    title: loaded.script.title ?? null,
    owner,
    options,
    webhook: request.webhook ?? null,
    inputs: keys,
    outputs: [],
    attempts: 0,
    createdAt: new Date().toISOString(),
  }
  await backend.store.save(job)
  await backend.queue.enqueue(id)
  return job
}

// Download links for a finished job: presigned S3 URLs, or signed links to the API.
export const resultWithLinks = async (job, { blobs, signLink }) => {
  if (!job.result) return job.result
  const links = {}
  for (const [kind, file] of Object.entries(job.result.files ?? {})) {
    links[kind] = (await blobs.url(`jobs/${job.id}/out/${file}`)) ?? signLink?.(job.id, file) ?? null
  }
  return { ...job.result, links }
}

export const deleteJobFiles = async (job, blobs) => {
  const keys = [...(job.inputs ?? []), ...(job.outputs ?? [])]
  if (blobs.remove) await blobs.remove(keys)
  await blobs.removePrefix(`jobs/${job.id}/input`)
  await blobs.removePrefix(`jobs/${job.id}/out`)
}
