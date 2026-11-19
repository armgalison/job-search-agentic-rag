import type { BlacklistEntry, BlacklistKind } from '@shared/types'
import { normalizeCompany, normalizeJobUrl, normalizeProfileUrl } from './history'

/**
 * Pure blacklist matching (unit-tested). Entries are stored with a normalized `value`, so "Proxify AB",
 * "proxify" and "Proxify (Remote)" are the same company, and a LinkedIn job matches with or without tracking params.
 */

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** "https://www.linkedin.com/jobs/view/123/?trk=x" and "...jobs/search/?currentJobId=123" → "linkedin:123". */
export function jobKey(url: string): string {
  const id = url.match(/\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/)?.[1] ?? url.match(/[?&]currentJobId=(\d+)/)?.[1]
  return id ? `linkedin:${id}` : normalizeJobUrl(url)
}

export function normalizeBlacklistValue(kind: BlacklistKind, label: string): string {
  switch (kind) {
    case 'company':
      return normalizeCompany(label)
    case 'job':
      return jobKey(label)
    case 'keyword':
      return fold(label)
    case 'person':
      return normalizeProfileUrl(label).toLowerCase()
  }
}

/** Keyword match on whole words ("java" does not match "javascript"), accent- and case-insensitive. */
function hasKeyword(text: string, keyword: string): boolean {
  if (!keyword) return false
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(fold(text))
}

export interface BlacklistTarget {
  jobId?: number | null
  url?: string | null
  company?: string | null
  title?: string | null
  profileUrl?: string | null
}

/** The first entry that applies to the job / company / person, or null. */
export function matchBlacklist(entries: Pick<BlacklistEntry, 'kind' | 'value' | 'jobId'>[], t: BlacklistTarget): (typeof entries)[number] | null {
  const company = t.company ? normalizeCompany(t.company) : ''
  const job = t.url ? jobKey(t.url) : ''
  const person = t.profileUrl ? normalizeProfileUrl(t.profileUrl).toLowerCase() : ''
  for (const e of entries) {
    if (e.kind === 'job' && ((job && e.value === job) || (t.jobId != null && e.jobId === t.jobId))) return e
    if (e.kind === 'company' && company && e.value === company) return e
    if (e.kind === 'keyword' && t.title && hasKeyword(t.title, e.value)) return e
    if (e.kind === 'person' && person && e.value === person) return e
  }
  return null
}

/** One line per kind for the task prompt, so every run starts knowing what the candidate ruled out. */
export function describeBlacklist(entries: Pick<BlacklistEntry, 'kind' | 'label' | 'reason'>[]): string {
  const by = (k: BlacklistKind) => entries.filter((e) => e.kind === k).map((e) => (e.reason ? `${e.label} (${e.reason})` : e.label))
  const lines = [
    ['Never apply to these companies', by('company')],
    ['Never apply to these jobs', by('job')],
    ['Skip jobs whose title contains', by('keyword')],
    ['Never contact these people', by('person')]
  ] as const
  return lines
    .filter(([, v]) => v.length)
    .map(([k, v]) => `- ${k}: ${v.slice(0, 60).join('; ')}${v.length > 60 ? ` (+${v.length - 60} more, check_jobs knows them all)` : ''}.`)
    .join('\n')
}
