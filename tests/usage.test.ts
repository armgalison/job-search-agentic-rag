import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/jsr-test' }, safeStorage: { isEncryptionAvailable: () => false } }))

import { openDb } from '../src/main/db/client'
import { kv } from '../src/main/db/repos'
import { costOf, effectivePrices, priceFor } from '../src/main/ai/pricing'
import { parseCliOutput } from '../src/main/ai/claudeCli'
import { AiError, type RawChatProvider } from '../src/main/ai/provider'
import { MeteredChat } from '../src/main/ai'
import { budgetBlock, recentUsage, recordUsage, usageSummary } from '../src/main/usage'
import { defaultSettings, type Budget } from '../src/shared/types'

const prices = effectivePrices({})
const budget = (b: Partial<Budget> = {}): Budget => ({ ...defaultSettings.budget, ...b })

beforeEach(() => openDb(':memory:'))

describe('pricing', () => {
  it('computes cost per million tokens, including cache tokens', () => {
    // opus-5-5: $4 in, $20 out, $0.20 cache read
    expect(costOf('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000 }, prices)).toBeCloseTo(4 + 2 + 0.2)
  })
  it('matches dated/prefixed model ids and returns null for unknown models', () => {
    expect(priceFor('claude-sonnet-5-5-20260101', prices)?.input).toBe(2)
    expect(costOf('mystery-model', { inputTokens: 10, outputTokens: 10 }, prices)).toBeNull()
  })
  it('user overrides win over built-in prices', () => {
    expect(priceFor('gpt-4.1', effectivePrices({ 'gpt-4.1': { input: 9, output: 9 } }))?.input).toBe(9)
  })
})

describe('usage log and budget', () => {
  it('records API cost from the price table, and trusts a provider-reported cost', () => {
    const a = recordUsage({ provider: 'claude', model: 'claude-sonnet-5-5', operation: 'resume', billing: 'api', inputTokens: 500_000, outputTokens: 100_000 }, prices)
    expect(a.costUsd).toBeCloseTo(1 + 1)
    const b = recordUsage({ provider: 'claude-cli', model: 'claude-haiku-5-5', operation: 'test', billing: 'subscription', inputTokens: 2, outputTokens: 74, reportedCostUsd: 0.000264 }, prices)
    expect(b.costUsd).toBe(0.000264)
    const c = recordUsage({ provider: 'ollama', model: 'llama3.1', operation: 'resume', billing: 'local', inputTokens: 999, outputTokens: 999 }, prices)
    expect(c.costUsd).toBe(0)
    expect(recentUsage().map((r) => r.id)).toEqual([c.id, b.id, a.id])
  })

  it('blocks API calls at the monthly limit, and subscription calls only when opted in', () => {
    recordUsage({ provider: 'claude', model: 'claude-opus-5-5', operation: 'resume', billing: 'api', inputTokens: 0, outputTokens: 500_000 }, prices) // $10
    recordUsage({ provider: 'claude-cli', model: 'claude-opus-5-5', operation: 'resume', billing: 'subscription', inputTokens: 0, outputTokens: 0, reportedCostUsd: 15 }, prices)
    expect(budgetBlock(budget({ monthlyUsd: 20 }), 'api')).toBeNull() // only $10 counted
    expect(budgetBlock(budget({ monthlyUsd: 10 }), 'api')).toMatch(/Monthly AI budget reached \(\$10\.00 of \$10\.00\)/)
    expect(budgetBlock(budget({ monthlyUsd: 10 }), 'subscription')).toBeNull() // subscription not counted by default
    expect(budgetBlock(budget({ monthlyUsd: 20, includeSubscription: true }), 'subscription')).toMatch(/\$25\.00 of \$20\.00/)
    expect(budgetBlock(budget({ monthlyUsd: 1 }), 'local')).toBeNull()
    expect(budgetBlock(budget({ monthlyUsd: null, dailyUsd: 5 }), 'api')).toMatch(/Daily AI budget/)
  })

  it('summarizes the month by operation and model', () => {
    recordUsage({ provider: 'claude', model: 'claude-sonnet-5-5', operation: 'resume', billing: 'api', inputTokens: 1_000_000, outputTokens: 0 }, prices)
    recordUsage({ provider: 'claude', model: 'claude-sonnet-5-5', operation: 'analyze-job', billing: 'api', inputTokens: 500_000, outputTokens: 0 }, prices)
    recordUsage({ provider: 'x', model: 'mystery', operation: 'resume', billing: 'api', inputTokens: 5, outputTokens: 5 }, prices)
    const s = usageSummary(budget({ monthlyUsd: 2 }), {})
    expect(s.month.calls).toBe(3)
    expect(s.month.apiUsd).toBeCloseTo(3)
    expect(s.byOperation[0]).toMatchObject({ key: 'resume', calls: 2 })
    expect(s.budget.blocked).toMatch(/Monthly/)
    expect(s.unknownPriceModels).toEqual(['mystery'])
  })
})

describe('claude -p output', () => {
  const fixture = readFileSync('tests/fixtures/claude-p-success.json', 'utf8')

  it('parses structured output, tokens, served model and reported cost', () => {
    const { result, usage } = parseCliOutput(fixture, '', 0, 'haiku')
    expect(result.structured_output).toEqual({ name: 'Ana', years: 6 })
    expect(usage).toMatchObject({ model: 'claude-haiku-5-5', inputTokens: 2, outputTokens: 74, cacheWriteTokens: 1134, reportedCostUsd: 0.000264 })
  })

  it('turns CLI errors into readable messages that keep the usage', () => {
    const err = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm', total_cost_usd: 0, usage: {} })
    try {
      parseCliOutput(err, '', 1, 'opus')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AiError)
      expect((e as Error).message).toMatch(/^Claude subscription limit: Claude usage limit reached/)
      expect((e as AiError).usage?.reportedCostUsd).toBe(0)
    }
    expect(() => parseCliOutput('not json', 'Error: something broke', 2, 'opus')).toThrow(/claude -p failed \(exit 2\): Error: something broke/)
  })
})

describe('MeteredChat', () => {
  const fake = (billing: 'api' | 'subscription', fail = false): RawChatProvider => ({
    id: 'fake',
    model: 'claude-sonnet-5-5',
    billing,
    async completeRaw() {
      if (fail) {
        const e = new AiError('The response was cut off by the token limit.')
        e.usage = { inputTokens: 100_000, outputTokens: 0 }
        throw e
      }
      return { value: 'hi', usage: { inputTokens: 1_000_000, outputTokens: 0 } }
    },
    async jsonRaw<S extends z.ZodType>() {
      return { value: { ok: true } as z.infer<S>, usage: { inputTokens: 0, outputTokens: 0 } }
    }
  })

  it('records successful and failed calls', async () => {
    expect(await new MeteredChat(fake('api'), 'resume').complete({ system: '', prompt: '' })).toBe('hi')
    await expect(new MeteredChat(fake('api', true), 'resume').complete({ system: '', prompt: '' })).rejects.toThrow(/token limit/)
    const [failed, ok] = recentUsage()
    expect(ok).toMatchObject({ ok: true, operation: 'resume', billing: 'api' })
    expect(ok.costUsd).toBeCloseTo(2) // 1M input on sonnet-5-5
    expect(failed).toMatchObject({ ok: false, inputTokens: 100_000 })
    expect(failed.costUsd).toBeCloseTo(0.2)
  })

  it('refuses calls once the budget is reached, without calling the provider', async () => {
    kv.set('settings', { ...defaultSettings, budget: budget({ monthlyUsd: 1 }) })
    const inner = fake('api')
    const spy = vi.spyOn(inner, 'completeRaw')
    await new MeteredChat(inner, 'resume').complete({ system: '', prompt: '' }) // $2 — allowed (it starts under the limit)
    await expect(new MeteredChat(inner, 'resume').complete({ system: '', prompt: '' })).rejects.toThrow(/Monthly AI budget reached/)
    expect(spy).toHaveBeenCalledTimes(1)
    // Subscription calls are not blocked by default
    expect(await new MeteredChat(fake('subscription'), 'resume').complete({ system: '', prompt: '' })).toBe('hi')
  })
})
