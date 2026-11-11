import { useEffect, useMemo, useState } from 'react'
import type { Job, JobSearchQuery, JobStatus } from '@shared/types'
import { api, useAction, useLoad } from '../hooks'

const STATUS: Record<JobStatus, string> = {
  lead: 'Lead (title only)',
  captured: 'Captured',
  analyzed: 'Analyzed',
  applied: 'Applied',
  discarded: 'Discarded'
}

const scoreColor = (s: number) => (s >= 75 ? 'bg-emerald-600' : s >= 50 ? 'bg-amber-500' : 'bg-zinc-400')

export default function Jobs({ initialJobId, onEdit }: { initialJobId?: number; onEdit: (jobId: number) => void }) {
  const [jobs] = useLoad(() => api.jobs.list(), [], ['jobs-changed'])
  const [selected, setSelected] = useState<number | undefined>(initialJobId)
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all' | 'active'>('active')
  const [sort, setSort] = useState<'recent' | 'score'>('recent')

  const shown = useMemo(() => {
    let list = (jobs ?? []).filter((j) =>
      statusFilter === 'all' ? true : statusFilter === 'active' ? j.status !== 'discarded' : j.status === statusFilter
    )
    if (sort === 'score') list = [...list].sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1))
    return list
  }, [jobs, statusFilter, sort])

  const job = jobs?.find((j) => j.id === selected) ?? null

  return (
    <div className="flex h-full min-h-0 gap-5">
      <div className="flex w-[380px] shrink-0 flex-col gap-4">
        <SearchBox />
        <div className="flex gap-2">
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">Active</option>
            <option value="all">All</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="recent">Most recent</option>
            <option value="score">Best fit</option>
          </select>
        </div>
        <ul className="card min-h-0 flex-1 divide-y divide-zinc-100 overflow-auto p-0 dark:divide-zinc-800">
          {shown.map((j) => (
            <li key={j.id}>
              <button
                onClick={() => setSelected(j.id)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${selected === j.id ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{j.title}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {j.company} {j.location && `· ${j.location}`}
                  </div>
                </div>
                {j.match ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${scoreColor(j.match.score)}`}>{j.match.score}%</span>
                ) : (
                  <span className="badge">{STATUS[j.status]}</span>
                )}
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="p-4 text-sm text-zinc-500">
              No jobs yet. Run a search, open a job on LinkedIn and use the <b>“Capture & analyze job”</b> panel.
            </li>
          )}
        </ul>
        <ManualAdd onAdded={setSelected} />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {job ? <JobDetail key={job.id} job={job} onEdit={onEdit} /> : <div className="p-8 text-sm text-zinc-500">Select a job.</div>}
      </div>
    </div>
  )
}

function SearchBox() {
  const [profile] = useLoad(() => api.profile.get(), [])
  const [q, setQ] = useState<JobSearchQuery>({ keywords: '', location: '', remote: false, easyApplyOnly: true })
  const [busy, run] = useAction()
  useEffect(() => {
    if (profile && !q.keywords) setQ((x) => ({ ...x, keywords: profile.targetRoles.split(/[,;\n]/)[0]?.trim() ?? '', location: profile.location }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  return (
    <div className="card">
      <div className="mb-2 text-sm font-semibold">Search LinkedIn</div>
      <input className="input mb-2" placeholder="Role / keywords" value={q.keywords} onChange={(e) => setQ({ ...q, keywords: e.target.value })} />
      <input className="input mb-2" placeholder="Location" value={q.location} onChange={(e) => setQ({ ...q, location: e.target.value })} />
      <div className="mb-3 flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={q.remote} onChange={(e) => setQ({ ...q, remote: e.target.checked })} /> Remote
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={q.easyApplyOnly} onChange={(e) => setQ({ ...q, easyApplyOnly: e.target.checked })} /> Easy Apply only
        </label>
      </div>
      <button className="btn w-full justify-center" disabled={busy || !q.keywords.trim()} onClick={() => run(() => api.linkedin.search(q))}>
        Open search on LinkedIn
      </button>
      <p className="mt-2 text-xs text-zinc-500">The search opens in the LinkedIn window (log in once). Use the floating panel to capture jobs.</p>
    </div>
  )
}

function ManualAdd({ onAdded }: { onAdded: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ url: '', title: '', company: '', description: '' })
  const [busy, run] = useAction()
  if (!open)
    return (
      <button className="btn-sec justify-center" onClick={() => setOpen(true)}>
        + Paste a job manually
      </button>
    )
  return (
    <div className="card flex flex-col gap-2">
      <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input className="input" placeholder="Company" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
      <input className="input" placeholder="URL (optional)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      <textarea className="input min-h-28" placeholder="Full job description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <div className="flex justify-end gap-2">
        <button className="btn-sec" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="btn"
          disabled={busy || !f.title || !f.description}
          onClick={() =>
            run(() => api.jobs.addManual(f)).then((j) => {
              if (!j) return
              setOpen(false)
              setF({ url: '', title: '', company: '', description: '' })
              onAdded(j.id)
            })
          }
        >
          Add
        </button>
      </div>
    </div>
  )
}

function JobDetail({ job, onEdit }: { job: Job; onEdit: (jobId: number) => void }) {
  const [busy, run] = useAction()
  const [showDesc, setShowDesc] = useState(false)
  const m = job.match
  const r = job.requirements

  const generateAll = async () => {
    await run(async () => {
      await api.docs.generateResume(job.id)
      await api.docs.generateCoverLetter(job.id)
    })
    onEdit(job.id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">{job.title}</h2>
            <div className="text-sm text-zinc-500">
              {job.company} {job.location && `· ${job.location}`} {job.easyApply && <span className="badge ml-1">Easy Apply</span>}
            </div>
          </div>
          {m && (
            <div className="text-right">
              <div className="text-3xl font-bold">{m.score}%</div>
              <div className="text-xs text-zinc-500">fit</div>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {job.description ? (
            <button className="btn" disabled={busy} onClick={() => run(() => api.jobs.analyze(job.id), 'Analysis complete')}>
              {busy ? 'Working…' : r ? '↻ Re-analyze' : '🔍 Analyze fit'}
            </button>
          ) : (
            <span className="text-sm text-amber-600">This job is only a lead: open it on LinkedIn and capture the details.</span>
          )}
          {job.description && (
            <button className="btn" disabled={busy} onClick={generateAll}>
              ✨ Generate resume + cover letter
            </button>
          )}
          <button className="btn-sec" onClick={() => onEdit(job.id)}>
            Open editor
          </button>
          <button className="btn-sec" onClick={() => run(() => api.linkedin.openJob(job.id))}>
            Open on LinkedIn
          </button>
          <button className="btn-sec" title="Open this job in your default browser" onClick={() => run(() => api.linkedin.openJobExternal(job.id))}>
            Open in browser ↗
          </button>
          <select className="input w-auto" value={job.status} onChange={(e) => run(() => api.jobs.setStatus(job.id, e.target.value as JobStatus))}>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn-danger ml-auto" onClick={() => confirm('Delete this job?') && run(() => api.jobs.delete(job.id))}>
            Delete
          </button>
        </div>
      </div>

      {m && (
        <div className="card">
          <p className="mb-3 text-sm">{m.summary}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-emerald-700 uppercase dark:text-emerald-400">Meets</div>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {m.matched.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-amber-700 uppercase dark:text-amber-400">Gaps — answer to enrich your knowledge base</div>
              <ul className="space-y-2 text-sm">
                {m.gaps.map((g, i) => (
                  <GapItem key={i} jobId={job.id} gap={g} />
                ))}
                {m.gaps.length === 0 && <li className="text-zinc-500">No gaps found.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {r && (
        <div className="card text-sm">
          <div className="mb-2 font-semibold">Extracted requirements</div>
          <div className="mb-2">
            <b>Required:</b> {r.mustHave.join(' · ')}
          </div>
          {r.niceToHave.length > 0 && (
            <div className="mb-2">
              <b>Nice to have:</b> {r.niceToHave.join(' · ')}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {r.keywords.map((k) => (
              <span key={k} className="badge">
                {k}
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            {[r.seniority, r.workModel, r.language === 'en' ? 'posting in English' : 'posting in Portuguese'].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}

      {job.description && (
        <div className="card">
          <button className="text-sm font-semibold" onClick={() => setShowDesc(!showDesc)}>
            {showDesc ? '▾' : '▸'} Original description
          </button>
          {showDesc && <pre className="mt-2 font-sans text-sm whitespace-pre-wrap">{job.description}</pre>}
        </div>
      )}
    </div>
  )
}

function GapItem({ jobId, gap }: { jobId: number; gap: string }) {
  const [answer, setAnswer] = useState('')
  const [done, setDone] = useState(false)
  const [busy, run] = useAction()
  if (done) return <li className="text-zinc-500 line-through">{gap}</li>
  return (
    <li>
      <div>{gap}</div>
      <div className="mt-1 flex gap-1">
        <input
          className="input py-1 text-xs"
          placeholder="If you have it, describe it (where, how long, outcome)…"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <button
          className="btn-sec shrink-0 px-2 py-0.5 text-xs"
          disabled={busy || !answer.trim()}
          onClick={() => run(() => api.jobs.answerGap(jobId, gap, answer), 'Added to knowledge base').then((f) => f && setDone(true))}
        >
          Save
        </button>
      </div>
    </li>
  )
}
