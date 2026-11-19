import { getDb } from './client'
import { normalizeBlacklistValue } from '../agent/blacklist'
import { normalizeJobUrl, normalizeProfileUrl } from '../agent/history'
import {
  emptyProfile,
  type Application,
  type ApplicationStatus,
  type CapturedJob,
  type Fact,
  type FactSource,
  type ItemDataMap,
  type ItemKind,
  type Job,
  type JobStatus,
  type Outreach,
  type OutreachChannel,
  type OutreachStatus,
  type Profile,
  type ProfileItem,
  type QaEntry,
  type BlacklistEntry,
  type BlacklistInput,
  type BlacklistKind
} from '@shared/types'

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null)

// ---------- kv ----------
export const kv = {
  get<T>(key: string): T | null {
    const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : null
  },
  set(key: string, value: unknown): void {
    getDb()
      .prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }
}

// ---------- profile ----------
export const profileRepo = {
  get(): Profile {
    return { ...emptyProfile, ...(kv.get<Profile>('profile') ?? {}) }
  },
  save(p: Profile): void {
    kv.set('profile', p)
  },
  listItems(kind?: ItemKind): ProfileItem[] {
    const rows = (
      kind
        ? getDb().prepare('SELECT * FROM profile_items WHERE kind = ? ORDER BY sort, id').all(kind)
        : getDb().prepare('SELECT * FROM profile_items ORDER BY kind, sort, id').all()
    ) as { id: number; kind: ItemKind; data: string; sort: number }[]
    return rows.map((r) => ({ id: r.id, kind: r.kind, sort: r.sort, data: JSON.parse(r.data) }))
  },
  getItem(id: number): ProfileItem | null {
    const r = getDb().prepare('SELECT * FROM profile_items WHERE id = ?').get(id) as
      | { id: number; kind: ItemKind; data: string; sort: number }
      | undefined
    return r ? { id: r.id, kind: r.kind, sort: r.sort, data: JSON.parse(r.data) } : null
  },
  saveItem<K extends ItemKind>(kind: K, data: ItemDataMap[K], id?: number): ProfileItem<K> {
    const db = getDb()
    if (id) {
      db.prepare('UPDATE profile_items SET data = ? WHERE id = ?').run(JSON.stringify(data), id)
      return profileRepo.getItem(id) as ProfileItem<K>
    }
    const info = db
      .prepare('INSERT INTO profile_items(kind, data, sort) VALUES(?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM profile_items WHERE kind = ?))')
      .run(kind, JSON.stringify(data), kind)
    return profileRepo.getItem(Number(info.lastInsertRowid)) as ProfileItem<K>
  },
  deleteItem(id: number): void {
    getDb().prepare('DELETE FROM profile_items WHERE id = ?').run(id)
  }
}

// ---------- facts ----------
type FactRow = { id: number; text: string; source: FactSource; item_id: number | null; created_at: string }
const toFact = (r: FactRow): Fact => ({ id: r.id, text: r.text, source: r.source, itemId: r.item_id, createdAt: r.created_at })

