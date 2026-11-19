/**
 * Fake window.api for developing the UI in the browser (npm run dev:web), without Electron.
 * - Data lives in memory and is saved to localStorage (per browser).
 * - The "AI" is mocked with simple deterministic rules: good for testing screens, not results.
 * - LinkedIn opens in a new tab (no capture panel); exports download the document HTML.
 * This file is only loaded when window.api does not exist (never in the Electron app).
 */
import {
  defaultSettings,
  emptyProfile,
  type Api,
  type AppEvent,
  type Application,
  type BlacklistEntry,
  type CoverLetterDoc,
  type Fact,
  type FactSource,
  type ItemDataMap,
  type ItemKind,
  type Job,
  type MatchResult,
  type Profile,
  type ProfileItem,
  type QaEntry,
  type ResumeDoc,
  type Settings,
  type AiOperation,
  type UsageRecord,
  type UsageSummary,
  type UsageTotals,
  type LogEntry,
  type LogLevel,
  type LogSource
} from '@shared/types'
import { itemToFacts } from '../../main/rag/facts'
import { normalizeBlacklistValue } from '../../main/agent/blacklist'
import { coverLetterHtml, resumeHtml } from '../../main/docs/templates'
import { parseResumeText } from '@shared/resumeHeuristics'
import { extractTextInBrowser, pickFile } from './browserExtract'

interface Store {
  profile: Profile
  items: ProfileItem[]
  facts: Fact[]
  jobs: Job[]
  apps: Application[]
  qa: QaEntry[]
  blacklist: BlacklistEntry[]
  settings: Omit<Settings, 'hasKey'>
  excludedFacts: string[]
  usage: UsageRecord[]
  seq: number
}

const KEY = 'job-search-rag:mock-store'
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const clone = <T>(x: T): T => structuredClone(x)

function seed(): Store {
  const s: Store = {
    profile: {
      ...emptyProfile,
      fullName: 'Alex Example',
      headline: 'Backend Software Engineer',
      email: 'alex@example.com',
      location: 'Austin, TX',
      targetRoles: 'Backend Engineer, Software Engineer',
      summary: 'Backend engineer with 6 years of experience in Node.js and distributed systems.'
    },
    items: [],
    facts: [],
    jobs: [],
    apps: [],
    qa: [],
    blacklist: [],
    settings: { ...defaultSettings },
    excludedFacts: [],
    usage: [],
    seq: 1
  }
  const add = <K extends ItemKind>(kind: K, data: ItemDataMap[K]) => {
    const item: ProfileItem = { id: s.seq++, kind, data, sort: s.items.length }
    s.items.push(item)
    for (const t of itemToFacts(item)) s.facts.push({ id: s.seq++, text: t, source: 'profile', itemId: item.id, createdAt: now() })
  }
  add('experience', {
    company: 'Acme Payments',
    title: 'Senior Software Engineer',
    location: 'Austin, TX',
    start: '03/2021',
    end: '',
    description: 'Node.js and TypeScript APIs\nMessaging with Kafka\nAWS infrastructure with Terraform',
    achievements: 'Cut checkout p95 latency by 40%\nLed the migration from a monolith to microservices'
  })
  add('skill', { name: 'TypeScript', level: 'advanced', years: '6' })
  add('skill', { name: 'PostgreSQL', level: 'advanced', years: '5' })
  add('language', { name: 'English', level: 'native' })
  add('language', { name: 'Spanish', level: 'intermediate' })
  s.jobs.push({
    id: s.seq++,
    url: 'https://www.linkedin.com/jobs/view/123/',
    linkedinId: '123',
    title: 'Senior Backend Engineer',
    company: 'Example Corp',
    location: 'Remote',
    description:
      'We are looking for a senior backend engineer.\n\nRequirements:\n- Node.js and TypeScript\n- PostgreSQL\n- Kafka\n- Kubernetes\n- AWS\n\nNice to have:\n- Go\n- Payments experience',
    easyApply: true,
    status: 'captured',
    requirements: null,
    match: null,
    createdAt: now()
  })
  return s
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Store>
      return { ...seed(), ...stored, excludedFacts: stored.excludedFacts ?? [], usage: stored.usage ?? [], blacklist: stored.blacklist ?? [] } as Store
    }
  } catch {
    /* no storage: start fresh */
  }
  return seed()
}

const db = load()
const listeners = new Set<(e: AppEvent) => void>()
function persist(...events: AppEvent['type'][]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* ignore */
  }
  for (const type of events) for (const l of listeners) l({ type } as AppEvent)
}
const nextId = () => db.seq++

