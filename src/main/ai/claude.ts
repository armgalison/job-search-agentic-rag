import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type * as z from 'zod/v4'
import { AiError, type CallUsage, type ChatRequest, type JsonRequest, type RawChatProvider, type Result } from './provider'

function describeError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) throw new AiError('Invalid Anthropic API key.')
  if (err instanceof Anthropic.RateLimitError) throw new AiError('Anthropic rate limit reached; try again shortly.')
  if (err instanceof Anthropic.BadRequestError) throw new AiError(`Invalid request to Anthropic: ${err.message}`)
  if (err instanceof Anthropic.APIConnectionError) throw new AiError('Could not connect to the Anthropic API.')
  if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic API error (${err.status}): ${err.message}`)
  throw err
}

interface MsgLike {
  model: string
  stop_reason: string | null
  stop_details?: { category?: string | null } | null
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
}

const usageOf = (msg: MsgLike): CallUsage => ({
  model: msg.model,
  inputTokens: msg.usage.input_tokens,
  outputTokens: msg.usage.output_tokens,
  cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0
})

function checkStop(msg: MsgLike): void {
  let err: AiError | null = null
  if (msg.stop_reason === 'refusal') {
    err = new AiError(`The model declined the request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`)
  } else if (msg.stop_reason === 'max_tokens') err = new AiError('The response was cut off by the token limit.')
  if (err) {
    err.usage = usageOf(msg) // tokens were still billed
    throw err
  }
}

/** Claude via the Anthropic API (per-token billing with your API key). */
export class ClaudeProvider implements RawChatProvider {
  readonly id = 'claude'
  readonly billing = 'api' as const
  private client: Anthropic

  constructor(
    apiKey: string,
    readonly model: string
  ) {
    this.client = new Anthropic({ apiKey })
  }

  async completeRaw(req: ChatRequest): Promise<Result<string>> {
    try {
      const msg = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }]
      })
      checkStop(msg)
      return { value: msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''), usage: usageOf(msg) }
    } catch (err) {
      if (err instanceof AiError) throw err
      describeError(err)
    }
  }

  async jsonRaw<S extends z.ZodType>(req: JsonRequest<S>): Promise<Result<z.infer<S>>> {
    try {
      const msg = await this.client.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { format: zodOutputFormat(req.schema) }
      })
      checkStop(msg)
      if (msg.parsed_output == null) {
        const e = new AiError("Claude's response could not be parsed as JSON.")
        e.usage = usageOf(msg)
        throw e
      }
      return { value: msg.parsed_output as z.infer<S>, usage: usageOf(msg) }
    } catch (err) {
      if (err instanceof AiError) throw err
      describeError(err)
    }
  }
}
