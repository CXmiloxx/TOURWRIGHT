// The AI a person brings, for writing (`tourwright narrate`). Tourwright does not ship one: it connects to the one
// configured, like it does with voices.
//   anthropic  Claude, through the official SDK (optional dependency). Key: ANTHROPIC_API_KEY, or
//              `tourwright secret set AI_KEY`, or an `ant auth login` profile.
//   openai     Any server speaking OpenAI's /v1/chat/completions: OpenAI, OpenRouter, LM Studio, vLLM…
//   ollama     Ollama on this machine (http://127.0.0.1:11434): free, and nothing leaves the PC.
// Every provider gets the same request (a system text, then texts and JPEG pictures in order: each picture next to
// the words about it) and answers JSON matching a schema.
import { getSecret } from '#core/secrets.js'
import { UserError } from '#core/util.js'

export const AI_PROVIDERS = ['anthropic', 'openai', 'ollama']
const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', openai: 'gpt-4o-mini', ollama: 'gemma3' }
const DEFAULT_URLS = { openai: 'https://api.openai.com', ollama: 'http://127.0.0.1:11434' }

/** Which AI is configured, or null. The key never comes from a file anyone can read. */
export const aiSettings = config => {
  const env = process.env
  const ai = config.ai ?? {}
  const provider = ai.provider ?? (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : null)
  if (!provider) return null
  if (!AI_PROVIDERS.includes(provider)) throw new UserError(`AI provider "${provider}": use ${AI_PROVIDERS.join(', ')}`)
  const key = env.TOURWRIGHT_AI_KEY ?? getSecret(config, 'AI_KEY') ??
    (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : provider === 'openai' ? env.OPENAI_API_KEY : undefined)
  return { provider, model: ai.model ?? DEFAULT_MODELS[provider], url: ai.url ?? DEFAULT_URLS[provider], key }
}

const NO_AI = 'no AI configured. Bring yours: tourwright config set ai anthropic (key: ANTHROPIC_API_KEY or `tourwright secret set AI_KEY`), ' +
  'ai openai (any OpenAI-compatible server: also set aiUrl), or ai ollama (free, on this PC: https://ollama.com, then `ollama pull gemma3`)'

/**
 * @param {{ system: string, parts: ({ text: string } | { image: Buffer })[], schema: object }} request
 * @returns {Promise<any>} the JSON the model answered
 */
export const askAi = async (request, config) => {
  const ai = aiSettings(config)
  if (!ai) throw new UserError(NO_AI)
  return ai.provider === 'anthropic' ? askClaude(request, ai) : askOpenAiCompatible(request, ai)
}

// Claude, with the official SDK: structured output, and the server's own fallback when a request is declined
const askClaude = async ({ system, parts, schema }, ai) => {
  let Anthropic
  try {
    Anthropic = (await import('@anthropic-ai/sdk')).default
  } catch {
    throw new UserError('the Claude SDK is not installed: npm install @anthropic-ai/sdk where Tourwright is (with -g if Tourwright is global)')
  }
  const client = new Anthropic({ ...(ai.key ? { apiKey: ai.key } : {}), ...(ai.url ? { baseURL: ai.url } : {}) })
  const content = parts.map(p => ('image' in p
    ? { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.image.toString('base64') } }
    : { type: 'text', text: p.text }))
  let response
  try {
    response = await client.beta.messages.create({
      model: ai.model,
      max_tokens: 16000,
      // Writing short lines from what is on screen: medium effort is plenty
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      // A request the model declines is answered by the recommended fallback model instead
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content }],
    })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new UserError('Claude did not accept the key: check ANTHROPIC_API_KEY or `tourwright secret set AI_KEY`')
    if (error instanceof Anthropic.RateLimitError) throw new UserError('Claude is rate limiting this key: try again in a minute')
    if (error instanceof Anthropic.BadRequestError) throw new UserError(`Claude refused the request: ${error.message}`)
    throw error
  }
  if (response.stop_reason === 'refusal') throw new UserError(`Claude declined to write this narration${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`)
  if (response.stop_reason === 'max_tokens') throw new UserError('the narration was cut off: the script has too many steps for one request')
  const answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return parseJson(answer)
}

// OpenAI's chat completions shape: OpenAI, OpenRouter, LM Studio, vLLM, and Ollama's /v1
const askOpenAiCompatible = async ({ system, parts, schema }, ai) => {
  const base = ai.url.replace(/\/$/, '').replace(/\/v1$/, '')
  const body = {
    model: ai.model,
    messages: [
      { role: 'system', content: `${system}\n\nAnswer only with JSON matching this schema:\n${JSON.stringify(schema)}` },
      {
        role: 'user',
        content: parts.map(p => ('image' in p
          ? { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.image.toString('base64')}` } }
          : { type: 'text', text: p.text })),
      },
    ],
    response_format: { type: 'json_object' },
  }
  let response
  try {
    response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ai.key ? { authorization: `Bearer ${ai.key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    })
  } catch (error) {
    throw new UserError(ai.provider === 'ollama'
      ? `Ollama does not answer at ${base}: is it running? (ollama serve, then ollama pull ${ai.model})`
      : `cannot reach ${base}: ${error.message}`)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new UserError(`${ai.provider} answered ${response.status}: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`)
  return parseJson(data.choices?.[0]?.message?.content ?? '')
}

// The JSON in an answer, also when a model wraps it in prose or a code fence
export const parseJson = text => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new UserError(`the AI did not answer JSON: ${text.slice(0, 160)}`)
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw new UserError(`the AI answered broken JSON (${error.message})`)
  }
}
