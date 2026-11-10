import OpenAI from 'openai'
import * as z from 'zod/v4'
import { AiError, jsonSchemaOf, parseJsonText, type CallUsage, type ChatRequest, type EmbedProvider, type JsonRequest, type RawChatProvider, type Result } from './provider'

/**
 * Provider for the OpenAI Chat Completions API.
 * Also used for Ollama, which exposes the same API at `<ollamaUrl>/v1` (billed as 'local', i.e. free).
 */
export class OpenAICompatProvider implements RawChatProvider {
  private client: OpenAI
  readonly billing: 'api' | 'local'

  constructor(
    readonly id: 'openai' | 'ollama',
    readonly model: string,
    opts: { apiKey: string; baseURL?: string }
  ) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL })
    this.billing = id === 'ollama' ? 'local' : 'api'
  }

  private async run(req: ChatRequest, jsonSchema?: { name: string; schema: Record<string, unknown> }): Promise<Result<string>> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 8000,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt }
        ],
        ...(jsonSchema
          ? { response_format: { type: 'json_schema' as const, json_schema: { name: jsonSchema.name, schema: jsonSchema.schema } } }
          : {})
      })
      const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0
      const usage: CallUsage = {
        model: res.model,
        inputTokens: (res.usage?.prompt_tokens ?? 0) - cached,
        cacheReadTokens: cached,
        outputTokens: res.usage?.completion_tokens ?? 0
      }
      const choice = res.choices[0]
      if (choice?.finish_reason === 'length') {
        const e = new AiError('The response was cut off by the token limit.')
        e.usage = usage
        throw e
      }
      return { value: choice?.message?.content ?? '', usage }
    } catch (err) {
      if (err instanceof AiError) throw err
      if (err instanceof OpenAI.APIConnectionError) {
        throw new AiError(this.id === 'ollama' ? 'Could not connect to Ollama. Is it running?' : 'Connection to OpenAI failed.')
      }
      if (err instanceof OpenAI.APIError) throw new AiError(`Provider error ${this.id} (${err.status}): ${err.message}`)
      throw err
    }
  }

  completeRaw(req: ChatRequest): Promise<Result<string>> {
    return this.run(req)
  }

  async jsonRaw<S extends z.ZodType>(req: JsonRequest<S>): Promise<Result<z.infer<S>>> {
    const schema = jsonSchemaOf(req.schema)
    const prompt = `${req.prompt}\n\nRespond ONLY with a valid JSON object that follows this JSON Schema:\n${JSON.stringify(schema)}`
    const { value: text, usage } = await this.run({ ...req, prompt }, { name: req.name, schema })
    try {
      return { value: parseJsonText(text, req.schema), usage }
    } catch (err) {
      if (err instanceof AiError) err.usage = usage
      throw err
    }
  }
}

export class OpenAICompatEmbedder implements EmbedProvider {
  private client: OpenAI
  readonly modelId: string

  constructor(
    private providerId: 'openai' | 'ollama',
    private model: string,
    opts: { apiKey: string; baseURL?: string },
    /** Called with the token count of each request, for usage tracking */
    private onUsage: (tokens: number) => void = () => {}
  ) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL })
    this.modelId = `${providerId}:${model}`
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 64) {
      const res = await this.client.embeddings.create({ model: this.model, input: texts.slice(i, i + 64) })
      this.onUsage(res.usage?.prompt_tokens ?? 0)
      for (const d of res.data) out.push(normalize(Float32Array.from(d.embedding)))
    }
    return out
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.embedDocuments([text]))[0]
  }
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}
