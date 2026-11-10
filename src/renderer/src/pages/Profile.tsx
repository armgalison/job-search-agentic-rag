import { useEffect, useState } from 'react'
import { emptyProfile, type FactSource, type ItemDataMap, type ItemKind, type Profile, type ProfileItem } from '@shared/types'
import { InlineEdit } from '../components/InlineEdit'
import { api, useAction, useLoad } from '../hooks'

type FieldDef = { key: string; label: string; multiline?: boolean; placeholder?: string }

const ITEM_DEFS: { kind: ItemKind; title: string; fields: FieldDef[]; summary: (d: Record<string, string>) => string }[] = [
  {
    kind: 'experience',
    title: 'Experience',
    fields: [
      { key: 'company', label: 'Company' },
      { key: 'title', label: 'Title' },
      { key: 'location', label: 'Location' },
      { key: 'start', label: 'Start', placeholder: 'MM/YYYY' },
      { key: 'end', label: 'End', placeholder: 'empty = present' },
      { key: 'description', label: 'Responsibilities (one per line)', multiline: true },
      { key: 'achievements', label: 'Measurable achievements (one per line)', multiline: true }
    ],
    summary: (d) => `${d.title} — ${d.company} (${d.start || '?'} – ${d.end || 'present'})`
  },
  {
    kind: 'education',
    title: 'Education',
    fields: [
      { key: 'institution', label: 'Institution' },
      { key: 'degree', label: 'Degree', placeholder: "Bachelor's, MBA…" },
      { key: 'field', label: 'Field of study' },
      { key: 'start', label: 'Start' },
      { key: 'end', label: 'End' }
    ],
    summary: (d) => `${d.degree} ${d.field} — ${d.institution}`
  },
  {
    kind: 'skill',
    title: 'Skills',
    fields: [
      { key: 'name', label: 'Skill' },
      { key: 'level', label: 'Level', placeholder: 'beginner, intermediate, advanced' },
      { key: 'years', label: 'Years' }
    ],
    summary: (d) => [d.name, d.level, d.years && `${d.years} years`].filter(Boolean).join(' · ')
  },
  {
    kind: 'project',
    title: 'Projects',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'url', label: 'URL' },
      { key: 'tech', label: 'Technologies' },
      { key: 'description', label: 'Description', multiline: true }
    ],
    summary: (d) => d.name
  },
  {
    kind: 'certification',
    title: 'Certifications',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'issuer', label: 'Issuer' },
      { key: 'date', label: 'Date' }
    ],
    summary: (d) => `${d.name}${d.issuer ? ` — ${d.issuer}` : ''}`
  },
  {
    kind: 'language',
    title: 'Languages',
    fields: [
      { key: 'name', label: 'Language' },
      { key: 'level', label: 'Level', placeholder: 'native, fluent, B2…' }
    ],
    summary: (d) => `${d.name} — ${d.level}`
  }
]

const PROFILE_FIELDS: { key: keyof Profile; label: string; multiline?: boolean; wide?: boolean }[] = [
  { key: 'fullName', label: 'Full name' },
  { key: 'headline', label: 'Professional headline' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'location', label: 'City / country' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'github', label: 'GitHub' },
  { key: 'website', label: 'Website / portfolio' },
  { key: 'targetRoles', label: 'Target roles (used for searches)', wide: true },
  { key: 'summary', label: 'Professional summary', multiline: true, wide: true },
  { key: 'preferences', label: 'Preferences (remote, salary, industries, work authorization…)', multiline: true, wide: true }
]

export default function ProfilePage() {
  const [tab, setTab] = useState<'data' | 'facts' | 'answers'>('data')
  const [busy, run] = useAction()

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">My profile</h1>
        <div className="ml-auto flex gap-2">
          <button
            className="btn-sec"
            disabled={busy}
            onClick={() => run(() => api.profile.importResume()).then((r) => r && alert(`Imported ${r.imported} item(s) from the resume.`))}
          >
            {busy ? 'Importing…' : '📄 Import resume (PDF/DOCX)'}
          </button>
        </div>
      </div>
      <div className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ['data', 'Details & experience'],
            ['facts', 'Knowledge base (RAG)'],
            ['answers', 'Saved answers']
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-indigo-600 font-medium text-indigo-600' : 'border-transparent text-zinc-500'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'data' && (
        <>
          <BasicInfo />
          {ITEM_DEFS.map((def) => (
            <ItemSection key={def.kind} {...def} />
          ))}
        </>
      )}
      {tab === 'facts' && <FactsPanel />}
      {tab === 'answers' && <QaPanel />}
    </div>
  )
}

