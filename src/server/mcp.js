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
import { createJob, deleteJobFiles, resultWithLinks } from './jobs/service.js'
import { createBackend, publicJob } from './jobs/store.js'
import { loadPlugins } from '#plugins/index.js'
import { applyFixes, checkScript } from '#authoring/repair.js'
import { outputBase, render } from '#render/index.js'
import { loadFile, fromData, parseText } from '#script/load.js'
import { fromRoot, version } from '#core/paths.js'
import { log, sleep, UserError } from '#core/util.js'
import { listVoices } from '#voice/index.js'

const GUIDE = fromRoot('docs', 'SCRIPTS.md')

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
    job: id => call('GET', `/v1/jobs/${encodeURIComponent(id)}`),
    jobs: ({ status, limit }) => call('GET', `/v1/jobs?${new URLSearchParams({ limit: String(limit), ...(status ? { status } : {}) })}`),
    remove: async id => {
      await call('DELETE', `/v1/jobs/${encodeURIComponent(id)}`)
      return { deleted: id }
    },
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
    jobs: async ({ status, limit }) => ({ jobs: await Promise.all((await backend.store.list({ limit, status })).map(view)) }),
    // The same rule as the API: a job still queued or rendering is not deleted
    remove: async id => {
      const job = await backend.store.get(id)
      if (!job) throw new UserError(`job ${id} not found`)
      if (job.status === 'running' || job.status === 'queued') throw new UserError(`job ${id} is ${job.status}: wait until it ends`)
      await deleteJobFiles(job, blobs)
      await backend.store.remove(job.id)
      return { deleted: id }
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
  const server = new McpServer({ name: 'tourwright', version: version() })

  server.registerTool('tourwright_guide', {
    title: 'How to write a Tourwright script',
    description: 'The script format (browser walkthroughs and narrated slides), every action, voices and examples. Read it before writing a script.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, safe(async () => text(readFileSync(GUIDE, 'utf8'))))

  server.registerTool('tourwright_voices', {
    title: 'List voices',
    description: 'Text-to-speech voices available on the server and which engines work. Use a voice whose language matches the script.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, safe(async () => text(await client.voices())))

  server.registerTool('tourwright_validate', {
    title: 'Validate a script',
    description: 'Check the structure of a script (fields, actions, variables) without opening any website: fast, offline. Returns { ok } or the list of errors to fix. To know whether its targets still exist on the live site, use tourwright_check.',
    inputSchema: { script: scriptInput, vars: varsInput },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, safe(async ({ script, vars }) => text(await client.validate({ script, vars }))))

  server.registerTool('tourwright_render', {
    title: 'Render a video',
    description: 'Queue a script for rendering. With wait=true (default) it waits until the video is ready and returns its links (and local paths), duration, chapters and captions; otherwise it returns the job id to poll with tourwright_job.',
    inputSchema: {
      script: scriptInput,
      vars: varsInput,
      assets: z.record(z.string(), z.string()).optional().describe('Files the script refers to by name (images, music, uploads), base64-encoded'),
      options: z.object({
        voice: z.string().optional().describe('Voice for the whole video, overriding the script: a name from tourwright_voices'),
        quality: z.enum(['sd', 'hd', 'fullhd', 'vertical', 'square']).optional().describe('Size of the video: sd 480p, hd 720p, fullhd 1080p, vertical 1080x1920, square 1080x1080'),
        dryRun: z.boolean().optional().describe('Run the script fast without voice or video, to test it'),
        safe: z.boolean().optional().describe('A dry run that finds every element but presses, types and chooses nothing: nothing real happens in the app'),
      }).optional().describe('Render settings that override the script'),
      wait: z.boolean().optional().describe('Wait for the video (default true); false returns the job id at once, to poll with tourwright_job'),
      waitSeconds: z.number().int().min(5).max(3600).optional().describe('How long to wait for the video before returning the job as it is (default 900)'),
    },
    // It opens the script's website in a real browser
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
    inputSchema: { id: z.string().describe('The job id returned by tourwright_render with wait=false') },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, safe(async ({ id }) => text(await client.job(id))))

  server.registerTool('tourwright_jobs', {
    title: 'List jobs',
    description: 'The render jobs on this server, newest first: id, status, progress and, for finished ones, the links to their videos. Use it to find a video rendered earlier or a job id to delete.',
    inputSchema: {
      status: z.enum(['queued', 'running', 'done', 'failed']).optional().describe('Only jobs with this status'),
      limit: z.number().int().min(1).max(200).optional().describe('How many jobs at most (default 20)'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, safe(async ({ status, limit = 20 }) => text(await client.jobs({ status, limit }))))

  server.registerTool('tourwright_delete_job', {
    title: 'Delete a job',
    description: 'Delete a finished (done or failed) job and its files: the video, subtitles, poster and manifest. A job that is queued or rendering cannot be deleted.',
    inputSchema: { id: z.string().describe('The job id, from tourwright_render or tourwright_jobs') },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, safe(async ({ id }) => text(await client.remove(id))))

  // Runs a script as a dry run in this process: every broken step, the elements on its page and a proposed fix
  if (!remote) {
    server.registerTool('tourwright_check', {
      title: 'Check a script and propose fixes',
      description: 'Run a script fast, without voice or video, against the real site (validate only checks its structure). Returns every step that failed (the target it looked for, the page, the targets that page offers) and, when it can tell, the new target for it. For a YAML script given as text it also returns `fixed`: the same text with those targets replaced (comments kept). Use it after the site changed, then validate and render.',
      inputSchema: { script: scriptInput, vars: varsInput },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    }, safe(async ({ script, vars }) => {
      const loaded = fromData(typeof script === 'string' ? parseText(script) : script, { sandboxed: true, vars })
      const result = await checkScript(loaded, {}, config)
      const fixes = result.failures.map(f => f.fix).filter(Boolean)
      const fixed = typeof script === 'string' && fixes.length ? applyFixes(script, fixes).text : undefined
      return text({ ...result, failures: result.failures.map(({ fix, ...f }) => ({ ...f, fix: fix && { from: fix.from, to: fix.to, confidence: fix.score } })), fixed })
    }))
  }

  // Scripts on this machine's disk, with local images and JavaScript. Trusted: off unless enabled.
  if (!remote && process.env.TOURWRIGHT_MCP_ALLOW_FILES === 'true') {
    server.registerTool('tourwright_render_file', {
      title: 'Render a script file',
      description: 'Render a script file from this machine (.yaml, .json, .js). Paths inside it resolve next to the file.',
      inputSchema: {
        path: z.string().describe('Path of the script file on this machine'),
        out: z.string().optional().describe('Output .mp4 path or folder (default: ./videos/<name>/)'),
        dryRun: z.boolean().optional().describe('Run the script fast without voice or video, to test it'),
        safe: z.boolean().optional().describe('A dry run that finds every element but presses, types and chooses nothing: nothing real happens in the app'),
      },
      // Writes the video files, replacing a previous render with the same name
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, safe(async ({ path, out, dryRun, safe: rehearse }) => {
      const loaded = await loadFile(path)
      const result = await render(loaded, { out: out ?? outputBase(undefined, loaded.name), dryRun: dryRun || rehearse, safe: rehearse }, config)
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
