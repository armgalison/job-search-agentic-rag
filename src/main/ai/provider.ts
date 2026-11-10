import { toJSONSchema, type z } from 'zod/v4'
import type { Billing } from '@shared/types'
import type { TokenCounts } from './pricing'

export interface ChatRequest {
  system: string
  prompt: string
  maxTokens?: number
}

export interface JsonRequest<S extends z.ZodType> extends ChatRequest {
  schema: S
  /** Short schema name (required by some providers) */
  name: string
}

/** Token usage of one call, as reported by the provider. */
export interface CallUsage extends TokenCounts {
  /** Model that actually served the call (may differ from the requested alias) */
  model?: string
  /** Cost reported by the provider itself, if any (claude -p reports one) */
  reportedCostUsd?: number | null
}

export interface Result<T> {
  value: T
  usage: CallUsage
}

/** What each provider implements: one call in, the value plus its token usage out. */
export interface RawChatProvider {
  readonly id: string
  readonly model: string
  readonly billing: Billing
  completeRaw(req: ChatRequest): Promise<Result<string>>
  jsonRaw<S extends z.ZodType>(req: JsonRequest<S>): Promise<Result<z.infer<S>>>
}

/** What the rest of the app uses (metered and budget-checked — see ai/index.ts). */
export interface ChatProvider {
  readonly id: string
  complete(req: ChatRequest): Promise<string>
  json<S extends z.ZodType>(req: JsonRequest<S>): Promise<z.infer<S>>
}

/** Common interface for embedding providers. */
export interface EmbedProvider {
  /** Stable model identifier (stored alongside each vector) */
  readonly modelId: string
  embedDocuments(texts: string[]): Promise<Float32Array[]>
  embedQuery(text: string): Promise<Float32Array>
}

/** Errors whose message is safe and useful to show to the user. */
export class AiError extends Error {
  /** Usage consumed before the failure (e.g. a truncated response), so it can still be recorded */
  usage?: CallUsage
}

/**
 * JSON Schema for a Zod schema, without the "$schema" meta key: the Claude CLI's validator rejects
 * the draft 2020-12 meta-schema URL that Zod adds, and other providers do not need it.
 */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _meta, ...rest } = toJSONSchema(schema) as Record<string, unknown>
  void _meta
  return rest
}

/** Extracts and validates JSON from a text response (for providers without guaranteed structured output). */
export function parseJsonText<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AiError('The AI response contains no JSON.')
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new AiError('The AI response contains invalid JSON.')
  }
  const res = schema.safeParse(raw)
  if (!res.success) throw new AiError(`AI JSON does not match the expected shape: ${res.error.message}`)
  return res.data
}
