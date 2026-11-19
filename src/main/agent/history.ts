import type { Application, Job } from '@shared/types'

/**
 * Pure helpers (unit-tested) that tell the agent what the candidate already did, so it never applies to the
 * same job twice, keeps away from companies it applied to recently, and never messages the same person twice.
 */

/** Any application status past 'draft' means the candidate applied (interview, offer and rejected come after applying). */
export function hasApplied(job: Pick<Job, 'status'>, app: Pick<Application, 'status' | 'appliedAt'> | null | undefined): boolean {
  return job.status === 'applied' || !!app?.appliedAt || (!!app && app.status !== 'draft')
}

const COMPANY_SUFFIXES = /\b(ltda|ltd|limited|inc|llc|corp|corporation|co|company|s\.?a|sa|gmbh|ag|kg|plc|ab|bv|nv|oy|srl|sas|spa|pty|me|eireli|group|grupo|brasil|brazil)\b\.?/g

/** "Kake, Inc." → "kake"; "4DF Connect (LWSA / Octadesk)" → "4df connect". Accents, parentheses and legal suffixes are dropped. */
export function normalizeCompany(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface PastApplication {
  job_id: number
  title: string
  status: string
  applied_at: string | null
}

/** Other jobs at the same company the candidate already applied to (a reposted job gets a new LinkedIn id). */
export function applicationsAtCompany(
  company: string,
  excludeJobId: number,
  jobs: Pick<Job, 'id' | 'title' | 'company' | 'status'>[],
  appOf: (jobId: number) => Pick<Application, 'status' | 'appliedAt'> | null
): PastApplication[] {
  const key = normalizeCompany(company)
  if (!key) return []
  return jobs
    .filter((j) => j.id !== excludeJobId && normalizeCompany(j.company) === key)
    .map((j) => ({ j, app: appOf(j.id) }))
    .filter(({ j, app }) => hasApplied(j, app))
    .map(({ j, app }) => ({ job_id: j.id, title: j.title, status: app && app.status !== 'draft' ? app.status : 'applied', applied_at: app?.appliedAt ?? null }))
}

/** "https://jobs.lever.co/acme/123/?lever-source=x#top" → "jobs.lever.co/acme/123". Query strings are kept for sites that put the job id there. */
export function normalizeJobUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    const keep = ['gh_jid', 'jobId', 'job_id', 'jid', 'id', 'currentJobId']
    const q = keep.filter((k) => u.searchParams.has(k)).map((k) => `${k}=${u.searchParams.get(k)}`)
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}${q.length ? `?${q.join('&')}` : ''}`
  } catch {
    return url.trim().toLowerCase()
  }
}

/** Any LinkedIn profile URL → "https://www.linkedin.com/in/<slug>/" (lowercase, no query string). */
export const normalizeProfileUrl = (url: string): string => {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/` : url.trim()
}
