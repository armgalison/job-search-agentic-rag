import { useEffect, useState, type DragEvent } from 'react'
import { APPLICATION_STATUSES, type Application, type ApplicationStatus, type Job } from '@shared/types'
import { api, useAction, useLoad } from '../hooks'

const COLUMNS = APPLICATION_STATUSES.map((s) => ({ status: s.id, label: s.label }))

/** Latest "Next: …" written by the email check, shown on the card while it still matters */
const nextStep = (a: Application): string | null => {
  if (a.status !== 'scheduling' && a.status !== 'interview' && a.status !== 'offer') return null
  const lines = a.notes.split('\n').filter((l) => /\bEmail .+ Next: /.test(l))
  return lines.length ? lines[lines.length - 1].replace(/^.* Next: /, '').replace(/ \[→ [^\]]*\]$/, '') : null
}

type AppItem = Application & { job: Pick<Job, 'id' | 'title' | 'company' | 'url'> }
type DropTarget = ApplicationStatus | 'archive' | null

const MIME = 'application/x-job-search-app'

export default function Applications({ onOpen, onJob, onAgent }: { onOpen: (jobId: number) => void; onJob: (jobId: number) => void; onAgent: () => void }) {
  const [loaded, reload] = useLoad(() => api.applications.list(), [], ['applications-changed'])
  const [apps, setApps] = useState<AppItem[] | null>(null)
  const [, run] = useAction()
  const [dragId, setDragId] = useState<number | null>(null)
  const [over, setOver] = useState<DropTarget>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [filter, setFilter] = useState('')
  const [settings] = useLoad(() => api.settings.get(), [])
  const [days, setDays] = useState(14)

  // Local copy for optimistic moves; replaced whenever the server list changes
  useEffect(() => setApps(loaded), [loaded])

  const patch = (id: number, p: Partial<AppItem>) => setApps((list) => list?.map((a) => (a.id === id ? { ...a, ...p } : a)) ?? list)

  const move = (id: number, status: ApplicationStatus) => {
    const a = apps?.find((x) => x.id === id)
    if (!a || a.status === status) return
    patch(id, { status, appliedAt: status === 'applied' && !a.appliedAt ? new Date().toISOString().slice(0, 19).replace('T', ' ') : a.appliedAt })
    void run(() => api.applications.setStatus(id, status)).then(reload)
  }
  const archive = (id: number, archived: boolean) => {
    patch(id, { archivedAt: archived ? new Date().toISOString() : null })
    void run(() => api.applications.setArchived(id, archived), archived ? 'Archived' : 'Restored').then(reload)
  }

  const q = filter.trim().toLowerCase()
  const matches = (a: AppItem) => !q || `${a.job.title} ${a.job.company}`.toLowerCase().includes(q)
  const active = (apps ?? []).filter((a) => !a.archivedAt && matches(a))
  const archived = (apps ?? []).filter((a) => a.archivedAt && matches(a))

  const dropProps = (target: Exclude<DropTarget, null>) => ({
    onDragOver: (e: DragEvent) => {
      if (dragId == null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== target) setOver(target)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === target ? null : o))
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const id = Number(e.dataTransfer.getData(MIME)) || dragId
      setOver(null)
      setDragId(null)
      if (!id) return
      if (target === 'archive') return archive(id, true)
      if (apps?.find((a) => a.id === id)?.archivedAt) archive(id, false)
      move(id, target)
    }
  })

  const card = (a: AppItem) => (
    <div
      key={a.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME, String(a.id))
        e.dataTransfer.effectAllowed = 'move'
        setDragId(a.id)
      }}
      onDragEnd={() => {
        setDragId(null)
        setOver(null)
      }}
      className={`card group cursor-grab p-3 active:cursor-grabbing ${dragId === a.id ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-1">
        <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(a.jobId)} title="Open the resume and cover letter">
          <div className="truncate text-sm font-medium" title={a.job.title}>
            {a.job.title}
          </div>
          <div className="truncate text-xs text-zinc-500">{a.job.company}</div>
        </button>
        <button
          className="shrink-0 rounded px-1 text-sm text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title={a.archivedAt ? 'Restore to the board' : 'Archive'}
          onClick={() => archive(a.id, !a.archivedAt)}
        >
          {a.archivedAt ? '↩' : '🗄'}
        </button>
      </div>
      {nextStep(a) && (
        <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs break-words text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" title="From the latest email">
          📬 {nextStep(a)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        <button className="underline-offset-2 hover:text-indigo-600 hover:underline" onClick={() => onJob(a.jobId)}>
          Details
        </button>
        {a.resume && <span className="badge">Resume</span>}
        {a.coverLetter && <span className="badge">Letter</span>}
        {a.archivedAt && <span className="badge">{COLUMNS.find((c) => c.status === a.status)?.label}</span>}
        {a.appliedAt && <span className="ml-auto">{new Date(a.appliedAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-US')}</span>}
      </div>
      {/* Keyboard alternative to dragging */}
      <select
        className="input mt-2 py-1 text-xs"
        aria-label="Status"
        value={a.status}
        onChange={(e) => move(a.id, e.target.value as ApplicationStatus)}
      >
        {COLUMNS.map((c) => (
          <option key={c.status} value={c.status}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <input className="input ml-auto max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title or company…" />
        <span className="flex items-center gap-1">
          <button
            className="btn"
            title={
              settings?.agent.emailSource === 'webmail'
                ? `The agent opens ${settings.agent.webmailUrl} in its browser, reads the replies and moves the cards`
                : 'The agent reads your Gmail (claude.ai connector, read-only), and moves the cards'
            }
            onClick={async () => {
              const r = await run(() => api.agent.start({ mode: 'check-email', days }))
              if (r) onAgent()
            }}
          >
            📬 Check email replies
          </button>
          <select className="input w-auto py-1 text-xs" aria-label="How far back" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[3, 7, 14, 30, 60].map((d) => (
              <option key={d} value={d}>
                last {d} days
              </option>
            ))}
          </select>
        </span>
        <button className="btn-sec" onClick={() => setShowArchived((v) => !v)}>
          🗄 {showArchived ? 'Hide' : 'Show'} archived ({(apps ?? []).filter((a) => a.archivedAt).length})
        </button>
      </div>
      <p className="-mt-3 mb-4 text-xs text-zinc-500">Drag cards between columns to change their status, or onto “Archive” to hide them. Archived jobs still count as applied for the agent. “Check email replies” lets the agent read companies' answers in your inbox and move the cards (Awaiting scheduling, Interview, Offer, Rejected).</p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const list = active.filter((a) => a.status === col.status)
          return (
            <div
              key={col.status}
              {...dropProps(col.status)}
              className={`flex min-h-32 flex-col rounded-lg p-2 transition-colors ${
                over === col.status ? 'bg-indigo-100 ring-2 ring-indigo-400 dark:bg-indigo-950/60' : 'bg-zinc-100 dark:bg-zinc-900/60'
              }`}
            >
              <div className="mb-2 flex items-center px-1 text-sm font-semibold">
                {col.label}
                <span className="badge ml-auto">{list.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {list.map(card)}
                {!list.length && <div className="flex-1 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700" />}
              </div>
            </div>
          )
        })}
      </div>

      {dragId != null && (
        <div
          {...dropProps('archive')}
          className={`fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-xl border-2 border-dashed px-10 py-4 text-sm font-medium shadow-lg transition-colors ${
            over === 'archive'
              ? 'border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'border-zinc-400 bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
          }`}
        >
          🗄 Drop here to archive
        </div>
      )}

      {showArchived && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">Archived</h2>
          {archived.length ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{archived.map(card)}</div>
          ) : (
            <div className="text-sm text-zinc-500">Nothing archived.</div>
          )}
        </div>
      )}
    </div>
  )
}