function syncFacts(item: ProfileItem) {
  db.facts = db.facts.filter((f) => f.itemId !== item.id)
  for (const t of itemToFacts(item)) if (!db.excludedFacts.includes(t.trim().toLowerCase())) db.facts.push({ id: nextId(), text: t, source: 'profile', itemId: item.id, createdAt: now() })
}

/** Same rule as the Electron app: deleted profile facts are excluded so they do not come back. */
function deleteFacts(ids: number[]): number {
  const set = new Set(ids)
  const gone = db.facts.filter((f) => set.has(f.id))
  for (const f of gone) if (f.source === 'profile') db.excludedFacts.push(f.text.trim().toLowerCase())
  db.facts = db.facts.filter((f) => !set.has(f.id))
  persist('facts-changed')
  return gone.length
}

function addFact(text: string, source: FactSource): Fact {
  const f: Fact = { id: nextId(), text, source, itemId: null, createdAt: now() }
  db.facts.push(f)
  return f
}

// ---------- mocked log (Console page) ----------
const mockLogs: LogEntry[] = []
function mockLog(level: LogLevel, source: LogSource, message: string, detail = '') {
  const entry: LogEntry = { id: mockLogs.length + 1, ts: new Date().toISOString(), level, source, message, detail }
  mockLogs.push(entry)
  for (const l of listeners) l({ type: 'log', entry })
}

// ---------- mocked usage log (mock AI calls are free: billing 'local') ----------
function mockUsage(operation: AiOperation, inputTokens: number, outputTokens: number) {
  mockLog('info', 'ai', `${operation}: mock AI call (${inputTokens} in / ${outputTokens} out tokens, free)`)
  db.usage.unshift({
    id: nextId(),
    createdAt: now(),
    provider: 'mock',
    model: 'mock-ai',
    operation,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    billing: 'local',
    ok: true,
    error: ''
  })
  db.usage = db.usage.slice(0, 500)
}

function mockSummary(): UsageSummary {
  const d = new Date()
  const iso = (x: Date) => x.toISOString().replace('T', ' ').slice(0, 19)
  const today = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
  const month = iso(new Date(d.getFullYear(), d.getMonth(), 1))
  const sum = (rows: UsageRecord[]): UsageTotals => ({
    calls: rows.length,
    apiUsd: rows.filter((r) => r.billing === 'api').reduce((a, r) => a + (r.costUsd ?? 0), 0),
    subscriptionUsd: rows.filter((r) => r.billing === 'subscription').reduce((a, r) => a + (r.costUsd ?? 0), 0),
    inputTokens: rows.reduce((a, r) => a + r.inputTokens, 0),
    outputTokens: rows.reduce((a, r) => a + r.outputTokens, 0)
  })
  const inMonth = db.usage.filter((r) => r.createdAt >= month)
  const group = (key: 'operation' | 'model') =>
    [...new Set(inMonth.map((r) => r[key]))].map((k) => {
      const rows = inMonth.filter((r) => r[key] === k)
      return { key: k, billing: rows[0].billing, ...sum(rows) }
    })
  const b = db.settings.budget ?? defaultSettings.budget
  const m = sum(inMonth)
  const t = sum(db.usage.filter((r) => r.createdAt >= today))
  const counted = (x: UsageTotals) => x.apiUsd + (b.includeSubscription ? x.subscriptionUsd : 0)
  return {
    today: t,
    month: m,
    byOperation: group('operation'),
    byModel: group('model'),
    budget: { ...b, monthSpent: counted(m), todaySpent: counted(t), blocked: null },
    unknownPriceModels: [],
    prices: { 'claude-opus-5-5': { input: 4, output: 20 }, 'claude-sonnet-5-5': { input: 2, output: 10 }, ...(db.settings.prices ?? {}) }
  }
}

