import { join } from 'node:path'
import { app } from 'electron'
import type * as z from 'zod/v4'
import type { AiOperation } from '@shared/types'
import { getKey, getSettings } from '../settings'
import { budgetBlock, recordUsage, warnIfNearLimit } from '../usage'
import { ClaudeProvider } from './claude'
import { ClaudeCliProvider, resolveCliPath } from './claudeCli'
import { LocalEmbedder } from './localEmbed'
import { OpenAICompatEmbedder, OpenAICompatProvider } from './openai'
import { effectivePrices } from './pricing'
import { AiError, type CallUsage, type ChatProvider, type ChatRequest, type EmbedProvider, type JsonRequest, type RawChatProvider } from './provider'

export const cliOptions = () => ({
  cliPath: resolveCliPath(getSettings().claudeCliPath),
  // Empty working dir so the CLI picks up no CLAUDE.md or project settings
  cwd: join(app.getPath('userData'), 'claude-cli-sandbox'),
  timeoutMs: 10 * 60_000
})

function rawChat(): RawChatProvider {
  const s = getSettings()
  const model = s.chatModel[s.chatProvider]
  switch (s.chatProvider) {
    case 'claude': {
      const key = getKey('claude')
      if (!key)
        throw new AiError(
          'Text generation is set to “Claude API (API key)”, but no Anthropic API key is saved. In Settings, switch the provider to “Claude subscription (claude -p)” or add an API key.'
        )
      return new ClaudeProvider(key, model)
    }
    case 'claude-cli':
      return new ClaudeCliProvider(model, cliOptions())
    case 'openai': {
      const key = getKey('openai')
      if (!key) throw new AiError('Text generation is set to “OpenAI”, but no OpenAI API key is saved. Add one in Settings or switch provider.')
      return new OpenAICompatProvider('openai', model, { apiKey: key })
    }
    case 'ollama':
      return new OpenAICompatProvider('ollama', model, { apiKey: 'ollama', baseURL: `${s.ollamaUrl.replace(/\/$/, '')}/v1` })
  }
}

/**
 * Wraps a provider so that every call is
 * 1) checked against the budget before it runs (blocked calls never reach the provider), and
 * 2) recorded in the usage log afterwards — including failed calls that still consumed tokens.
 */
export class MeteredChat implements ChatProvider {
  readonly id: string

  constructor(
    private inner: RawChatProvider,
    private operation: AiOperation
  ) {
    this.id = inner.id
  }

  private async metered<T>(call: () => Promise<{ value: T; usage: CallUsage }>): Promise<T> {
    const s = getSettings()
    const blocked = budgetBlock(s.budget, this.inner.billing)
    if (blocked) throw new AiError(blocked)
    const prices = effectivePrices(s.prices)
    const base = { provider: this.inner.id, operation: this.operation, billing: this.inner.billing }
    try {
      const { value, usage } = await call()
      recordUsage({ ...base, ...usage, model: usage.model ?? this.inner.model }, prices)
      warnIfNearLimit(s.budget)
      return value
    } catch (err) {
      const usage = err instanceof AiError ? err.usage : undefined
      recordUsage(
        {
          ...base,
          model: usage?.model ?? this.inner.model,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cacheReadTokens: usage?.cacheReadTokens,
          cacheWriteTokens: usage?.cacheWriteTokens,
          reportedCostUsd: usage?.reportedCostUsd,
          ok: false,
          error: (err as Error).message
        },
        prices
      )
      throw err
    }
  }

  complete(req: ChatRequest): Promise<string> {
    return this.metered(() => this.inner.completeRaw(req))
  }

  json<S extends z.ZodType>(req: JsonRequest<S>): Promise<z.infer<S>> {
    return this.metered(() => this.inner.jsonRaw(req))
  }
}

/** The chat provider configured in Settings, metered and budget-checked under the given operation name. */
export function getChat(operation: AiOperation): ChatProvider {
  return new MeteredChat(rawChat(), operation)
}

export function getEmbedder(): EmbedProvider {
  const s = getSettings()
  const model = s.embedModel[s.embedProvider]
  switch (s.embedProvider) {
    case 'local':
      return new LocalEmbedder(model, join(app.getPath('userData'), 'models'))
    case 'openai': {
      const key = getKey('openai')
      if (!key) throw new AiError('OpenAI embeddings require an OpenAI API key.')
      const blocked = budgetBlock(s.budget, 'api')
      if (blocked) throw new AiError(blocked)
      return new OpenAICompatEmbedder('openai', model, { apiKey: key }, (tokens) =>
        recordUsage({ provider: 'openai', model, operation: 'embeddings', billing: 'api', inputTokens: tokens, outputTokens: 0 }, effectivePrices(s.prices))
      )
    }
    case 'ollama':
      return new OpenAICompatEmbedder('ollama', model, { apiKey: 'ollama', baseURL: `${s.ollamaUrl.replace(/\/$/, '')}/v1` })
  }
}

export { AiError }