export const factsRepo = {
  list(): Fact[] {
    return (getDb().prepare('SELECT * FROM facts ORDER BY id DESC').all() as FactRow[]).map(toFact)
  },
  byIds(ids: number[]): Fact[] {
    if (!ids.length) return []
    const rows = getDb()
      .prepare(`SELECT * FROM facts WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as FactRow[]
    return rows.map(toFact)
  },
  add(text: string, source: FactSource, itemId: number | null = null): Fact {
    const info = getDb().prepare('INSERT INTO facts(text, source, item_id) VALUES(?, ?, ?)').run(text, source, itemId)
    return toFact(getDb().prepare('SELECT * FROM facts WHERE id = ?').get(info.lastInsertRowid) as FactRow)
  },
  update(id: number, text: string): void {
    const db = getDb()
    db.prepare('UPDATE facts SET text = ? WHERE id = ?').run(text, id)
    db.prepare('DELETE FROM embeddings WHERE fact_id = ?').run(id)
  },
  /**
   * Deletes facts. Profile-derived facts are also remembered as excluded, so they do not
   * come back when the profile item is saved again or the knowledge base is reindexed.
   */
  deleteMany(ids: number[]): number {
    const db = getDb()
    const facts = factsRepo.byIds(ids)
    const excluded = new Set(kv.get<string[]>('excludedFacts') ?? [])
    const tx = db.transaction(() => {
      for (const f of facts) {
        if (f.source === 'profile') excluded.add(f.text.trim().toLowerCase())
        db.prepare('DELETE FROM facts WHERE id = ?').run(f.id)
      }
      kv.set('excludedFacts', [...excluded])
    })
    tx()
    return facts.length
  },
  delete(id: number): void {
    factsRepo.deleteMany([id])
  },
  isExcluded(text: string): boolean {
    return (kv.get<string[]>('excludedFacts') ?? []).includes(text.trim().toLowerCase())
  },
  deleteByItem(itemId: number): void {
    getDb().prepare('DELETE FROM facts WHERE item_id = ?').run(itemId)
  },
  exists(text: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM facts WHERE lower(text) = lower(?)').get(text.trim())
  }
}

// ---------- embeddings ----------
export const embeddingsRepo = {
  missing(model: string): Fact[] {
    const rows = getDb()
      .prepare(
        `SELECT f.* FROM facts f LEFT JOIN embeddings e ON e.fact_id = f.id
         WHERE e.fact_id IS NULL OR e.model != ?`
      )
      .all(model) as FactRow[]
    return rows.map(toFact)
  },
  upsert(factId: number, model: string, vec: Float32Array): void {
    getDb()
      .prepare(
        `INSERT INTO embeddings(fact_id, model, dim, vector) VALUES(?, ?, ?, ?)
         ON CONFLICT(fact_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector`
      )
      .run(factId, model, vec.length, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength))
  },
  all(model: string): { factId: number; vector: Float32Array }[] {
    const rows = getDb().prepare('SELECT fact_id, vector FROM embeddings WHERE model = ?').all(model) as {
      fact_id: number
      vector: Buffer
    }[]
    return rows.map((r) => ({
      factId: r.fact_id,
      vector: new Float32Array(r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.vector.byteLength))
    }))
  }
}

// ---------- jobs ----------
type JobRow = {
  id: number
  url: string
  linkedin_id: string | null
  title: string
  company: string
  location: string
  description: string
  easy_apply: number
  status: JobStatus
  requirements: string | null
  match: string | null
  created_at: string
}
const toJob = (r: JobRow): Job => ({
  id: r.id,
  url: r.url,
  linkedinId: r.linkedin_id,
  title: r.title,
  company: r.company,
  location: r.location,
  description: r.description,
  easyApply: !!r.easy_apply,
  status: r.status,
  requirements: parse(r.requirements),
  match: parse(r.match),
  createdAt: r.created_at
})

export const jobsRepo = {
  list(): Job[] {
    return (getDb().prepare('SELECT * FROM jobs ORDER BY id DESC').all() as JobRow[]).map(toJob)
  },
  get(id: number): Job | null {
    const r = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    return r ? toJob(r) : null
  },
  byLinkedinId(lid: string): Job | null {
    const r = getDb().prepare('SELECT * FROM jobs WHERE linkedin_id = ?').get(lid) as JobRow | undefined
    return r ? toJob(r) : null
  },
  /** Job saved under the same URL (ignoring query string, hash, trailing slash and http/https). */
  byUrl(url: string): Job | null {
    const key = normalizeJobUrl(url)
    if (!key) return null
    const rows = getDb().prepare('SELECT * FROM jobs WHERE linkedin_id IS NULL').all() as JobRow[]
    const r = rows.find((row) => normalizeJobUrl(row.url) === key)
    return r ? toJob(r) : null
  },
  /** Insert or update (by LinkedIn ID, or by URL for other sites). Never downgrades the status of already-analyzed jobs. */
  upsertCaptured(c: CapturedJob, status: JobStatus = 'captured'): Job {
    const db = getDb()
    const existing = c.linkedinId ? jobsRepo.byLinkedinId(c.linkedinId) : jobsRepo.byUrl(c.url)
    if (existing) {
      const descriptionChanged = !!c.description && c.description !== existing.description
      db.prepare(
        `UPDATE jobs SET url = ?, title = COALESCE(NULLIF(?, ''), title), company = COALESCE(NULLIF(?, ''), company),
         location = COALESCE(NULLIF(?, ''), location), description = COALESCE(NULLIF(?, ''), description),
         easy_apply = MAX(easy_apply, ?), status = CASE WHEN status = 'lead' THEN ? ELSE status END
         WHERE id = ?`
      ).run(c.url, c.title, c.company, c.location, c.description, c.easyApply ? 1 : 0, status, existing.id)
      if (descriptionChanged && existing.status !== 'lead') {
        db.prepare("UPDATE jobs SET requirements = NULL, match = NULL, status = 'captured' WHERE id = ? AND status = 'analyzed'").run(existing.id)
      }
      return jobsRepo.get(existing.id)!
    }
    const info = db
      .prepare(
        `INSERT INTO jobs(url, linkedin_id, title, company, location, description, easy_apply, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(c.url, c.linkedinId, c.title, c.company, c.location, c.description, c.easyApply ? 1 : 0, status)
    return jobsRepo.get(Number(info.lastInsertRowid))!
  },
  setStatus(id: number, status: JobStatus): void {
    getDb().prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id)
  },
  setAnalysis(id: number, requirements: unknown, match: unknown): void {
    getDb()
      .prepare("UPDATE jobs SET requirements = ?, match = ?, status = CASE WHEN status IN ('lead','captured') THEN 'analyzed' ELSE status END WHERE id = ?")
      .run(JSON.stringify(requirements), JSON.stringify(match), id)
  },
  delete(id: number): void {
    getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id)
  }
}

// ---------- applications ----------
type AppRow = {
  id: number
  job_id: number
  resume: string | null
  cover_letter: string | null
  status: ApplicationStatus
  notes: string
  applied_at: string | null
  updated_at: string
  archived_at: string | null
}
const toApp = (r: AppRow): Application => ({
  id: r.id,
  jobId: r.job_id,
  resume: parse(r.resume),
  coverLetter: parse(r.cover_letter),
  status: r.status,
  notes: r.notes,
  appliedAt: r.applied_at,
  updatedAt: r.updated_at,
  archivedAt: r.archived_at ?? null
})

export const applicationsRepo = {
  list(): (Application & { job: Pick<Job, 'id' | 'title' | 'company' | 'url'> })[] {
    const rows = getDb()
      .prepare(
        `SELECT a.*, j.title AS j_title, j.company AS j_company, j.url AS j_url FROM applications a
         JOIN jobs j ON j.id = a.job_id ORDER BY a.updated_at DESC`
      )
      .all() as (AppRow & { j_title: string; j_company: string; j_url: string })[]
    return rows.map((r) => ({ ...toApp(r), job: { id: r.job_id, title: r.j_title, company: r.j_company, url: r.j_url } }))
  },
  get(id: number): Application | null {
    const r = getDb().prepare('SELECT * FROM applications WHERE id = ?').get(id) as AppRow | undefined
    return r ? toApp(r) : null
  },
  getByJob(jobId: number): Application | null {
    const r = getDb().prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId) as AppRow | undefined
    return r ? toApp(r) : null
  },
  ensure(jobId: number): Application {
    getDb().prepare('INSERT OR IGNORE INTO applications(job_id) VALUES(?)').run(jobId)
    return applicationsRepo.getByJob(jobId)!
  },
  save(a: Pick<Application, 'id' | 'resume' | 'coverLetter' | 'notes'>): void {
    getDb()
      .prepare("UPDATE applications SET resume = ?, cover_letter = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(a.resume), JSON.stringify(a.coverLetter), a.notes, a.id)
  },
  setStatus(id: number, status: ApplicationStatus): void {
    getDb()
      .prepare(
        `UPDATE applications SET status = ?, updated_at = datetime('now'),
         applied_at = CASE WHEN ? = 'applied' AND applied_at IS NULL THEN datetime('now') ELSE applied_at END WHERE id = ?`
      )
      .run(status, status, id)
  },
  setArchived(id: number, archived: boolean): void {
    getDb()
      .prepare(`UPDATE applications SET archived_at = ${archived ? "datetime('now')" : 'NULL'}, updated_at = datetime('now') WHERE id = ?`)
      .run(id)
  }
}

// ---------- question memory ----------
export const normalizeQuestion = (q: string): string =>
  q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*?:]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export const qaRepo = {
  list(): QaEntry[] {
    return (getDb().prepare('SELECT * FROM qa_memory ORDER BY updated_at DESC').all() as {
      id: number
      question: string
      answer: string
      updated_at: string
    }[]).map((r) => ({ id: r.id, question: r.question, answer: r.answer, updatedAt: r.updated_at }))
  },
  find(question: string): string | null {
    const r = getDb().prepare('SELECT answer FROM qa_memory WHERE question = ?').get(normalizeQuestion(question)) as
      | { answer: string }
      | undefined
    return r?.answer ?? null
  },
  save(question: string, answer: string): void {
    getDb()
      .prepare(
        `INSERT INTO qa_memory(question, answer) VALUES(?, ?)
         ON CONFLICT(question) DO UPDATE SET answer = excluded.answer, updated_at = datetime('now')`
      )
      .run(normalizeQuestion(question), answer)
  },
  delete(id: number): void {
    getDb().prepare('DELETE FROM qa_memory WHERE id = ?').run(id)
  }
}