function BasicInfo() {
  const [loaded] = useLoad(() => api.profile.get(), [], ['facts-changed'])
  const [p, setP] = useState<Profile>(emptyProfile)
  const [busy, run] = useAction()
  useEffect(() => {
    if (loaded) setP(loaded)
  }, [loaded])

  return (
    <section className="card mb-6">
      <h2 className="h2">Personal details</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {PROFILE_FIELDS.map((f) => (
          <label key={f.key} className={f.wide ? 'md:col-span-2' : ''}>
            <span className="label">{f.label}</span>
            {f.multiline ? (
              <textarea className="input min-h-20" value={p[f.key]} onChange={(e) => setP({ ...p, [f.key]: e.target.value })} />
            ) : (
              <input className="input" value={p[f.key]} onChange={(e) => setP({ ...p, [f.key]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button className="btn" disabled={busy} onClick={() => run(() => api.profile.save(p), 'Profile saved')}>
          Save details
        </button>
      </div>
    </section>
  )
}

function ItemSection({ kind, title, fields, summary }: (typeof ITEM_DEFS)[number]) {
  const [items, reload] = useLoad(() => api.profile.listItems(kind), [kind], ['facts-changed'])
  const [editing, setEditing] = useState<{ id?: number; data: Record<string, string> } | null>(null)
  const [busy, run] = useAction()
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, '']))

  const save = async () => {
    if (!editing) return
    await run(() => api.profile.saveItem(kind, editing.data as unknown as ItemDataMap[ItemKind], editing.id), 'Saved and indexed')
    setEditing(null)
    reload()
  }

  return (
    <section className="card mb-6">
      <div className="mb-3 flex items-center">
        <h2 className="h2 mb-0">{title}</h2>
        <button className="btn-sec ml-auto" onClick={() => setEditing({ data: blank() })}>
          + Add
        </button>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {(items ?? []).map((it: ProfileItem) => (
          <li key={it.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{summary(it.data as unknown as Record<string, string>)}</span>
            <button
              className="btn-sec px-2 py-0.5 text-xs"
              onClick={() => setEditing({ id: it.id, data: { ...blank(), ...(it.data as unknown as Record<string, string>) } })}
            >
              Edit
            </button>
            <button
              className="btn-danger"
              onClick={() => confirm('Remove this item and its facts from the knowledge base?') && run(() => api.profile.deleteItem(it.id)).then(reload)}
            >
              Remove
            </button>
          </li>
        ))}
        {items?.length === 0 && !editing && <li className="py-2 text-sm text-zinc-500">No items yet.</li>}
      </ul>
      {editing && (
        <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {fields.map((f) => (
              <label key={f.key} className={f.multiline ? 'md:col-span-2' : ''}>
                <span className="label">{f.label}</span>
                {f.multiline ? (
                  <textarea
                    className="input min-h-24"
                    value={editing.data[f.key] ?? ''}
                    onChange={(e) => setEditing({ ...editing, data: { ...editing.data, [f.key]: e.target.value } })}
                  />
                ) : (
                  <input
                    className="input"
                    placeholder={f.placeholder}
                    value={editing.data[f.key] ?? ''}
                    onChange={(e) => setEditing({ ...editing, data: { ...editing.data, [f.key]: e.target.value } })}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn-sec" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn" disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

const SOURCE_LABEL: Record<FactSource, string> = {
  profile: 'profile',
  manual: 'manual',
  'gap-answer': 'gap answer',
  'easy-apply': 'Easy Apply',
  editor: 'editor',
  import: 'import'
}

function FactsPanel() {
  const [facts, reload] = useLoad(() => api.facts.list(), [], ['facts-changed'])
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [source, setSource] = useState<FactSource | 'all'>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, run] = useAction()
  const shown = (facts ?? []).filter(
    (f) => (source === 'all' || f.source === source) && (!filter || f.text.toLowerCase().includes(filter.toLowerCase()))
  )
  const shownSelected = shown.filter((f) => selected.has(f.id))
  const allShownSelected = shown.length > 0 && shownSelected.length === shown.length

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAllShown = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const f of shown) {
        if (allShownSelected) next.delete(f.id)
        else next.add(f.id)
      }
      return next
    })

  const remove = async (ids: number[]) => {
    if (!ids.length) return
    const hasProfile = (facts ?? []).some((f) => ids.includes(f.id) && f.source === 'profile')
    const msg =
      `Delete ${ids.length} fact(s) from the knowledge base?` +
      (hasProfile ? '\n\nFacts generated from your profile will stay excluded even if you save the profile item again or reindex.' : '')
    if (!confirm(msg)) return
    const r = await run(() => api.facts.deleteMany(ids), `Deleted ${ids.length} fact(s)`)
    if (r) {
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
      reload()
    }
  }

  return (
    <section className="card">
      <p className="mb-3 text-sm text-zinc-500">
        Each fact is a short, verifiable statement about you. The AI only uses what is here to write resumes, cover letters and answers. Profile facts are
        generated automatically; you can add others (projects, numbers, context) and delete any you do not want used.
      </p>
      <div className="mb-4 flex gap-2">
        <input
          className="input"
          placeholder="e.g. Cut deploy time from 40 to 8 minutes by migrating CI to GitHub Actions at Company X"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && run(() => api.facts.add(text)).then(() => setText(''))}
        />
        <button className="btn shrink-0" disabled={!text.trim() || busy} onClick={() => run(() => api.facts.add(text)).then(() => setText(''))}>
          Add fact
        </button>
        <button className="btn-sec shrink-0" disabled={busy} onClick={() => run(() => api.facts.reindex()).then((r) => r && alert(`Reindexed ${r.indexed} fact(s).`))}>
          Reindex
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input min-w-48 flex-1" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="input w-auto" value={source} onChange={(e) => setSource(e.target.value as FactSource | 'all')}>
          <option value="all">All sources</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-1 flex items-center gap-3 border-b border-zinc-100 pb-2 text-sm dark:border-zinc-800">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={!shown.length} />
          Select all shown
        </label>
        <span className="text-xs text-zinc-500">{shownSelected.length} selected</span>
        <button className="btn-danger ml-auto border border-red-200 dark:border-red-900" disabled={busy || !shownSelected.length} onClick={() => remove(shownSelected.map((f) => f.id))}>
          🗑 Delete selected ({shownSelected.length})
        </button>
        <button
          className="btn-danger border border-red-200 dark:border-red-900"
          disabled={busy || !shown.length}
          onClick={() => remove(shown.map((f) => f.id))}
          title="Deletes every fact matching the current filter"
        >
          🗑 Delete all shown ({shown.length})
        </button>
      </div>
      <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {shown.map((f) => (
          <li key={f.id} className="flex items-start gap-2 py-2">
            <input type="checkbox" className="mt-1" checked={selected.has(f.id)} onChange={() => toggle(f.id)} aria-label="Select fact" />
            <span className="badge mt-0.5 shrink-0">{SOURCE_LABEL[f.source]}</span>
            <span className="flex-1">{f.text}</span>
            {f.source !== 'profile' && (
              <div className="shrink-0">
                <InlineEdit value={f.text} onSave={(t) => run(() => api.facts.update(f.id, t)).then(reload)} />
              </div>
            )}
            <button className="btn-danger shrink-0" disabled={busy} onClick={() => remove([f.id])} title="Delete this fact">
              🗑 Delete
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="py-2 text-zinc-500">No facts match.</li>}
      </ul>
      <p className="mt-3 text-xs text-zinc-500">{facts?.length ?? 0} fact(s) in the knowledge base.</p>
    </section>
  )
}

function QaPanel() {
  const [items, reload] = useLoad(() => api.qa.list(), [], ['facts-changed'])
  const [, run] = useAction()
  return (
    <section className="card">
      <p className="mb-3 text-sm text-zinc-500">
        Answers you gave in Easy Apply forms. They are reused automatically whenever the same question comes up again.
      </p>
      <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {(items ?? []).map((q) => (
          <li key={q.id} className="flex items-start gap-3 py-2">
            <div className="flex-1">
              <div className="font-medium">{q.question}</div>
              <div className="text-zinc-600 dark:text-zinc-400">{q.answer}</div>
            </div>
            <div className="w-64 shrink-0 text-right">
              <InlineEdit value={q.answer} onSave={(a) => run(() => api.qa.save(q.question, a)).then(reload)} />
            </div>
            <button className="btn-danger" onClick={() => run(() => api.qa.delete(q.id)).then(reload)}>
              Remove
            </button>
          </li>
        ))}
        {items?.length === 0 && <li className="py-2 text-zinc-500">No saved answers yet.</li>}
      </ul>
    </section>
  )
}
