import { useMemo, useState } from 'react'
import { BLACKLIST_KINDS, type BlacklistKind } from '@shared/types'
import { api, useAction, useLoad } from '../hooks'

/**
 * Things the agent must never apply to or contact. The agent also adds entries here when the candidate answers
 * "Skip this job" / "Never apply to this company" during a run, or says so in a free-text answer.
 */
export default function BlacklistPage() {
  const [entries, reload] = useLoad(() => api.blacklist.list(), [], ['blacklist-changed'])
  const [busy, run] = useAction()
  const [kind, setKind] = useState<BlacklistKind>('company')
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')
  const [filter, setFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<BlacklistKind | 'all'>('all')

  const add = async () => {
    const r = await run(() => api.blacklist.add({ kind, label, reason }), 'Added to the blacklist')
    if (r) {
      setLabel('')
      setReason('')
      reload()
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (entries ?? []).filter((e) => (kindFilter === 'all' || e.kind === kindFilter) && (!q || `${e.label} ${e.reason}`.toLowerCase().includes(q)))
  }, [entries, filter, kindFilter])

  const kindLabel = (k: BlacklistKind) => BLACKLIST_KINDS.find((x) => x.id === k)?.label ?? k

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Blacklist</h1>
      <p className="mb-5 text-sm text-zinc-500">
        The agent never opens, applies to or contacts anything on this list. It also adds entries itself when you answer “Skip this job” or “Never
        apply to this company” during a run, or tell it so in an answer.
      </p>

      <div className="card mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_1fr_auto] sm:items-end">
          <label>
            <span className="label">Type</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as BlacklistKind)}>
              {BLACKLIST_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">{kindLabel(kind)}</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && label.trim() && void add()}
              placeholder={BLACKLIST_KINDS.find((k) => k.id === kind)?.placeholder}
            />
          </label>
          <label>
            <span className="label">Reason (optional)</span>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && label.trim() && void add()}
              placeholder="Rejected me in October; reapply only in 2027"
            />
          </label>
          <button className="btn" disabled={busy || !label.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>
        {kind === 'keyword' && (
          <p className="mt-2 text-xs text-zinc-500">Whole words, ignoring case and accents: “java” skips “Java Developer” but not “JavaScript Developer”.</p>
        )}
        {kind === 'company' && <p className="mt-2 text-xs text-zinc-500">Matches the company name without suffixes or accents: “Proxify” also blocks “Proxify AB”.</p>}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" />
        <select className="input w-auto" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as BlacklistKind | 'all')}>
          <option value="all">All types</option>
          {BLACKLIST_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="badge ml-auto">{shown.length}</span>
      </div>

      {entries && !entries.length ? (
        <div className="card text-sm text-zinc-500">Nothing blacklisted yet.</div>
      ) : (
        <div className="card divide-y divide-zinc-100 p-0 dark:divide-zinc-800">
          {shown.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="badge shrink-0">{kindLabel(e.kind)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {/^https?:\/\//.test(e.label) ? (
                    <a href={e.label} target="_blank" rel="noreferrer" className="hover:underline">
                      {e.label}
                    </a>
                  ) : (
                    e.label
                  )}
                </div>
                {e.reason && <div className="truncate text-xs text-zinc-500">{e.reason}</div>}
              </div>
              <span className="shrink-0 text-xs text-zinc-400" title={e.source === 'agent' ? 'Added by the agent from your answer' : 'Added by you'}>
                {e.source === 'agent' ? '🤖 ' : ''}
                {new Date(e.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString()}
              </span>
              <button className="btn-danger shrink-0" disabled={busy} onClick={() => run(() => api.blacklist.delete(e.id)).then(reload)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