// ---------- mocked "AI" ----------
function fakeAnalyze(job: Job): Job {
  const lines = job.description.split('\n').map((l) => l.replace(/^[-•*\s]+/, '').trim())
  const reqStart = lines.findIndex((l) => /requisitos|requirements/i.test(l))
  const niceStart = lines.findIndex((l) => /diferenciais|nice to have|desej/i.test(l))
  const pick = (from: number, to: number) => (from < 0 ? [] : lines.slice(from + 1, to < 0 ? undefined : to).filter(Boolean))
  const mustHave = pick(reqStart, niceStart > reqStart ? niceStart : -1).slice(0, 10)
  const niceToHave = pick(niceStart, -1).slice(0, 6)
  const corpus = db.facts.map((f) => f.text.toLowerCase()).join(' ')
  const has = (req: string) => req.toLowerCase().split(/[\s,/]+|\band\b|\be\b/).some((w) => w.length > 2 && corpus.includes(w))
  const matched = mustHave.filter(has)
  const gaps = mustHave.filter((r) => !has(r)).map((r) => `Do you have experience with ${r}?`)
  const score = mustHave.length ? Math.round((matched.length / mustHave.length) * 100) : 50
  const match: MatchResult = {
    score,
    summary: `[mock] ${matched.length} of ${mustHave.length} required qualifications have evidence in your knowledge base.`,
    matched: matched.map((m) => `${m} (found in knowledge base)`),
    gaps
  }
  return {
    ...job,
    status: job.status === 'captured' || job.status === 'lead' ? 'analyzed' : job.status,
    requirements: {
      title: job.title,
      company: job.company,
      seniority: /s[eê]nior|senior/i.test(job.title) ? 'senior' : '',
      location: job.location,
      workModel: /remot/i.test(job.location + job.description) ? 'remote' : '',
      language: /\b(você|vaga|requisitos|experiência|para)\b/i.test(job.description) ? 'pt' : 'en',
      mustHave,
      niceToHave,
      keywords: [...mustHave, ...niceToHave].flatMap((r) => r.split(/\s+(?:and|e)\s+|,\s*/)).slice(0, 12),
      responsibilities: []
    },
    match
  }
}

function fakeResume(lang: 'pt' | 'en'): ResumeDoc {
  const p = db.profile
  const of = <K extends ItemKind>(k: K) => db.items.filter((i) => i.kind === k).map((i) => i.data as ItemDataMap[K])
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  return {
    lang,
    name: p.fullName,
    headline: p.headline,
    contact: [p.email, p.phone, p.location, p.linkedin, p.github].filter(Boolean),
    summary: p.summary,
    skills: of('skill').map((s) => s.name),
    experiences: of('experience').map((e) => ({
      company: e.company,
      title: e.title,
      location: e.location,
      period: `${e.start} – ${e.end || (lang === 'pt' ? 'atual' : 'present')}`,
      bullets: [...lines(e.achievements), ...lines(e.description)].slice(0, 5)
    })),
    education: of('education').map((e) => ({ institution: e.institution, degree: `${e.degree} ${e.field}`.trim(), period: `${e.start} – ${e.end}` })),
    projects: of('project').map((x) => ({ name: x.name, description: x.description })),
    certifications: of('certification').map((c) => c.name),
    languages: of('language').map((l) => `${l.name} (${l.level})`)
  }
}

function fakeLetter(job: Job, lang: 'pt' | 'en'): CoverLetterDoc {
  const facts = db.facts.slice(0, 2).map((f) => f.text).join('; ')
  if (lang === 'pt')
    return {
      lang,
      greeting: `Olá, equipe ${job.company || 'de recrutamento'},`,
      paragraphs: [`[simulado] Gostaria de me candidatar à vaga de ${job.title}.`, `Minha experiência recente inclui: ${facts}.`, 'Ficaria feliz em conversar.'],
      closing: 'Atenciosamente,',
      signature: db.profile.fullName
    }
  return {
    lang,
    greeting: `Dear ${job.company || 'hiring'} team,`,
    paragraphs: [
      `[mock] I would like to apply for the ${job.title} position.`,
      `My recent experience includes: ${facts}.`,
      'I would be glad to talk about how I can contribute to the team.'
    ],
    closing: 'Best regards,',
    signature: db.profile.fullName
  }
}

function ensureApp(jobId: number): Application {
  let a = db.apps.find((x) => x.jobId === jobId)
  if (!a) {
    a = { id: nextId(), jobId, resume: null, coverLetter: null, status: 'draft', notes: '', appliedAt: null, updatedAt: now(), archivedAt: null }
    db.apps.push(a)
  }
  return a
}

function download(name: string, html: string): string {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return `${name} (browser download — real PDF/DOCX only in Electron)`
}

const jobOrThrow = (id: number) => {
  const j = db.jobs.find((x) => x.id === id)
  if (!j) throw new Error('Job not found')
  return j
}
const defaultLang = () => db.settings.defaultLang ?? 'en'
const header = (jobId: number, lang: 'pt' | 'en' = 'en') => ({
  name: db.profile.fullName,
  contact: [db.profile.email, db.profile.location].filter(Boolean),
  company: db.jobs.find((j) => j.id === jobId)?.company ?? '',
  date: new Date().toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
})

