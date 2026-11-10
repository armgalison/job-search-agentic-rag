import { getDb } from './db/client'
import { costOf, effectivePrices, priceFor, type TokenCounts } from './ai/pricing'
import { emit } from './events'
import type { AiOperation, Billing, Budget, ModelPrice, UsageRecord, UsageSummary, UsageTotals } from '@shared/types'

type Row = {
  id: number
  created_at: string
  provider: string
  model: string
  operation: AiOperation
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number | null
  billing: Billing
  ok: number
  error: string
}

const toRecord = (r: Row): UsageRecord => ({
  id: r.id,
  createdAt: r.created_at,
  provider: r.provider,
  model: r.model,
  operation: r.operation,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  cacheReadTokens: r.cache_read_tokens,
  cacheWriteTokens: r.cache_write_tokens,
  costUsd: r.cost_usd,
  billing: r.billing,
  ok: !!r.ok,
  error: r.error
})

export interface UsageInput extends TokenCounts {
  provider: string
  model: string
  operation: AiOperation
  billing: Billing
  /** Cost reported by the provider itself (claude -p reports one); otherwise computed from the price table */
  reportedCostUsd?: number | null
  ok?: boolean
  error?: string
}

// Local time boundaries, expressed in the UTC format SQLite stores ("YYYY-MM-DD HH:MM:SS")
const sqlUtc = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19)
export function periodStarts(now = new Date()): { today: string; month: string } {
  return {
    today: sqlUtc(new Date(now.getFullYear(), now.getMonth(), now.getDate())),
    month: sqlUtc(new Date(now.getFullYear(), now.getMonth(), 1))
  }
}

export function recordUsage(u: UsageInput, prices: Record<string, ModelPrice>): UsageRecord {
  const cost =
    u.billing === 'local'
      ? 0
      : (u.reportedCostUsd ?? costOf(u.model, u, prices))
  const info = getDb()
    .prepare(
      `INSERT INTO ai_usage(provider, model, operation, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billing, ok, error)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      u.provider,
      u.model,
      u.operation,
      Math.round(u.inputTokens),
      Math.round(u.outputTokens),
      Math.round(u.cacheReadTokens ?? 0),
      Math.round(u.cacheWriteTokens ?? 0),
      cost,
      u.billing,
      u.ok === false ? 0 : 1,
      (u.error ?? '').slice(0, 500)
    )
  emit({ type: 'usage-changed' })
  return toRecord(getDb().prepare('SELECT * FROM ai_usage WHERE id = ?').get(info.lastInsertRowid) as Row)
}

function totals(since: string): UsageTotals {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN billing = 'api' THEN cost_usd END), 0) AS api,
        COALESCE(SUM(CASE WHEN billing = 'subscription' THEN cost_usd END), 0) AS sub,
        COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens), 0) AS inp,
        COALESCE(SUM(output_tokens), 0) AS outp
       FROM ai_usage WHERE created_at >= ?`
    )
    .get(since) as { calls: number; api: number; sub: number; inp: number; outp: number }
  return { calls: r.calls, apiUsd: r.api, subscriptionUsd: r.sub, inputTokens: r.inp, outputTokens: r.outp }
}

/** Spend counted against the budget: API spend, plus the subscription equivalent if the user opted in. */
export function countedSpend(t: UsageTotals, budget: Budget): number {
  return t.apiUsd + (budget.includeSubscription ? t.subscriptionUsd : 0)
}

/** Returns a human-readable reason if a call with this billing would exceed the budget, else null. */
export function budgetBlock(budget: Budget, billing: Billing, now = new Date()): string | null {
  if (billing === 'local') return null
  if (billing === 'subscription' && !budget.includeSubscription) return null
  const { today, month } = periodStarts(now)
  const m = countedSpend(totals(month), budget)
  const d = countedSpend(totals(today), budget)
  if (budget.monthlyUsd != null && m >= budget.monthlyUsd)
    return `Monthly AI budget reached ($${m.toFixed(2)} of $${budget.monthlyUsd.toFixed(2)}). Raise or remove the limit in Usage.`
  if (budget.dailyUsd != null && d >= budget.dailyUsd)
    return `Daily AI budget reached ($${d.toFixed(2)} of $${budget.dailyUsd.toFixed(2)}). Raise or remove the limit in Usage.`
  return null
}

/** Emits a warning toast the first time spend crosses the warning threshold of a limit in a period. */
const warned = new Set<string>()
export function warnIfNearLimit(budget: Budget, now = new Date()): void {
  const { today, month } = periodStarts(now)
  const checks: [string, number | null, number][] = [
    [`m:${month}`, budget.monthlyUsd, countedSpend(totals(month), budget)],
    [`d:${today}`, budget.dailyUsd, countedSpend(totals(today), budget)]
  ]
  for (const [key, limit, spent] of checks) {
    if (limit == null || limit <= 0 || warned.has(key)) continue
    if ((spent / limit) * 100 >= budget.warnPct) {
      warned.add(key)
      const which = key.startsWith('m') ? 'monthly' : 'daily'
      emit({ type: 'toast', level: 'info', message: `Heads up: AI spend is at ${Math.round((spent / limit) * 100)}% of your ${which} budget ($${spent.toFixed(2)} of $${limit.toFixed(2)}).` })
    }
  }
}

function groupBy(col: 'operation' | 'model', since: string) {
  const rows = getDb()
    .prepare(
      `SELECT ${col} AS key, MAX(billing) AS billing, COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN billing = 'api' THEN cost_usd END), 0) AS api,
        COALESCE(SUM(CASE WHEN billing = 'subscription' THEN cost_usd END), 0) AS sub,
        COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens), 0) AS inp,
        COALESCE(SUM(output_tokens), 0) AS outp
       FROM ai_usage WHERE created_at >= ? GROUP BY ${col} ORDER BY (api + sub) DESC, calls DESC`
    )
    .all(since) as { key: string; billing: Billing; calls: number; api: number; sub: number; inp: number; outp: number }[]
  return rows.map((r) => ({
    key: r.key,
    billing: r.billing,
    calls: r.calls,
    apiUsd: r.api,
    subscriptionUsd: r.sub,
    inputTokens: r.inp,
    outputTokens: r.outp
  }))
}

export function usageSummary(budget: Budget, overrides: Record<string, ModelPrice>, now = new Date()): UsageSummary {
  const { today, month } = periodStarts(now)
  const t = totals(today)
  const m = totals(month)
  const prices = effectivePrices(overrides)
  const unknown = getDb()
    .prepare("SELECT DISTINCT model FROM ai_usage WHERE cost_usd IS NULL AND billing != 'local'")
    .all() as { model: string }[]
  return {
    today: t,
    month: m,
    byOperation: groupBy('operation', month),
    byModel: groupBy('model', month),
    budget: {
      ...budget,
      monthSpent: countedSpend(m, budget),
      todaySpent: countedSpend(t, budget),
      // API-billed calls are always subject to the budget, so this is what "blocked" means
      blocked: budgetBlock(budget, 'api', now)
    },
    unknownPriceModels: unknown.map((u) => u.model).filter((x) => !priceFor(x, prices)),
    prices
  }
}

export function recentUsage(limit = 50): UsageRecord[] {
  return (getDb().prepare('SELECT * FROM ai_usage ORDER BY id DESC LIMIT ?').all(Math.min(limit, 500)) as Row[]).map(toRecord)
}

export function clearUsage(): void {
  getDb().prepare('DELETE FROM ai_usage').run()
  warned.clear()
  emit({ type: 'usage-changed' })
}
