import { useEffect, useMemo, useRef, useState } from 'react'
import { JOB_SOURCES, type AgentEvent, type AgentQuestion, type AgentState, type AgentTask, type JobSource, type Outreach } from '@shared/types'
import { api, useAction, useLoad } from '../hooks'

type Mode = AgentTask['mode']

const KIND_ICON: Record<AgentEvent['kind'], string> = {
  status: '•',
  text: '💬',
  tool: '▸',
  'tool-result': '↳',
  skill: '📘',
  question: '❓',
  answer: '✍',
  error: '✖',
  result: '✔'
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'apply-job', label: 'Apply to one job' },
  { id: 'search', label: 'Search and apply' },
  { id: 'outreach', label: 'Outreach only' },
  { id: 'check-email', label: 'Check email replies' },
  { id: 'custom', label: 'Custom task' }
]

export default function AgentPage({ initialJobId }: { initialJobId?: number }) {
  const [state, setState] = useState<AgentState>({ run: null, questions: [], events: [] })
  const [showTools, setShowTools] = useState(true)
  const [follow, setFollow] = useState(true)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.agent.state().then(setState)
    return api.onEvent((e) => {
      if (e.type === 'agent') setState((s) => ({ ...s, events: [...s.events.slice(-1999), e.event] }))
      if (e.type === 'agent-state') setState((s) => ({ ...s, run: e.state.run, questions: e.state.questions }))
    })
  }, [])

  const shown = useMemo(() => state.events.filter((e) => showTools || (e.kind !== 'tool' && e.kind !== 'tool-result')), [state.events, showTools])
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: 'end' })
  }, [shown, follow])

  const running = state.run?.status === 'running'

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Agent</h1>
        {state.run && <RunBadge run={state.run} />}
        {running && (
          <button className="btn-sec ml-auto" onClick={() => void api.agent.stop()}>
            ■ Stop
          </button>
        )}
      </div>

      {!running && <StartPanel initialJobId={initialJobId} />}

      {state.questions.map((q) => (
        <QuestionCard key={q.id} q={q} />
      ))}

      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium">Activity</span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} /> Show browser/tool steps
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
        </label>
      </div>
      <div className="card min-h-48 flex-1 overflow-auto p-0 text-sm" role="log" aria-live="polite">
        {shown.map((e) => (
          <EventRow key={`${e.runId}-${e.seq}`} e={e} />
        ))}
        {!shown.length && (
          <div className="p-4 text-zinc-500">
            Nothing yet. Start a run: the agent opens its own browser window so you can watch every step, and it asks here when it needs something from you.
          </div>
        )}
        <div ref={bottom} />
      </div>

      <OutreachList />
    </div>
  )
}

function RunBadge({ run }: { run: NonNullable<AgentState['run']> }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (run.status !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [run.status])
  const end = run.endedAt ? new Date(run.endedAt).getTime() : now
  const secs = Math.max(0, Math.round((end - new Date(run.startedAt).getTime()) / 1000))
  const color =
    run.status === 'running'
      ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
      : run.status === 'done'
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
        : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {run.status === 'running' ? '● Running' : run.status === 'done' ? 'Finished' : run.status === 'stopped' ? 'Stopped' : 'Failed'} · {Math.floor(secs / 60)}m{' '}
      {secs % 60}s · {run.applications} applied · {run.messages} messages{run.costUsd != null ? ` · ≈$${run.costUsd.toFixed(2)}` : ''}
    </span>
  )
}

