import type { ModelPrice } from '@shared/types'

/**
 * Built-in price table, USD per 1M tokens. Claude prices are Anthropic first-party list prices;
 * the OpenAI entries are estimates — check your provider's pricing page and override them in Usage.
 * Prices can be overridden (or added for other models) under Usage → Prices.
 */
export const BUILTIN_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 }
}

export function effectivePrices(overrides: Record<string, ModelPrice>): Record<string, ModelPrice> {
  return { ...BUILTIN_PRICES, ...overrides }
}

/** Finds the price for a model id, tolerating dated or prefixed variants (e.g. "claude-opus-5-5-20260101"). */
export function priceFor(model: string, prices: Record<string, ModelPrice>): ModelPrice | null {
  if (prices[model]) return prices[model]
  const candidates = Object.keys(prices)
    .filter((k) => model.startsWith(k) || model.endsWith(k))
    .sort((a, b) => b.length - a.length)
  return candidates.length ? prices[candidates[0]] : null
}

export interface TokenCounts {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Cost in USD from token counts, or null when the model has no known price. */
export function costOf(model: string, t: TokenCounts, prices: Record<string, ModelPrice>): number | null {
  const p = priceFor(model, prices)
  if (!p) return null
  const cr = p.cacheRead ?? p.input
  const cw = p.cacheWrite ?? p.input
  return (t.inputTokens * p.input + t.outputTokens * p.output + (t.cacheReadTokens ?? 0) * cr + (t.cacheWriteTokens ?? 0) * cw) / 1_000_000
}