export function createMockApi(): Api {
  return {
    profile: {
      async get() {
        return clone(db.profile)
      },
      async save(p) {
        db.profile = clone(p)
        persist()
      },
      async listItems(kind) {
        return clone(db.items.filter((i) => i.kind === kind))
      },
      async saveItem(kind, data, id) {
        let item = id ? db.items.find((i) => i.id === id) : undefined
        if (item) item.data = clone(data)
        else {
          item = { id: nextId(), kind, data: clone(data), sort: db.items.length }
          db.items.push(item)
        }
        syncFacts(item)
        persist('facts-changed')
        return clone(item)
      },
      async deleteItem(id) {
        db.items = db.items.filter((i) => i.id !== id)
        db.facts = db.facts.filter((f) => f.itemId !== id)
        persist('facts-changed')
      },
      async importResume() {
        const file = await pickFile('.pdf,.docx,.txt,.md')
        if (!file) return null
        const text = (await extractTextInBrowser(file)).trim()
        if (!text) throw new Error('Could not extract text from the file (is it a scanned image PDF?).')
        const data = parseResumeText(text)

        // Same rule as the Electron app: only fill empty profile fields and never duplicate items
        for (const [k, v] of Object.entries(data.profile) as [keyof typeof data.profile, string][]) {
          if (!db.profile[k] && v) db.profile[k] = v
        }
        let imported = 0
        const add = <K extends ItemKind>(kind: K, list: ItemDataMap[K][], keyOf: (d: ItemDataMap[K]) => string) => {
          const existing = new Set(db.items.filter((i) => i.kind === kind).map((i) => keyOf(i.data as ItemDataMap[K]).toLowerCase()))
          for (const d of list) {
            const key = keyOf(d).toLowerCase()
            if (!key.replace(/\|/g, '').trim() || existing.has(key)) continue
            const item: ProfileItem = { id: nextId(), kind, data: d, sort: db.items.length }
            db.items.push(item)
            syncFacts(item)
            existing.add(key)
            imported++
          }
        }
        add('experience', data.experiences, (d) => `${d.company}|${d.title}|${d.start}`)
        add('education', data.education, (d) => `${d.institution}|${d.degree}`)
        add('skill', data.skills, (d) => d.name)
        add('project', data.projects, (d) => d.name)
        add('certification', data.certifications, (d) => d.name)
        add('language', data.languages, (d) => d.name)
        persist('facts-changed')
        return { imported }
      }
    },
    facts: {
      async list() {
        return clone([...db.facts].reverse())
      },
      async add(text, source = 'manual') {
        const f = addFact(text.trim(), source)
        persist('facts-changed')
        return clone(f)
      },
      async update(id, text) {
        const f = db.facts.find((x) => x.id === id)
        if (f) f.text = text
        persist('facts-changed')
      },
      async delete(id) {
        deleteFacts([id])
      },
      async deleteMany(ids) {
        return { deleted: deleteFacts(ids) }
      },
      async reindex() {
        await delay()
        return { indexed: db.facts.length }
      }
    },
    jobs: {
      async list() {
        return clone([...db.jobs].reverse())
      },
      async get(id) {
        return clone(db.jobs.find((j) => j.id === id) ?? null)
      },
      async addManual(input) {
        const job: Job = {
          id: nextId(),
          ...input,
          linkedinId: input.url.match(/\/jobs\/view\/(\d+)/)?.[1] ?? null,
          location: '',
          easyApply: false,
          status: 'captured',
          requirements: null,
          match: null,
          createdAt: now()
        }
        db.jobs.push(job)
        persist('jobs-changed')
        return clone(job)
      },
      async setStatus(id, status) {
        jobOrThrow(id).status = status
        persist('jobs-changed')
      },
      async delete(id) {
        db.jobs = db.jobs.filter((j) => j.id !== id)
        db.apps = db.apps.filter((a) => a.jobId !== id)
        persist('jobs-changed', 'applications-changed')
      },
      async analyze(id) {
        await delay(600)
        const idx = db.jobs.findIndex((j) => j.id === id)
        if (idx < 0) throw new Error('Job not found')
        db.jobs[idx] = fakeAnalyze(db.jobs[idx])
        mockUsage('analyze-job', 2400, 600)
        persist('jobs-changed', 'usage-changed')
        return clone(db.jobs[idx])
      },
      async answerGap(_jobId, gap, answer) {
        const f = addFact(`${gap.replace(/^Do you have experience with /, 'Experience with ').replace(/\?$/, '')}: ${answer}`, 'gap-answer')
        persist('facts-changed')
        return clone(f)
      }
    },
    docs: {
      async generateResume(jobId, lang) {
        await delay(800)
        const job = jobOrThrow(jobId)
        if (!job.requirements) Object.assign(job, fakeAnalyze(job))
        const a = ensureApp(jobId)
        a.resume = fakeResume(lang ?? defaultLang())
        mockUsage('resume', 3800, 1500)
        a.updatedAt = now()
        persist('applications-changed', 'jobs-changed', 'usage-changed')
        return clone(a)
      },
      async generateCoverLetter(jobId, lang) {
        await delay(800)
        const a = ensureApp(jobId)
        a.coverLetter = fakeLetter(jobOrThrow(jobId), lang ?? defaultLang())
        mockUsage('cover-letter', 3000, 700)
        a.updatedAt = now()
        persist('applications-changed', 'usage-changed')
        return clone(a)
      },
      async saveApplication(app) {
        const a = db.apps.find((x) => x.id === app.id)
        if (a) Object.assign(a, clone({ resume: app.resume, coverLetter: app.coverLetter, notes: app.notes }), { updatedAt: now() })
        persist('applications-changed')
      },
      async exportResume(appId) {
        const a = db.apps.find((x) => x.id === appId)
        if (!a?.resume) throw new Error('Generate the resume before exporting.')
        return download('resume.html', resumeHtml(a.resume))
      },
      async exportCoverLetter(appId) {
        const a = db.apps.find((x) => x.id === appId)
        if (!a?.coverLetter) throw new Error('Generate the cover letter before exporting.')
        return download('cover-letter.html', coverLetterHtml(a.coverLetter, header(a.jobId, a.coverLetter.lang)))
      },
      async previewResumeHtml(resume) {
        return resumeHtml(resume)
      },
      async previewCoverLetterHtml(letter, jobId) {
        return coverLetterHtml(letter, header(jobId, letter.lang))
      },
      async learnFromEdits(appId) {
        const a = db.apps.find((x) => x.id === appId)
        let added = 0
        for (const e of a?.resume?.experiences ?? [])
          for (const b of e.bullets) {
            const text = `${e.title} at ${e.company}: ${b}`
            if (!db.facts.some((f) => f.text.toLowerCase() === text.toLowerCase() || f.text.includes(b))) {
              addFact(text, 'editor')
              added++
            }
          }
        persist('facts-changed')
        return { added }
      }
    },
    applications: {
      async list() {
        return clone(
          db.apps
            .map((a) => {
              const j = db.jobs.find((x) => x.id === a.jobId)
              return j ? { ...a, job: { id: j.id, title: j.title, company: j.company, url: j.url } } : null
            })
            .filter((x): x is NonNullable<typeof x> => !!x)
        )
      },
      async getByJob(jobId) {
        return clone(db.apps.find((a) => a.jobId === jobId) ?? null)
      },
      async setStatus(id, status) {
        const a = db.apps.find((x) => x.id === id)
        if (!a) return
        a.status = status
        if (status === 'applied') {
          a.appliedAt ??= now()
          const j = db.jobs.find((x) => x.id === a.jobId)
          if (j) j.status = 'applied'
        }
        persist('applications-changed', 'jobs-changed')
      },
      async setArchived(id, archived) {
        const a = db.apps.find((x) => x.id === id)
        if (!a) return
        a.archivedAt = archived ? now() : null
        persist('applications-changed')
      }
    },
    blacklist: {
      async list() {
        return clone(db.blacklist)
      },
      async add(e) {
        const label = e.label.trim()
        const value = normalizeBlacklistValue(e.kind, label)
        if (!value) throw new Error('Type a company, job URL, keyword or profile URL.')
        let entry = db.blacklist.find((x) => x.kind === e.kind && x.value === value)
        if (entry) entry.reason = e.reason?.trim() || entry.reason
        else {
          entry = { id: db.seq++, kind: e.kind, value, label, reason: e.reason?.trim() ?? '', jobId: e.jobId ?? null, source: 'candidate', createdAt: now() }
          db.blacklist.unshift(entry)
        }
        persist('blacklist-changed')
        return clone(entry)
      },
      async delete(id) {
        db.blacklist = db.blacklist.filter((x) => x.id !== id)
        persist('blacklist-changed')
      }
    },
    qa: {
      async list() {
        return clone(db.qa)
      },
      async save(question, answer) {
        const q = db.qa.find((x) => x.question === question)
        if (q) Object.assign(q, { answer, updatedAt: now() })
        else db.qa.push({ id: nextId(), question, answer, updatedAt: now() })
        persist('facts-changed')
      },
      async delete(id) {
        db.qa = db.qa.filter((x) => x.id !== id)
        persist('facts-changed')
      }
    },
    linkedin: {
      async open(url = 'https://www.linkedin.com/jobs/') {
        window.open(url, '_blank', 'noopener')
      },
      async search(q) {
        const p = new URLSearchParams({ keywords: q.keywords, location: q.location })
        if (q.remote) p.set('f_WT', '2')
        if (q.easyApplyOnly) p.set('f_AL', 'true')
        window.open(`https://www.linkedin.com/jobs/search/?${p}`, '_blank', 'noopener')
      },
      async openJob(jobId) {
        window.open(jobOrThrow(jobId).url, '_blank', 'noopener')
      },
      async openJobExternal(jobId) {
        window.open(jobOrThrow(jobId).url, '_blank', 'noopener')
      }
    },
    settings: {
      async resetAll(confirmation) {
        if (confirmation !== 'RESET') throw new Error('Reset not confirmed.')
        // Wipe everything (no sample data) — resetMock() in the console restores the sample data
        Object.assign(db, {
          profile: { ...emptyProfile },
          items: [],
          facts: [],
          jobs: [],
          apps: [],
          qa: [],
          blacklist: [],
          settings: { ...defaultSettings },
          excludedFacts: [],
          usage: [],
          seq: 1
        } satisfies Store)
        persist()
      },
      // Browser mode: the backup is the mock store itself (not compatible with the desktop app's file)
      async exportData() {
        const blob = new Blob([JSON.stringify({ format: 'job-search-rag-mock-backup', store: db }, null, 1)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `job-search-backup-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(a.href)
        return a.download
      },
      async importData() {
        const file = await pickFile('.json,application/json')
        if (!file) return null
        const parsed = JSON.parse(await file.text()) as { format?: string; store?: Partial<Store> }
        if (parsed.format !== 'job-search-rag-mock-backup' || !parsed.store) throw new Error('This file is not a browser-mode backup.')
        Object.assign(db, { ...seed(), ...parsed.store })
        persist('jobs-changed', 'applications-changed', 'facts-changed', 'blacklist-changed', 'usage-changed')
        return { jobs: db.jobs.length, applications: db.apps.length, facts: db.facts.length }
      },
      async get() {
        return { ...clone(db.settings), hasKey: { claude: false, openai: false } }
      },
      async save(s) {
        db.settings = clone(s)
        persist()
      },
      async update(patch) {
        db.settings = { ...db.settings, ...clone(patch) }
        persist()
      },
      async setKey() {
        /* keys are never stored in browser mode */
      },
      async cliStatus() {
        return { found: false, loggedIn: false, authMethod: '', subscriptionType: '', version: '', error: 'Browser mode: the Claude CLI is only available in the Electron app.' }
      },
      async testChat() {
        await delay()
        mockUsage('test', 20, 10)
        persist('usage-changed')
        return '[browser mode] Mock AI — no real call was made.'
      }
    },
    // The agent needs Claude Code + a real browser: not available in browser mode
    agent: {
      async start() {
        throw new Error('The background agent only runs in the desktop app (npm run dev).')
      },
      async stop() {},
      async state() {
        return { run: null, questions: [], events: [] }
      },
      async answer() {},
      async checkBrowser() {
        return { ok: false, detail: 'Not available in browser mode.' }
      }
    },
    outreach: {
      async list() {
        return []
      },
      async delete() {}
    },
    logs: {
      async list() {
        return clone(mockLogs)
      },
      async clear() {
        mockLogs.length = 0
      },
      async filePath() {
        return null
      }
    },
    usage: {
      async summary() {
        return mockSummary()
      },
      async recent(limit = 50) {
        return clone(db.usage.slice(0, limit))
      },
      async clear() {
        db.usage = []
        persist('usage-changed')
      }
    },
    onEvent(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}

/** Clears the mock data and reloads the page (available in the console: resetMock()). */
export function resetMock(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  location.reload()
}
