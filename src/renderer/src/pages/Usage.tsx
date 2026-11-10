import { useEffect, useState } from 'react'
import type { Billing, Budget, ModelPrice, Settings, UsageSummary, UsageTotals } from '@shared/types'
import { api, useAction, useLoad } from '../hooks'

const usd = (v: number | null | undefined) => {
  if (v == null) return '—'
  if (v === 0) return '$0.00'
  if (v < 0.01) return '<$0.01'
  return `$${v.toFixed(2)}`
}
const num = (v: number) => v.toLocaleString('en-US')
const BILLING: Record<Billing, string> = { api: 'API', subscription: 'Subscription', local: 'Local' }
const OPERATION: Record<string, string> = {
  'analyze-job': 'Job analysis',
  resume: 'Resume',
  'cover-letter': 'Cover letter',
  'gap-answer': 'Gap answers',
  'import-resume': 'Resume import',
  'easy-apply': 'Easy Apply',
  embeddings: 'Embeddings',
  test: 'Connection test'
}

export default function UsagePage() {
  const [summary] = useLoad(() => api.usage.summary(), [], ['usage-changed'])
  const [recent] = useLoad(() => api.usage.recent(50), [], ['usage-changed'])
  const [settings, reloadSettings] = useLoad(() => api.settings.get(), [])
  const [, run] = useAction()

  if (!summary || !settings) return null
  const b = summary.budget

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Usage &amp; budget</h1>
        <button
          className="btn-sec ml-auto"
          onClick={() => confirm('Clear the whole usage history? Budgets start counting from zero again.') && run(() => api.usage.clear(), 'Usage history cleared')}
        >
          Clear history
        </button>
      </div>

      {b.blocked && (
        <div role="alert" className="mb-4 flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          <span aria-hidden>⛔</span>
          <span>
            <b>AI calls are blocked.</b> {b.blocked}
            {!b.includeSubscription && ' Calls through your Claude subscription are not affected.'}
          </span>
        </div>
      )}

      {/* KPI row */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="API spend this month" value={usd(summary.month.apiUsd)} note={`${usd(summary.today.apiUsd)} today`} />
        <StatTile
          label="Subscription use this month"
          value={`≈ ${usd(summary.month.subscriptionUsd)}`}
          note="list-price equivalent — not billed"
        />
        <StatTile label="AI calls this month" value={num(summary.month.calls)} note={`${num(summary.today.calls)} today`} />
        <StatTile
          label="Tokens this month"
          value={compact(summary.month.inputTokens + summary.month.outputTokens)}
          note={`${compact(summary.month.inputTokens)} in · ${compact(summary.month.outputTokens)} out`}
        />
      </div>

      <section className="card mb-5">
        <h2 className="h2">Budget</h2>
        <div className="mb-4 flex flex-col gap-4">
          <Meter label="This month" spent={b.monthSpent} limit={b.monthlyUsd} warnPct={b.warnPct} />
          <Meter label="Today" spent={b.todaySpent} limit={b.dailyUsd} warnPct={b.warnPct} />
        </div>
        <BudgetForm settings={settings} onSaved={reloadSettings} />
      </section>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <BreakdownTable title="This month by operation" rows={summary.byOperation.map((r) => ({ ...r, label: OPERATION[r.key] ?? r.key }))} />
        <BreakdownTable
          title="This month by model"
          rows={summary.byModel.map((r) => ({ ...r, label: r.key, sub: BILLING[r.billing] }))}
          unknown={summary.unknownPriceModels}
        />
      </div>

      <section className="card mb-5 overflow-x-auto">
        <h2 className="h2">Recent calls</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">When</th>
              <th className="py-1 pr-3 font-medium">Operation</th>
              <th className="py-1 pr-3 font-medium">Model</th>
              <th className="py-1 pr-3 text-right font-medium">Tokens in / out</th>
              <th className="py-1 pr-3 text-right font-medium">Cost</th>
              <th className="py-1 pr-3 font-medium">Billing</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {(recent ?? []).map((r) => (
              <tr key={r.id} className="align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-500">{new Date(r.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="py-1.5 pr-3">{OPERATION[r.operation] ?? r.operation}</td>
                <td className="py-1.5 pr-3">
                  <code className="text-xs">{r.model}</code>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {num(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)} / {num(r.outputTokens)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.billing === 'subscription' ? `≈ ${usd(r.costUsd)}` : usd(r.costUsd)}</td>
                <td className="py-1.5 pr-3">
                  <span className="badge">{BILLING[r.billing]}</span>
                </td>
                <td className="py-1.5" title={r.error}>
                  {r.ok ? (
                    <span className="text-emerald-700 dark:text-emerald-400">✔ ok</span>
                  ) : (
                    <span className="text-red-700 dark:text-red-400">✖ {r.error.slice(0, 60)}</span>
                  )}
                </td>
              </tr>
            ))}
            {recent?.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-zinc-500">
                  No AI calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <PricesEditor settings={settings} summary={summary} onSaved={reloadSettings} />
    </div>
  )
}

const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v))

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{note}</div>
    </div>
  )
}

