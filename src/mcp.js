// MCP server (stdio) so AI agents can make videos: write a script, render it, get the files.
//
//   local mode   (default) jobs go to this machine's queue and an embedded worker renders them
//   remote mode  TOURWRIGHT_API_URL (+ TOURWRIGHT_API_TOKEN): jobs go to a Tourwright API, wherever it runs
import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { openBlobs } from './jobs/blobs.js'
import { linkSigner } from './jobs/links.js'
import { createJob, resultWithLinks } from './jobs/service.js'
import { createBackend, publicJob } from './jobs/store.js'
import { loadPlugins } from './plugins.js'
import { outputBase, render } from './render/index.js'
import { loadFile, fromData, parseText } from './script/load.js'
import { log, sleep, UserError } from './util.js'
import { listVoices } from './voice/index.js'

const GUIDE = new URL('../docs/SCRIPTS.md', import.meta.url)

const remoteClient = (base, token) => {
  const call = async (method, path, body) => {
    const r = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new UserError(data.error ?? `API answered ${r.status}`)
    return data
  }
  return {
    voices: () => call('GET', '/v1/voices'),
    validate: body => call('POST', '/v1/validate', body),
    create: body => call('POST', '/v1/jobs', body),
    job: id => call('GET', `/v1/jobs/${id}`),
  }
}

const localClient = async config => {
  const backend = await createBackend(config)
  const blobs = await openBlobs(config)
  const signLink = linkSigner(config)
  const view = async job => {
    const v = { ...publicJob(job), result: await resultWithLinks(job, { blobs, signLink }) }
    if (job.result && blobs.kind === 'local') v.result.paths = Object.fromEntries(Object.entries(job.result.files).map(([k, f]) => [k, blobs.path(`jobs/${job.id}/out/${f}`)]))
    return v
  }
  return {
    voices: () => listVoices(config),
    validate: async body => {
      try {
        fromData(typeof body.script === 'string' ? parseText(body.script) : body.script, { sandboxed: true, vars: body.vars })
        return { ok: true }
      } catch (error) {
        if (!(error instanceof UserError)) throw error
        return { ok: false, errors: error.message.replace(/^invalid script:\n\s*/, '').split(/\n\s*/) }
      }
    },
    create: async body => view(await createJob({ backend, blobs, config }, body, { owner: null, workDir: config.tmpDir ?? tmpdir() })),
    job: async id => {
      const job = await backend.store.get(id)
      if (!job) throw new UserError(`job ${id} not found`)
      return view(job)
    },
  }
}

const text = data => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })
const failure = error => ({ isError: true, content: [{ type: 'text', text: error instanceof UserError ? error.message : `error: ${error.message}` }] })
const safe = fn => async args => {
  try {
    return await fn(args)
  } catch (error) {
    return failure(error)
  }
}

const scriptInput = z.union([z.string(), z.record(z.string(), z.unknown())])
  .describe('The script: an object, or YAML/JSON text. Read tourwright_guide first for the format.')
const varsInput = z.record(z.string(), z.unknown()).optional()
  .describe('Values for the script variables ({{name}}): the same script makes a different video per set of values')

export const startMcp = async config => {
  await loadPlugins(config)
  const remote = process.env.TOURWRIGHT_API_URL
  const client = remote ? remoteClient(remote, process.env.TOURWRIGHT_API_TOKEN) : await localClient(config)
  const server = new McpServer({ name: 'tourwright', version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version })

  server.registerTool('tourwright_guide', {
    title: 'How to write a Tourwright script',
    description: 'The script format (browser walkthroughs and narrated slides), every action, voices and examples. Read it before writing a script.',
    inputSchema: {},
  }, safe(async () => text(readFileSync(GUIDE, 'utf8'))))

  server.registerTool('tourwright_voices', {
    title: 'List voices',
    description: 'Text-to-speech voices available on the server and which engines work.',
    inputSchema: {},
  }, safe(async () => text(await client.voices())))

  server.registerTool('tourwright_validate', {
    title: 'Validate a script',
    description: 'Check a script without rendering it. Returns { ok } or the list of errors to fix.',
    inputSchema: { script: scriptInput, vars: varsInput },
  }, safe(async ({ script, vars }) => text(await client.validate({ script, vars }))))

  server.registerTool('tourwright_render', {
    title: 'Render a video',
    description: 'Queue a script for rendering. With wait=true (default) it waits until the video is ready and returns its links (and local paths), duration, chapters and captions; otherwise it returns the job id to poll with tourwright_job.',
    inputSchema: {
      script: scriptInput,
      vars: varsInput,
      assets: z.record(z.string(), z.string()).optional().describe('Files the script refers to by name (images, music, uploads), base64-encoded'),
      options: z.object({
        voice: z.string().optional(),
        quality: z.enum(['sd', 'hd', 'fullhd', 'vertical', 'square']).optional(),
        dryRun: z.boolean().optional().describe('Run the script fast without voice or video, to test it'),
      }).optional(),
      wait: z.boolean().optional(),
      waitSeconds: z.number().int().min(5).max(3600).optional(),
    },
  }, safe(async ({ script, vars, assets, options, wait = true, waitSeconds = 900 }) => {
    let job = await client.create({ script, vars, assets, options })
    if (!wait) return text(job)
    const until = Date.now() + waitSeconds * 1000
    while ((job.status === 'queued' || job.status === 'running') && Date.now() < until) {
      await sleep(2000)
      job = await client.job(job.id)
    }
    return job.status === 'failed' ? { isError: true, ...text(job) } : text(job)
  }))

  server.registerTool('tourwright_job', {
    title: 'Job status',
    description: 'Status, progress and (when done) the result of a render job.',
    inputSchema: { id: z.string() },
  }, safe(async ({ id }) => text(await client.job(id))))

  // Scripts on this machine's disk, with local images and JavaScript. Trusted: off unless enabled.
  if (!remote && process.env.TOURWRIGHT_MCP_ALLOW_FILES === 'true') {
    server.registerTool('tourwright_render_file', {
      title: 'Render a script file',
      description: 'Render a script file from this machine (.yaml, .json, .js). Paths inside it resolve next to the file.',
      inputSchema: { path: z.string(), out: z.string().optional().describe('Output .mp4 path or folder'), dryRun: z.boolean().optional() },
    }, safe(async ({ path, out, dryRun }) => {
      const loaded = await loadFile(path)
      const result = await render(loaded, { out: out ?? outputBase(undefined, loaded.name), dryRun }, config)
      return text(result)
    }))
  }

  if (!remote && process.env.TOURWRIGHT_MCP_WORKER !== 'false') {
    const { startWorker } = await import('./worker.js')
    startWorker(config).catch(error => log.error(`embedded worker: ${error.message}`))
  }
  await server.connect(new StdioServerTransport())
  log.info(`MCP server ready (${remote ? `remote ${remote}` : 'local'})`)
}
