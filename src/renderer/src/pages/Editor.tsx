import { useEffect, useState } from 'react'
import type { Application, CoverLetterDoc, Lang, ResumeDoc } from '@shared/types'
import { api, useAction, useLoad, useToast } from '../hooks'

const splitLines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

export default function Editor({ jobId, backLabel, onBack, onJob }: { jobId: number; backLabel: string; onBack: () => void; onJob?: () => void }) {
  const [job] = useLoad(() => api.jobs.get(jobId), [jobId])
  const [loaded] = useLoad(() => api.applications.getByJob(jobId), [jobId], ['applications-changed'])
  const [app, setApp] = useState<Application | null>(null)
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<'resume' | 'letter'>('resume')
  const [lang, setLang] = useState<Lang | ''>('')
  const [tone, setTone] = useState('professional and warm')
  const [preview, setPreview] = useState('')
  const [busy, run] = useAction()
  const toast = useToast()

  useEffect(() => {
    if (loaded && !dirty) setApp(loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // Live preview (slightly debounced so it does not re-render on every keystroke)
  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'resume' && app?.resume) api.docs.previewResumeHtml(app.resume).then(setPreview)
      else if (tab === 'letter' && app?.coverLetter) api.docs.previewCoverLetterHtml(app.coverLetter, jobId).then(setPreview)
      else setPreview('')
    }, 300)
    return () => clearTimeout(t)
  }, [app, tab, jobId])

  const update = (patch: Partial<Application>) => {
    if (!app) return
    setApp({ ...app, ...patch })
    setDirty(true)
  }
  const save = async () => {
    if (!app) return
    await run(() => api.docs.saveApplication(app), 'Saved')
    setDirty(false)
  }
  const regenerate = async () => {
    if (dirty && !confirm('Unsaved edits will be discarded. Continue?')) return
    const l = lang || undefined
    const a = await run(() => (tab === 'resume' ? api.docs.generateResume(jobId, l) : api.docs.generateCoverLetter(jobId, l, tone)), 'Generated')
    if (a) {
      setApp(a)
      setDirty(false)
    }
  }
  const exportAs = async (format: 'pdf' | 'docx') => {
    if (!app) return
    if (dirty) await api.docs.saveApplication(app).then(() => setDirty(false))
    const path = await run(() => (tab === 'resume' ? api.docs.exportResume(app.id, format) : api.docs.exportCoverLetter(app.id, format)))
    if (path) toast(`Saved to ${path}`)
  }

  const hasDoc = tab === 'resume' ? !!app?.resume : !!app?.coverLetter

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-sec" onClick={onBack} title="Back (Alt+←)">
          ← {backLabel}
        </button>
        {onJob && (
          <button className="btn-sec" onClick={onJob} title="Fit analysis, gaps and the original description">
            Job details
          </button>
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold">{job?.title}</div>
          <div className="text-xs text-zinc-500">{job?.company}</div>
        </div>
        <div className="ml-4 flex gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800">
          {(
            [
              ['resume', 'Resume'],
              ['letter', 'Cover letter']
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded px-3 py-1 text-sm ${tab === k ? 'bg-white shadow dark:bg-zinc-900' : ''}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={lang} onChange={(e) => setLang(e.target.value as Lang | '')} title="Output language">
            <option value="">Default language</option>
            <option value="en">English</option>
            <option value="pt">Portuguese</option>
          </select>
          {tab === 'letter' && (
            <select className="input w-auto" value={tone} onChange={(e) => setTone(e.target.value)}>
              <option>professional and warm</option>
              <option>formal</option>
              <option>direct and confident</option>
              <option>enthusiastic</option>
            </select>
          )}
          <button className="btn" disabled={busy} onClick={regenerate}>
            {busy ? 'Generating…' : hasDoc ? '↻ Regenerate' : '✨ Generate'}
          </button>
          <button className="btn-sec" disabled={!dirty || busy} onClick={save}>
            Save
          </button>
          <button className="btn-sec" disabled={!hasDoc || busy} onClick={() => exportAs('pdf')}>
            PDF
          </button>
          <button className="btn-sec" disabled={!hasDoc || busy} onClick={() => exportAs('docx')}>
            DOCX
          </button>
        </div>
      </div>

      {!hasDoc ? (
        <div className="card text-sm text-zinc-500">Nothing generated yet. Click “Generate”.</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-h-0 overflow-auto pr-1">
            {tab === 'resume' && app?.resume && (
              <ResumeForm
                value={app.resume}
                onChange={(resume) => update({ resume })}
                onLearn={() =>
                  run(async () => {
                    if (dirty) {
                      await api.docs.saveApplication(app)
                      setDirty(false)
                    }
                    return api.docs.learnFromEdits(app.id)
                  }).then((r) => r && toast(`Added ${r.added} new fact(s) to the knowledge base.`))
                }
              />
            )}
            {tab === 'letter' && app?.coverLetter && <LetterForm value={app.coverLetter} onChange={(coverLetter) => update({ coverLetter })} />}
          </div>
          <iframe title="Preview" sandbox="" srcDoc={preview} className="h-full min-h-[600px] w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800" />
        </div>
      )}
    </div>
  )
}

function ResumeForm({ value: r, onChange, onLearn }: { value: ResumeDoc; onChange: (r: ResumeDoc) => void; onLearn: () => void }) {
  const set = <K extends keyof ResumeDoc>(k: K, v: ResumeDoc[K]) => onChange({ ...r, [k]: v })
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-col gap-2">
        <label>
          <span className="label">Headline</span>
          <input className="input" value={r.headline} onChange={(e) => set('headline', e.target.value)} />
        </label>
        <label>
          <span className="label">Summary</span>
          <textarea className="input min-h-24" value={r.summary} onChange={(e) => set('summary', e.target.value)} />
        </label>
        <label>
          <span className="label">Skills (comma-separated)</span>
          <textarea
            className="input min-h-16"
            value={r.skills.join(', ')}
            onChange={(e) =>
              set(
                'skills',
                e.target.value.split(',').map((s) => s.trimStart())
              )
            }
            onBlur={() => set('skills', r.skills.map((s) => s.trim()).filter(Boolean))}
          />
        </label>
      </div>
      {r.experiences.map((e, i) => (
        <div key={i} className="card">
          <div className="mb-2 text-sm font-semibold">
            {e.title} — {e.company} <span className="font-normal text-zinc-500">{e.period}</span>
          </div>
          <span className="label">Bullets (one per line)</span>
          <textarea
            className="input min-h-28"
            value={e.bullets.join('\n')}
            onChange={(ev) => {
              const experiences = [...r.experiences]
              experiences[i] = { ...e, bullets: ev.target.value.split('\n') }
              set('experiences', experiences)
            }}
            onBlur={() => {
              const experiences = [...r.experiences]
              experiences[i] = { ...e, bullets: splitLines(e.bullets.join('\n')) }
              set('experiences', experiences)
            }}
          />
        </div>
      ))}
      <div className="card text-sm">
        <p className="mb-2 text-zinc-500">
          Wrote new bullets with real information that is not yet in your knowledge base? Send them to the knowledge base so they are used for future
          jobs.
        </p>
        <button className="btn-sec" onClick={onLearn}>
          🧠 Send new points to the knowledge base
        </button>
      </div>
    </div>
  )
}

function LetterForm({ value: c, onChange }: { value: CoverLetterDoc; onChange: (c: CoverLetterDoc) => void }) {
  return (
    <div className="card flex flex-col gap-2">
      <label>
        <span className="label">Greeting</span>
        <input className="input" value={c.greeting} onChange={(e) => onChange({ ...c, greeting: e.target.value })} />
      </label>
      <label>
        <span className="label">Body (paragraphs separated by a blank line)</span>
        <textarea
          className="input min-h-80"
          value={c.paragraphs.join('\n\n')}
          onChange={(e) => onChange({ ...c, paragraphs: e.target.value.split(/\n\s*\n/) })}
        />
      </label>
      <label>
        <span className="label">Closing</span>
        <input className="input" value={c.closing} onChange={(e) => onChange({ ...c, closing: e.target.value })} />
      </label>
      <label>
        <span className="label">Signature</span>
        <input className="input" value={c.signature} onChange={(e) => onChange({ ...c, signature: e.target.value })} />
      </label>
    </div>
  )
}