/** Budget meter: same-hue track, status color + icon + label once the warning threshold or the limit is reached. */
function Meter({ label, spent, limit, warnPct }: { label: string; spent: number; limit: number | null; warnPct: number }) {
  if (limit == null || limit <= 0) {
    return (
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="font-medium">{label}</span>
          <span className="tabular-nums">{usd(spent)} · no limit</span>
        </div>
      </div>
    )
  }
  const pct = (spent / limit) * 100
  const state = pct >= 100 ? 'over' : pct >= warnPct ? 'warn' : 'ok'
  const fill = state === 'over' ? 'bg-[#d03b3b]' : state === 'warn' ? 'bg-[#fab219]' : 'bg-indigo-600 dark:bg-indigo-400'
  const track = state === 'over' ? 'bg-red-100 dark:bg-red-950' : state === 'warn' ? 'bg-amber-100 dark:bg-amber-950' : 'bg-indigo-100 dark:bg-indigo-950'
  return (
    <div className="text-sm">
      <div className="mb-1 flex flex-wrap justify-between gap-2">
        <span className="font-medium">
          {label}
          {state === 'warn' && <span className="ml-2 text-xs font-normal">⚠ Near limit</span>}
          {state === 'over' && <span className="ml-2 text-xs font-normal">⛔ Limit reached</span>}
        </span>
        <span className="tabular-nums">
          {usd(spent)} of {usd(limit)} <span className="text-zinc-500">({Math.round(pct)}%)</span>
        </span>
      </div>
      <div
        className={`h-2 w-full overflow-hidden rounded ${track}`}
        role="meter"
        aria-label={`${label} budget`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={spent}
      >
        <div className={`h-full rounded ${fill}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

function BudgetForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [b, setB] = useState<Budget>(settings.budget)
  const [busy, run] = useAction()
  useEffect(() => setB(settings.budget), [settings])
  const money = (v: number | null) => (v == null ? '' : String(v))
  const parse = (s: string) => (s.trim() === '' ? null : Math.max(0, Number(s)))

  const save = async () => {
    await run(() => api.settings.update({ budget: b }), 'Budget saved')
    onSaved()
  }

  return (
    <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label>
          <span className="label">Monthly limit (USD, empty = none)</span>
          <input className="input" type="number" min={0} step="0.5" value={money(b.monthlyUsd)} onChange={(e) => setB({ ...b, monthlyUsd: parse(e.target.value) })} />
        </label>
        <label>
          <span className="label">Daily limit (USD, empty = none)</span>
          <input className="input" type="number" min={0} step="0.5" value={money(b.dailyUsd)} onChange={(e) => setB({ ...b, dailyUsd: parse(e.target.value) })} />
        </label>
        <label>
          <span className="label">Warn at (% of a limit)</span>
          <input
            className="input"
            type="number"
            min={1}
            max={100}
            value={b.warnPct}
            onChange={(e) => setB({ ...b, warnPct: Math.min(100, Math.max(1, Number(e.target.value) || 80)) })}
          />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={b.includeSubscription} onChange={(e) => setB({ ...b, includeSubscription: e.target.checked })} />
        <span>
          Also count Claude-subscription usage against these limits (at its list-price equivalent). Useful to keep the app from using up your plan’s
          limits; leave off if you only want to cap real API spend.
        </span>
      </label>
      <p className="mt-2 text-xs text-zinc-500">
        When a limit is reached, new AI calls of the counted kind are refused until the next day/month or until you raise the limit. A call already in
        progress is allowed to finish, so spend can go slightly past a limit.
      </p>
      <div className="mt-3 flex justify-end">
        <button className="btn" disabled={busy} onClick={save}>
          Save budget
        </button>
      </div>
    </div>
  )
}

function BreakdownTable({ title, rows, unknown = [] }: { title: string; rows: (UsageTotals & { label: string; sub?: string })[]; unknown?: string[] }) {
  return (
    <section className="card overflow-x-auto">
      <h2 className="h2">{title}</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Name</th>
            <th className="py-1 pr-3 text-right font-medium">Calls</th>
            <th className="py-1 pr-3 text-right font-medium">API</th>
            <th className="py-1 text-right font-medium">Subscription ≈</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-1.5 pr-3">
                {r.label} {r.sub && <span className="badge ml-1">{r.sub}</span>}
                {unknown.includes(r.label) && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">⚠ unknown price</span>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{num(r.calls)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{usd(r.apiUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(r.subscriptionUsd)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-zinc-500">
                Nothing this month.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function PricesEditor({ settings, summary, onSaved }: { settings: Settings; summary: UsageSummary; onSaved: () => void }) {
  const [overrides, setOverrides] = useState<Record<string, ModelPrice>>(settings.prices)
  const [newModel, setNewModel] = useState('')
  const [busy, run] = useAction()
  useEffect(() => setOverrides(settings.prices), [settings])
  const all = { ...summary.prices, ...overrides }
  const models = [...new Set([...Object.keys(all), ...summary.unknownPriceModels])].sort()

  const setField = (model: string, field: keyof ModelPrice, v: string) => {
    const cur = all[model] ?? { input: 0, output: 0 }
    setOverrides({ ...overrides, [model]: { ...cur, [field]: Math.max(0, Number(v) || 0) } })
  }
  const save = async () => {
    await run(() => api.settings.update({ prices: overrides }), 'Prices saved (applies to new calls)')
    onSaved()
  }

  return (
    <section className="card overflow-x-auto">
      <h2 className="h2">Prices (USD per 1M tokens)</h2>
      <p className="mb-3 text-sm text-zinc-500">
        Used to compute API cost and the subscription equivalent when a provider does not report a cost itself (<code>claude -p</code> does). Built-in
        values are list prices; OpenAI values are estimates — check your provider and adjust. Changes apply to new calls only.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Model</th>
            <th className="py-1 pr-3 font-medium">Input</th>
            <th className="py-1 pr-3 font-medium">Output</th>
            <th className="py-1 pr-3 font-medium">Cache read</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const p = all[m]
            return (
              <tr key={m}>
                <td className="py-1 pr-3">
                  <code className="text-xs">{m}</code>
                  {!p && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">⚠ no price</span>}
                </td>
                {(['input', 'output', 'cacheRead'] as const).map((f) => (
                  <td key={f} className="py-1 pr-3">
                    <input className="input w-24 py-1" type="number" min={0} step="0.01" value={p?.[f] ?? ''} onChange={(e) => setField(m, f, e.target.value)} />
                  </td>
                ))}
                <td className="py-1 text-xs text-zinc-500">{overrides[m] ? 'custom' : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="input w-64" placeholder="Add a model id…" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
        <button
          className="btn-sec"
          disabled={!newModel.trim() || !!all[newModel.trim()]}
          onClick={() => {
            setOverrides({ ...overrides, [newModel.trim()]: { input: 0, output: 0 } })
            setNewModel('')
          }}
        >
          Add
        </button>
        <button className="btn ml-auto" disabled={busy} onClick={save}>
          Save prices
        </button>
      </div>
    </section>
  )
}
