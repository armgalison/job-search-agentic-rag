import { useMemo, useState, type ReactNode } from 'react'
import { countAxis, dashboardStats } from '@shared/dashboard'
import { api, useLoad } from '../hooks'

/**
 * Where the search stands today: headline numbers, then charts built from the jobs, applications and messages
 * the app stores. Charts are plain HTML (no chart library): thin bars, hairline grid, a hover tooltip on every
 * bar, a legend when there are two series, and a table view for each.
 */

type Series = { key: string; label: string; color: string }
const S1 = 'var(--series-1)'
const S2 = 'var(--series-2)'

const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export default function Dashboard({ onApplications, onJobs }: { onApplications: () => void; onJobs: () => void }) {
  const [jobs] = useLoad(() => api.jobs.list(), [], ['jobs-changed'])
  const [apps] = useLoad(() => api.applications.list(), [], ['applications-changed'])
  const [outreach] = useLoad(() => api.outreach.list(), [], ['applications-changed'])
  const [usage] = useLoad(() => api.usage.summary(), [], ['usage-changed'])
  const [settings] = useLoad(() => api.settings.get(), [])
  const stats = useMemo(() => (jobs && apps ? dashboardStats(jobs, apps, outreach ?? []) : null), [jobs, apps, outreach])

  if (!stats) return <div className="text-sm text-zinc-500">Loading…</div>
  const minScore = settings?.agent.minScore ?? null
  const spend = usage ? usage.month.apiUsd + usage.month.subscriptionUsd : null

  return (
    <div className="viz-root">
      <h1 className="mb-1 text-2xl font-semibold">Dashboard</h1>
      <p className="mb-5 text-sm text-zinc-500">Where your job search stands today.</p>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Jobs saved" value={stats.jobs} sub={`${stats.analyzed} analyzed`} onClick={onJobs} />
        <Tile label="Applications sent" value={stats.sent} sub={stats.drafts ? `${stats.drafts} draft(s) not sent` : 'no drafts waiting'} onClick={onApplications} />
        <Tile label="Response rate" value={stats.responseRate == null ? '—' : `${stats.responseRate}%`} sub={`${stats.replied} of ${stats.sent} replied`} />
        <Tile
          label="Awaiting scheduling"
          value={stats.awaitingScheduling}
          sub={stats.awaitingScheduling ? 'open the board to reply' : 'nothing to schedule'}
          attention={stats.awaitingScheduling > 0}
          onClick={onApplications}
        />
        <Tile label="Interviews · offers" value={`${stats.interviewing} · ${stats.offers}`} sub={`${stats.rejected} rejected`} />
        <Tile label="Spend this month" value={spend == null ? '—' : `$${spend.toFixed(2)}`} sub={`${stats.messages} message(s) sent`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Activity per week"
          subtitle="Jobs saved and applications sent, last 12 weeks"
          legend={[
            { key: 'jobs', label: 'Jobs saved', color: S1 },
            { key: 'applications', label: 'Applications sent', color: S2 }
          ]}
          table={{
            head: ['Week of', 'Jobs saved', 'Applications sent'],
            rows: stats.weekly.map((w) => [fmtWeek(w.week), w.jobs, w.applications])
          }}
        >
          <GroupedColumns
            groups={stats.weekly.map((w) => ({ label: fmtWeek(w.week), values: { jobs: w.jobs, applications: w.applications } }))}
            series={[
              { key: 'jobs', label: 'Jobs saved', color: S1 },
              { key: 'applications', label: 'Applications sent', color: S2 }
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Applications by status"
          subtitle="Every card on the board, archived included"
          table={{ head: ['Status', 'Applications'], rows: stats.byStatus.map((b) => [b.label, b.count]) }}
        >
          <HBars rows={stats.byStatus.map((b) => ({ label: b.label, value: b.count }))} unit="application" />
        </ChartCard>

        <ChartCard
          title="Fit score of analyzed jobs"
          subtitle={`How well the jobs match your profile, and which ones you applied to${stats.avgScoreSent != null ? ` (average applied: ${stats.avgScoreSent}%)` : ''}`}
          legend={[
            { key: 'applied', label: 'Applied', color: S2 },
            { key: 'notApplied', label: 'Not applied', color: S1 }
          ]}
          table={{ head: ['Fit score', 'Applied', 'Not applied'], rows: stats.scores.map((b) => [`${b.from}–${b.to}%`, b.applied, b.notApplied]) }}
        >
          <StackedColumns
            groups={stats.scores.map((b) => ({ label: `${b.from}`, title: `${b.from}–${b.to}%`, values: { applied: b.applied, notApplied: b.notApplied } }))}
            series={[
              { key: 'applied', label: 'Applied', color: S2 },
              { key: 'notApplied', label: 'Not applied', color: S1 }
            ]}
            marker={minScore != null ? { at: Math.min(9, Math.floor(minScore / 10)), label: `min ${minScore}%` } : undefined}
          />
        </ChartCard>

        <ChartCard
          title="Top companies"
          subtitle="Where you sent the most applications"
          table={{ head: ['Company', 'Applications'], rows: stats.topCompanies.map((c) => [c.company, c.count]) }}
        >
          {stats.topCompanies.length ? (
            <HBars rows={stats.topCompanies.map((c) => ({ label: c.company, value: c.count }))} unit="application" />
          ) : (
            <Empty>No applications sent yet.</Empty>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, onClick, attention }: { label: string; value: ReactNode; sub: string; onClick?: () => void; attention?: boolean }) {
  const body = (
    <>
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {attention && <span aria-hidden>⏳ </span>}
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 truncate text-xs text-zinc-500" title={sub}>
        {sub}
      </div>
    </>
  )
  const cls = `card p-3 text-left ${attention ? 'border-amber-400 dark:border-amber-600' : ''}`
  return onClick ? (
    <button className={`${cls} transition-colors hover:border-indigo-400`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children
}: {
  title: string
  subtitle: string
  legend?: Series[]
  table: { head: string[]; rows: (string | number)[][] }
  children: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className="card">
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        <button className="btn-sec shrink-0 px-2 py-0.5 text-xs" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {legend && !asTable && (
        <div className="mb-2 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-300">
          {legend.map((l) => (
            <span key={l.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} className={`border-b border-zinc-200 py-1 font-medium dark:border-zinc-800 ${i ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={`border-b border-zinc-100 py-1 dark:border-zinc-800/60 ${j ? 'text-right tabular-nums' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <div className="flex h-40 items-center justify-center text-sm text-zinc-500">{children}</div>

/** Hover tooltip positioned inside the chart box */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; lines: ReactNode } | null>(null)
  const bind = (lines: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent<HTMLElement>) => {
      const box = (e.currentTarget.closest('[data-chart]') as HTMLElement).getBoundingClientRect()
      setTip({ x: e.clientX - box.left, y: e.clientY - box.top, lines })
    },
    onMouseLeave: () => setTip(null)
  })
  const el = tip && (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow-md dark:border-zinc-700 dark:bg-zinc-800"
      style={{ left: tip.x, top: tip.y, transform: `translate(${tip.x > 200 ? 'calc(-100% - 10px)' : '10px'}, -110%)` }}
    >
      {tip.lines}
    </div>
  )
  return { bind, el }
}

const TipRow = ({ color, label, value }: { color: string; label: string; value: number }) => (
  <div className="flex items-center gap-1.5">
    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
    <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
    <span className="ml-auto pl-3 font-medium tabular-nums">{value}</span>
  </div>
)

const PLOT_H = 160

/** Y axis gridlines + labels behind a column plot */
function Grid({ ticks, max }: { ticks: number[]; max: number }) {
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="absolute right-0 left-7 border-t border-[var(--grid)]" style={{ bottom: (t / max) * PLOT_H }}>
          <span className="absolute -top-2 -left-7 w-6 text-right text-[10px] text-zinc-500 tabular-nums">{t}</span>
        </div>
      ))}
    </>
  )
}

interface Group {
  label: string
  title?: string
  values: Record<string, number>
}

function GroupedColumns({ groups, series }: { groups: Group[]; series: Series[] }) {
  const { bind, el } = useTip()
  const { max, ticks } = countAxis(Math.max(0, ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0))))
  return (
    <div data-chart className="relative">
      <div className="relative" style={{ height: PLOT_H }}>
        <Grid ticks={ticks} max={max} />
        <div className="absolute inset-0 left-7 flex items-end">
          {groups.map((g) => (
            <div
              key={g.label}
              className="flex h-full flex-1 items-end justify-center gap-0.5 rounded-sm hover:bg-zinc-500/5"
              {...bind(
                <>
                  <div className="mb-0.5 font-medium">Week of {g.title ?? g.label}</div>
                  {series.map((s) => (
                    <TipRow key={s.key} color={s.color} label={s.label} value={g.values[s.key] ?? 0} />
                  ))}
                </>
              )}
            >
              {series.map((s) => (
                <div key={s.key} className="w-full max-w-3 rounded-t" style={{ height: ((g.values[s.key] ?? 0) / max) * PLOT_H, background: s.color }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <XLabels labels={groups.map((g) => g.label)} every={2} />
      {el}
    </div>
  )
}

function StackedColumns({ groups, series, marker }: { groups: Group[]; series: Series[]; marker?: { at: number; label: string } }) {
  const { bind, el } = useTip()
  const totals = groups.map((g) => series.reduce((n, s) => n + (g.values[s.key] ?? 0), 0))
  const { max, ticks } = countAxis(Math.max(0, ...totals))
  if (!totals.some(Boolean)) return <Empty>No analyzed jobs yet.</Empty>
  return (
    <div data-chart className="relative">
      <div className="relative" style={{ height: PLOT_H }}>
        <Grid ticks={ticks} max={max} />
        <div className="absolute inset-0 left-7 flex items-end">
          {groups.map((g, i) => (
            <div
              key={g.label}
              className={`relative flex h-full flex-1 flex-col-reverse items-center rounded-sm hover:bg-zinc-500/5 ${marker && i === marker.at ? 'border-l border-dashed border-zinc-400' : ''}`}
              {...bind(
                <>
                  <div className="mb-0.5 font-medium">Fit {g.title}</div>
                  {series.map((s) => (
                    <TipRow key={s.key} color={s.color} label={s.label} value={g.values[s.key] ?? 0} />
                  ))}
                </>
              )}
            >
              {marker && i === marker.at && <span className="absolute -top-0.5 left-1 text-[10px] whitespace-nowrap text-zinc-500">{marker.label}</span>}
              {series.map((s, k) => {
                const v = g.values[s.key] ?? 0
                if (!v) return null
                const top = series.slice(k + 1).every((x) => !(g.values[x.key] ?? 0))
                // 2px surface gap between stacked segments
                return (
                  <div
                    key={s.key}
                    className={`w-full max-w-6 ${top ? 'rounded-t' : ''}`}
                    style={{ height: (v / max) * PLOT_H, background: s.color, borderTop: top ? undefined : '2px solid var(--surface)' }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <XLabels labels={groups.map((g) => g.label)} every={1} suffix="%" />
      {el}
    </div>
  )
}

function XLabels({ labels, every, suffix = '' }: { labels: string[]; every: number; suffix?: string }) {
  return (
    <div className="mt-1 ml-7 flex text-[10px] text-zinc-500">
      {labels.map((l, i) => (
        <div key={l} className="flex-1 truncate text-center">
          {(labels.length - 1 - i) % every === 0 ? `${l}${suffix}` : ''}
        </div>
      ))}
    </div>
  )
}

function HBars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const { bind, el } = useTip()
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div data-chart className="relative flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 rounded-sm text-xs hover:bg-zinc-500/5" {...bind(`${r.label}: ${r.value} ${unit}${r.value === 1 ? '' : 's'}`)}>
          <div className="w-32 shrink-0 truncate text-zinc-600 dark:text-zinc-300" title={r.label}>
            {r.label}
          </div>
          <div className="flex h-5 flex-1 items-center">
            {r.value > 0 && <div className="h-3.5 rounded-r" style={{ width: `${(r.value / max) * 92}%`, background: S1 }} />}
            <span className="ml-1.5 text-zinc-700 tabular-nums dark:text-zinc-200">{r.value}</span>
          </div>
        </div>
      ))}
      {el}
    </div>
  )
}

