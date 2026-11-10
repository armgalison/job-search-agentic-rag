import { profileRepo } from '../db/repos'
import type { Retrieved } from '../rag'
import type { ItemDataMap, Job } from '@shared/types'

/** Structured profile skeleton (always sent; it is short and keeps the AI from inventing companies/dates). */
export function profileSkeleton(): string {
  const p = profileRepo.get()
  const items = profileRepo.listItems()
  const out: string[] = [
    `Name: ${p.fullName}`,
    `Headline: ${p.headline}`,
    `Contact: ${[p.email, p.phone, p.location, p.linkedin, p.github, p.website].filter(Boolean).join(' | ')}`,
    `Current summary: ${p.summary}`,
    `Target roles: ${p.targetRoles}`,
    `Preferences: ${p.preferences}`,
    '',
    'EXPERIENCE (company | title | location | period):'
  ]
  for (const it of items.filter((i) => i.kind === 'experience')) {
    const d = it.data as ItemDataMap['experience']
    out.push(`- ${d.company} | ${d.title} | ${d.location} | ${d.start} – ${d.end || 'present'}`)
  }
  out.push('', 'EDUCATION:')
  for (const it of items.filter((i) => i.kind === 'education')) {
    const d = it.data as ItemDataMap['education']
    out.push(`- ${d.degree} ${d.field} — ${d.institution} (${d.start} – ${d.end})`)
  }
  const list = (kind: 'skill' | 'language' | 'certification', label: string, fmt: (d: never) => string) => {
    const xs = items.filter((i) => i.kind === kind).map((i) => fmt(i.data as never))
    if (xs.length) out.push('', `${label}: ${xs.join('; ')}`)
  }
  list('skill', 'SKILLS', (d: ItemDataMap['skill']) => [d.name, d.level, d.years && `${d.years}y`].filter(Boolean).join(' '))
  list('language', 'LANGUAGES', (d: ItemDataMap['language']) => `${d.name} ${d.level}`.trim())
  list('certification', 'CERTIFICATIONS', (d: ItemDataMap['certification']) => [d.name, d.issuer, d.date].filter(Boolean).join(', '))
  return out.join('\n')
}

export function factsBlock(facts: Retrieved[]): string {
  if (!facts.length) return '(no facts retrieved)'
  return facts.map((f) => `[F${f.id}] ${f.text}`).join('\n')
}

export function jobBlock(job: Job): string {
  const r = job.requirements
  const parts = [`JOB: ${job.title} — ${job.company} (${job.location})`, '', 'DESCRIPTION:', job.description.slice(0, 20000)]
  if (r) {
    parts.push('', `Required: ${r.mustHave.join('; ')}`, `Nice to have: ${r.niceToHave.join('; ')}`, `Keywords: ${r.keywords.join(', ')}`)
  }
  return parts.join('\n')
}

/** RAG queries for a job: each requirement/keyword becomes its own query. */
export function jobQueries(job: Job): string[] {
  const r = job.requirements
  if (!r) return [job.title, job.description.slice(0, 1000)]
  return [job.title, ...r.mustHave, ...r.niceToHave, ...r.responsibilities.slice(0, 8), ...r.keywords.slice(0, 15)]
}

export const NO_FABRICATION = `NON-NEGOTIABLE RULES:
- Use ONLY information present in the PROFILE and FACTS provided. Never invent companies, titles, dates, numbers, certifications or technologies.
- You may rewrite, reorder, condense and emphasize facts to align them with the job, but you may not create new ones.
- If a job requirement has no supporting evidence, do not present it as the candidate's experience.`

export const languageName = (l: 'pt' | 'en'): string => (l === 'pt' ? 'Brazilian Portuguese' : 'English')
