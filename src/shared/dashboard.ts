import { APPLICATION_STATUSES, type ApplicationListItem, type ApplicationStatus, type Job, type Outreach } from './types'

/**
 * Pure numbers for the Dashboard page (unit-tested): where the search stands today, computed from the jobs,
 * applications and outreach the app already stores.
 */

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO → Date */
export const parseTs = (s: string): Date => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`)

/** Monday 00:00 UTC of the week containing d, as YYYY-MM-DD */
export function weekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
  return m.toISOString().slice(0, 10)
}

const REPLIED: ApplicationStatus[] = ['scheduling', 'interview', 'offer', 'rejected']
const INTERVIEWING: ApplicationStatus[] = ['scheduling', 'interview', 'offer']

/** The candidate sent it: any status past draft, or an applied date */
export const isSent = (a: Pick<ApplicationListItem, 'status' | 'appliedAt'>) => a.status !== 'draft' || !!a.appliedAt

/** When it was sent (applied date, else the last update of a card moved past draft) */
const sentAt = (a: ApplicationListItem): Date | null => (a.appliedAt ? parseTs(a.appliedAt) : a.status !== 'draft' ? parseTs(a.updatedAt) : null)

export interface WeekPoint {
  week: string
  jobs: number
  applications: number
}

export interface ScoreBucket {
  /** Inclusive lower bound; the last bucket is 90–100 */
  from: number
  to: number
  applied: number
  notApplied: number
}

export interface DashboardStats {
  jobs: number
  analyzed: number
  sent: number
  replied: number
  interviewing: number
  offers: number
  rejected: number
  awaitingScheduling: number
  drafts: number
  messages: number
  /** replied / sent, 0–100 (null before the first application) */
  responseRate: number | null
  /** Average fit score of the applications sent (null if none is scored) */
  avgScoreSent: number | null
  /** Cards per board column, archived included (archived cards keep their status) */
  byStatus: { status: ApplicationStatus; label: string; count: number }[]
  /** Last `weeks` weeks, oldest first: jobs saved and applications sent */
  weekly: WeekPoint[]
  /** Analyzed jobs by fit score, split by whether the candidate applied */
  scores: ScoreBucket[]
  /** Companies with the most applications sent */
  topCompanies: { company: string; count: number }[]
}

export function dashboardStats(
  jobs: Pick<Job, 'id' | 'company' | 'status' | 'match' | 'createdAt'>[],
  apps: ApplicationListItem[],
  outreach: Pick<Outreach, 'status'>[],
  now = new Date(),
  weeks = 12
): DashboardStats {
  const appByJob = new Map(apps.map((a) => [a.jobId, a]))
  const sent = apps.filter(isSent)
  const count = (list: ApplicationStatus[]) => sent.filter((a) => list.includes(a.status)).length
  const replied = count(REPLIED)

  const thisWeek = parseTs(`${weekStart(now)} 00:00:00`)
  const weekly: WeekPoint[] = Array.from({ length: weeks }, (_, i) => ({
    week: new Date(thisWeek.getTime() - (weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
    jobs: 0,
    applications: 0
  }))
  const slot = new Map(weekly.map((w) => [w.week, w]))
  for (const j of jobs) {
    const w = slot.get(weekStart(parseTs(j.createdAt)))
    if (w) w.jobs++
  }
  for (const a of sent) {
    const at = sentAt(a)
    const w = at && slot.get(weekStart(at))
    if (w) w.applications++
  }

  const scores: ScoreBucket[] = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, applied: 0, notApplied: 0 }))
  for (const j of jobs) {
    if (j.match == null) continue
    const b = scores[Math.min(9, Math.max(0, Math.floor(j.match.score / 10)))]
    const a = appByJob.get(j.id)
    if (j.status === 'applied' || (a && isSent(a))) b.applied++
    else b.notApplied++
  }

  const scored = sent.map((a) => a.job.score).filter((s): s is number => s != null)
  const companies = new Map<string, number>()
  for (const a of sent) {
    const c = a.job.company.trim() || '(unknown)'
    companies.set(c, (companies.get(c) ?? 0) + 1)
  }

  return {
    jobs: jobs.length,
    analyzed: jobs.filter((j) => j.match != null).length,
    sent: sent.length,
    replied,
    interviewing: count(INTERVIEWING),
    offers: count(['offer']),
    rejected: count(['rejected']),
    awaitingScheduling: apps.filter((a) => a.status === 'scheduling' && !a.archivedAt).length,
    drafts: apps.filter((a) => !isSent(a)).length,
    messages: outreach.filter((o) => o.status === 'sent').length,
    responseRate: sent.length ? Math.round((replied / sent.length) * 100) : null,
    avgScoreSent: scored.length ? Math.round(scored.reduce((s, x) => s + x, 0) / scored.length) : null,
    byStatus: APPLICATION_STATUSES.map((s) => ({ status: s.id, label: s.label, count: apps.filter((a) => a.status === s.id).length })),
    weekly,
    scores,
    topCompanies: [...companies]
      .map(([company, n]) => ({ company, count: n }))
      .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company))
      .slice(0, 8)
  }
}

/** Count axis: clean integer ticks (step 1, 2, 5 × 10^n) from 0 to at least v, about 4 intervals */
export function countAxis(v: number): { max: number; ticks: number[] } {
  const raw = Math.max(1, v) / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p)
  const max = Math.max(step, Math.ceil(Math.max(1, v) / step) * step)
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) }
}
