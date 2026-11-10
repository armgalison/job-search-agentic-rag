import type { ItemDataMap, ItemKind, ProfileItem } from '@shared/types'

const join = (...parts: (string | undefined)[]): string => parts.filter((p) => p && p.trim()).join(' ')
const period = (start: string, end: string): string => (start || end ? `(${start || '?'} – ${end || 'present'})` : '')
const lines = (s: string): string[] =>
  s
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*\s]+/, '').trim())
    .filter(Boolean)

/**
 * Turns a profile item into atomic facts (short, self-contained texts),
 * which are the unit of indexing and retrieval in the RAG.
 */
export function itemToFacts(item: ProfileItem): string[] {
  const kind = item.kind as ItemKind
  switch (kind) {
    case 'experience': {
      const d = item.data as ItemDataMap['experience']
      const ctx = join(d.title, 'at', d.company, period(d.start, d.end))
      const out = [join(ctx + '.', d.location ? `Location: ${d.location}.` : '')]
      for (const l of lines(d.description)) out.push(`${ctx}: ${l}`)
      for (const l of lines(d.achievements)) out.push(`Achievement as ${d.title} at ${d.company}: ${l}`)
      return out
    }
    case 'education': {
      const d = item.data as ItemDataMap['education']
      return [join('Education:', d.degree, d.field ? `in ${d.field}` : '', '—', d.institution, period(d.start, d.end))]
    }
    case 'skill': {
      const d = item.data as ItemDataMap['skill']
      return [join('Skill:', d.name, d.level ? `(${d.level} level)` : '', d.years ? `— ${d.years} years of experience` : '')]
    }
    case 'project': {
      const d = item.data as ItemDataMap['project']
      return [join('Project:', d.name, '—', d.description, d.tech ? `Technologies: ${d.tech}.` : '', d.url)]
    }
    case 'certification': {
      const d = item.data as ItemDataMap['certification']
      return [join('Certification:', d.name, d.issuer ? `issued by ${d.issuer}` : '', d.date ? `on ${d.date}` : '')]
    }
    case 'language': {
      const d = item.data as ItemDataMap['language']
      return [join('Language:', d.name, d.level ? `— ${d.level} level` : '')]
    }
  }
}