function StartPanel({ initialJobId }: { initialJobId?: number }) {
  const [jobs] = useLoad(() => api.jobs.list(), [], ['jobs-changed'])
  const [settings] = useLoad(() => api.settings.get(), [])
  const [mode, setMode] = useState<Mode>('apply-job')
  const [jobId, setJobId] = useState<number | ''>(initialJobId ?? '')
  const [url, setUrl] = useState('')
  const [search, setSearch] = useState({ source: 'linkedin' as JobSource, keywords: '', location: '', remote: false, easyApplyOnly: false, maxJobs: 5, fundedWithinMonths: 6 })
  const [instructions, setInstructions] = useState('')
  const [days, setDays] = useState(14)
  const [busy, run] = useAction()

  useEffect(() => {
    if (initialJobId) setJobId(initialJobId)
  }, [initialJobId])

  const task = (): AgentTask => {
    switch (mode) {
      case 'apply-job':
        return url.trim() ? { mode, url: url.trim() } : { mode, jobId: jobId || undefined }
      case 'search':
        return {
          mode,
          ...search,
          easyApplyOnly: search.source === 'linkedin' && search.easyApplyOnly,
          fundedWithinMonths: search.source === 'funded-startups' ? search.fundedWithinMonths : undefined
        }
      case 'outreach':
        return { mode, jobId: Number(jobId) }
      case 'custom':
        return { mode, instructions }
      case 'check-email':
        return { mode, days }
    }
  }
  const canStart =
    mode === 'apply-job' ? !!jobId || /^https?:\/\//.test(url.trim()) : mode === 'outreach' ? !!jobId : mode === 'custom' ? !!instructions.trim() : true
  const a = settings?.agent

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-md px-3 py-1 text-sm ${mode === m.id ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {(mode === 'apply-job' || mode === 'outreach') && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Saved job</span>
            <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select…</option>
              {(jobs ?? [])
                .filter((j) => j.status !== 'discarded')
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} — {j.company}
                    {j.match ? ` (${j.match.score}%)` : ''}
                    {j.status === 'applied' ? ' · applied' : ''}
                  </option>
                ))}
            </select>
          </label>
          {mode === 'apply-job' && (
            <label>
              <span className="label">…or paste a job URL (LinkedIn or company site)</span>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/jobs/view/…" />
            </label>
          )}
        </div>
      )}

      {mode === 'search' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="sm:col-span-3">
            <span className="label">Search type</span>
            <select className="input" value={search.source} onChange={(e) => setSearch({ ...search, source: e.target.value as JobSource })}>
              {JOB_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-zinc-500">{JOB_SOURCES.find((s) => s.id === search.source)?.hint}</span>
          </label>
          <label className="sm:col-span-2">
            <span className="label">Keywords (empty = your target roles)</span>
            <input className="input" value={search.keywords} onChange={(e) => setSearch({ ...search, keywords: e.target.value })} placeholder="Senior backend engineer Go" />
          </label>
          <label>
            <span className="label">Location</span>
            <input className="input" value={search.location} onChange={(e) => setSearch({ ...search, location: e.target.value })} placeholder="Brazil" />
          </label>
          <label>
            <span className="label">Jobs to apply to</span>
            <input className="input" type="number" min={1} max={50} value={search.maxJobs} onChange={(e) => setSearch({ ...search, maxJobs: Number(e.target.value) || 1 })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={search.remote} onChange={(e) => setSearch({ ...search, remote: e.target.checked })} /> Remote only
          </label>
          {search.source === 'linkedin' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={search.easyApplyOnly} onChange={(e) => setSearch({ ...search, easyApplyOnly: e.target.checked })} /> Easy Apply only
            </label>
          )}
          {search.source === 'funded-startups' && (
            <label>
              <span className="label">Funding announced in the last</span>
              <select className="input" value={search.fundedWithinMonths} onChange={(e) => setSearch({ ...search, fundedWithinMonths: Number(e.target.value) })}>
                {[3, 6, 12, 18].map((m) => (
                  <option key={m} value={m}>
                    {m} months
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {mode === 'check-email' && (
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="label">Look at emails from the last</span>
            <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[3, 7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <p className="flex-1 text-xs text-zinc-500">
            {a?.emailSource === 'webmail'
              ? `Opens ${a.webmailUrl} in the agent's browser (log in there once).`
              : "Reads your Gmail through the claude.ai Gmail connector of the account Claude Code is logged in with (read-only: it can't send or delete)."}{' '}
            Replies are matched to your applications and the cards move to Awaiting scheduling, Interview, Offer or Rejected. Change the inbox in Settings → Agent.
          </p>
        </div>
      )}

      {mode === 'custom' && (
        <label className="block">
          <span className="label">What should the agent do?</span>
          <textarea
            className="input min-h-20"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Follow up with the recruiters I messaged last week who accepted my connection request."
          />
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy || !canStart} onClick={() => run(() => api.agent.start(task()))}>
          ▶ Start agent
        </button>
        {a && (
          <span className="text-xs text-zinc-500">
            {a.dryRun ? 'Dry run (never submits)' : a.confirmBeforeSubmit ? 'Asks before each Submit/Send' : 'Fully automatic'} · min fit {a.minScore}% · up to{' '}
            {a.maxApplicationsPerRun} applications / {a.maxMessagesPerRun} messages · outreach {a.outreach ? 'on' : 'off'} · change in Settings
          </span>
        )}
      </div>
    </div>
  )
}

function QuestionCard({ q }: { q: AgentQuestion }) {
  const [text, setText] = useState('')
  const [busy, run] = useAction()
  const send = (answer: string) => run(() => api.agent.answer(q.id, answer))
  const tone =
    q.kind === 'approval'
      ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40'
      : q.kind === 'action'
        ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40'
        : 'border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40'
  return (
    <div className={`rounded-lg border-2 p-4 ${tone}`}>
      <div className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {q.kind === 'approval' ? 'Approval needed' : q.kind === 'action' ? 'Your action is needed in the agent browser' : 'Question about you'}
      </div>
      <div className="font-medium whitespace-pre-wrap">{q.question}</div>
      {q.reason && <div className="mt-1 text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{q.reason}</div>}
      {q.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {q.options.map((o) => (
            <button key={o} className="btn-sec" disabled={busy} onClick={() => send(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {q.kind !== 'approval' && (
        <div className="mt-3 flex gap-2">
          <textarea
            className="input min-h-10 flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={q.kind === 'knowledge' ? 'Your answer (it is also saved to your knowledge base)…' : 'Optional note for the agent…'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) void send(text.trim())
            }}
          />
          <div className="flex flex-col gap-2">
            <button className="btn" disabled={busy || !text.trim()} onClick={() => send(text.trim())}>
              Send
            </button>
            {q.kind === 'knowledge' && (
              <button className="btn-sec" disabled={busy} onClick={() => send("No, I don't have this experience.")}>
                I don't have it
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EventRow({ e }: { e: AgentEvent }) {
  const [open, setOpen] = useState(false)
  const color =
    e.kind === 'error' || e.isError
      ? 'text-red-700 dark:text-red-400'
      : e.kind === 'tool' || e.kind === 'tool-result'
        ? 'text-zinc-500'
        : e.kind === 'result'
          ? 'text-emerald-700 dark:text-emerald-400'
          : e.kind === 'question' || e.kind === 'answer'
            ? 'text-indigo-700 dark:text-indigo-300'
            : ''
  const mono = e.kind === 'tool' || e.kind === 'tool-result'
  return (
    <div className="border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800">
      <button className={`flex w-full gap-2 text-left ${color} ${mono ? 'font-mono text-xs' : ''}`} onClick={() => e.detail && setOpen(!open)}>
        <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{new Date(e.ts).toLocaleTimeString('en-US', { hour12: false })}</span>
        <span className="w-4 shrink-0 text-center">{KIND_ICON[e.kind]}</span>
        {e.tool && <span className="shrink-0 text-indigo-600 dark:text-indigo-400">{e.tool}</span>}
        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{e.text}</span>
        {e.detail && <span className="shrink-0 text-zinc-400">{open ? '▾' : '▸'}</span>}
      </button>
      {open && e.detail && (
        <pre className="mt-1 ml-20 max-h-80 overflow-auto rounded bg-zinc-50 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          {e.detail}
        </pre>
      )}
    </div>
  )
}

function OutreachList() {
  const [list] = useLoad<Outreach[]>(() => api.outreach.list(), [], ['outreach-changed'])
  if (!list?.length) return null
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-medium">Messages sent ({list.filter((o) => o.status === 'sent').length})</summary>
      <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {list.slice(0, 100).map((o) => (
          <li key={o.id} className="py-2">
            <div className="flex flex-wrap gap-2">
              <a className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={o.profileUrl} target="_blank" rel="noreferrer">
                {o.name}
              </a>
              <span className="text-zinc-500">
                {o.role} · {o.channel} · {o.status}
                {o.job ? ` · ${o.job.title} — ${o.job.company}` : ''} · {o.createdAt}
              </span>
            </div>
            {o.message && <div className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{o.message}</div>}
          </li>
        ))}
      </ul>
    </details>
  )
}