// ---------- outreach (messages sent to recruiters / hiring managers) ----------
type OutreachRow = {
  id: number
  job_id: number | null
  name: string
  profile_url: string
  role: string
  channel: OutreachChannel
  message: string
  status: OutreachStatus
  notes: string
  created_at: string
  j_title?: string | null
  j_company?: string | null
}

/** LinkedIn profile URLs compare by their /in/<slug> part (query strings, trailing slashes and host vary). */
export { normalizeProfileUrl }

const toOutreach = (r: OutreachRow): Outreach => ({
  id: r.id,
  jobId: r.job_id,
  name: r.name,
  profileUrl: r.profile_url,
  role: r.role,
  channel: r.channel,
  message: r.message,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
  job: r.job_id && r.j_title != null ? { id: r.job_id, title: r.j_title ?? '', company: r.j_company ?? '' } : null
})

export const outreachRepo = {
  list(filter: { jobId?: number; profileUrl?: string } = {}): Outreach[] {
    const where: string[] = []
    const args: unknown[] = []
    if (filter.jobId) {
      where.push('o.job_id = ?')
      args.push(filter.jobId)
    }
    if (filter.profileUrl) {
      where.push('o.profile_url = ?')
      args.push(normalizeProfileUrl(filter.profileUrl))
    }
    const rows = getDb()
      .prepare(
        `SELECT o.*, j.title AS j_title, j.company AS j_company FROM outreach o LEFT JOIN jobs j ON j.id = o.job_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC`
      )
      .all(...args) as OutreachRow[]
    return rows.map(toOutreach)
  },
  add(o: Omit<Outreach, 'id' | 'createdAt' | 'job'>): Outreach {
    const info = getDb()
      .prepare('INSERT INTO outreach(job_id, name, profile_url, role, channel, message, status, notes) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
      .run(o.jobId, o.name, normalizeProfileUrl(o.profileUrl), o.role, o.channel, o.message, o.status, o.notes)
    return outreachRepo.list().find((x) => x.id === Number(info.lastInsertRowid))!
  },
  delete(id: number): void {
    getDb().prepare('DELETE FROM outreach WHERE id = ?').run(id)
  }
}

// ---------- blacklist ----------
type BlacklistRow = { id: number; kind: BlacklistKind; value: string; label: string; reason: string; job_id: number | null; source: string; created_at: string }
const toBlacklist = (r: BlacklistRow): BlacklistEntry => ({
  id: r.id,
  kind: r.kind,
  value: r.value,
  label: r.label,
  reason: r.reason,
  jobId: r.job_id,
  source: r.source,
  createdAt: r.created_at
})

export const blacklistRepo = {
  list(): BlacklistEntry[] {
    return (getDb().prepare('SELECT * FROM blacklist ORDER BY id DESC').all() as BlacklistRow[]).map(toBlacklist)
  },
  /** Adds (or updates the reason of) an entry. Same kind + normalized value = same entry. */
  add(e: BlacklistInput, source: 'candidate' | 'agent' = 'candidate'): BlacklistEntry {
    const label = e.label.trim()
    const value = normalizeBlacklistValue(e.kind, label)
    if (!value) throw new Error('Type a company, job URL, keyword or profile URL.')
    getDb()
      .prepare(
        `INSERT INTO blacklist(kind, value, label, reason, job_id, source) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, value) DO UPDATE SET reason = CASE WHEN excluded.reason != '' THEN excluded.reason ELSE blacklist.reason END,
         job_id = COALESCE(excluded.job_id, blacklist.job_id)`
      )
      .run(e.kind, value, label, (e.reason ?? '').trim(), e.jobId ?? null, source)
    return toBlacklist(getDb().prepare('SELECT * FROM blacklist WHERE kind = ? AND value = ?').get(e.kind, value) as BlacklistRow)
  },
  delete(id: number): void {
    getDb().prepare('DELETE FROM blacklist WHERE id = ?').run(id)
  }
}
