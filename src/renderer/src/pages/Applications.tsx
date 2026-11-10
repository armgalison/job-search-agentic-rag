import type { ApplicationStatus } from '@shared/types'
import { api, useAction, useLoad } from '../hooks'

const COLUMNS: { status: ApplicationStatus; label: string }[] = [
  { status: 'draft', label: 'Draft' },
  { status: 'applied', label: 'Applied' },
  { status: 'interview', label: 'Interview' },
  { status: 'offer', label: 'Offer' },
  { status: 'rejected', label: 'Rejected' }
]

export default function Applications({ onOpen }: { onOpen: (jobId: number) => void }) {
  const [apps, reload] = useLoad(() => api.applications.list(), [], ['applications-changed'])
  const [, run] = useAction()

  return (
    <div>
      <h1 className="mb-5 text-2xl font-semibold">Applications</h1>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {COLUMNS.map((col) => {
          const list = (apps ?? []).filter((a) => a.status === col.status)
          return (
            <div key={col.status} className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900/60">
              <div className="mb-2 flex items-center px-1 text-sm font-semibold">
                {col.label}
                <span className="badge ml-auto">{list.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {list.map((a) => (
                  <div key={a.id} className="card p-3">
                    <button className="w-full text-left" onClick={() => onOpen(a.jobId)}>
                      <div className="truncate text-sm font-medium">{a.job.title}</div>
                      <div className="truncate text-xs text-zinc-500">{a.job.company}</div>
                    </button>
                    <div className="mt-2 flex gap-1 text-xs text-zinc-500">
                      {a.resume && <span className="badge">Resume</span>}
                      {a.coverLetter && <span className="badge">Letter</span>}
                      {a.appliedAt && <span className="ml-auto">{new Date(a.appliedAt + 'Z').toLocaleDateString('en-US')}</span>}
                    </div>
                    <select
                      className="input mt-2 py-1 text-xs"
                      value={a.status}
                      onChange={(e) => run(() => api.applications.setStatus(a.id, e.target.value as ApplicationStatus)).then(reload)}
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.status} value={c.status}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
