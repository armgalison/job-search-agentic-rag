/**
 * Heuristic resume parser (no AI). Used in browser mode (npm run dev:web), where the AI is mocked.
 * Less accurate than the Electron app's AI extraction, but it recognizes the most common formats
 * in English and Portuguese: titled sections, date ranges, skill/language lists.
 */
import type { CertificationData, EducationData, ExperienceData, LanguageData, Profile, ProjectData, SkillData } from './types'

export interface ParsedResume {
  profile: Pick<Profile, 'fullName' | 'headline' | 'email' | 'phone' | 'location' | 'linkedin' | 'github' | 'website' | 'summary'>
  experiences: ExperienceData[]
  education: EducationData[]
  skills: SkillData[]
  projects: ProjectData[]
  certifications: CertificationData[]
  languages: LanguageData[]
}

type Section = 'header' | 'summary' | 'experience' | 'education' | 'skills' | 'languages' | 'certifications' | 'projects' | 'other'

const HEADINGS: [Section, RegExp][] = [
  ['summary', /^(resumo( profissional)?|sobre( mim)?|perfil( profissional)?|objetivo|summary|about( me)?|profile|professional summary)$/],
  ['experience', /^(experi[eê]ncias?( profissiona(?:l|is))?|hist[oó]rico profissional|experience|work experience|professional experience|employment( history)?)$/],
  ['education', /^(forma[cç][aã]o( acad[eê]mica)?|educa[cç][aã]o|escolaridade|education|academic background)$/],
  ['skills', /^(habilidades( t[eé]cnicas)?|compet[eê]ncias|tecnologias|conhecimentos( t[eé]cnicos)?|skills|technical skills|technologies|tech stack)$/],
  ['languages', /^(idiomas|l[ií]nguas|languages)$/],
  ['certifications', /^(certifica[cç][oõ]es|certificados|cursos( e certifica[cç][oõ]es)?|certifications|courses|licenses( & certifications)?)$/],
  ['projects', /^(projetos( pessoais)?|projects|personal projects|portf[oó]lio)$/],
  ['other', /^(refer[eê]ncias|references|interesses|interests|volunt[aá]rio|volunteering|pr[eê]mios|awards)$/]
]

const MONTH = '(?:jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-zç]*\\.?'
const DATE = `(?:\\d{1,2}/\\d{4}|${MONTH}\\s*(?:de\\s*)?\\d{4}|\\d{4})`
const END = `(?:${DATE}|atual|o momento|presente|present|current|hoje|now|atualmente)`
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|a|até|to|ate)\\s*(${END})`, 'i')

const BULLET = /^[-•*▪◦·●○►✓]\s*/
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

function headingOf(line: string): Section | null {
  const t = clean(line).replace(/[:：]$/, '').toLowerCase()
  if (t.length > 40) return null
  for (const [s, re] of HEADINGS) if (re.test(t)) return s
  return null
}

function splitSections(lines: string[]): Map<Section, string[]> {
  const out = new Map<Section, string[]>()
  let current: Section = 'header'
  for (const line of lines) {
    const h = headingOf(line)
    if (h) {
      current = h
      if (!out.has(h)) out.set(h, [])
      continue
    }
    out.set(current, [...(out.get(current) ?? []), line])
  }
  return out
}

/** Splits "Title — Company", "Title at Company", "Company | Title | Location"... */
function splitTitleCompany(header: string): { title: string; company: string; location: string } {
  const h = clean(header.replace(/[|,–—-]\s*$/, ''))
  let parts = h.split(/\s+(?:—|–|-|\||@|·)\s+|\s+(?:at|em|na|no)\s+/i).map(clean).filter(Boolean)
  if (parts.length === 1) parts = h.split(/\s*[|,]\s*/).map(clean).filter(Boolean)
  return { title: parts[0] ?? '', company: parts[1] ?? '', location: parts.slice(2).join(', ') }
}

function parseExperiences(lines: string[]): ExperienceData[] {
  const out: ExperienceData[] = []
  let cur: (ExperienceData & { _desc: string[]; _ach: string[]; _raw: string[] }) | null = null
  const pending: string[] = [] // undated lines before the period (usually title/company)

  const flush = () => {
    if (!cur) return
    cur.description = cur._desc.join('\n')
    cur.achievements = cur._ach.join('\n')
    const { company, title, location, start, end, description, achievements } = cur
    out.push({ company, title, location, start, end, description, achievements })
    cur = null
  }

  for (const raw of lines) {
    const line = clean(raw)
    if (!line) continue
    const m = line.match(RANGE)
    if (m) {
      // The header can be on the date line itself or on the lines before it
      const header = clean(line.replace(m[0], '').replace(/[()|,–—-]\s*$/, '').replace(/^\s*[()|,–—-]/, ''))
      const headerComplete = !!splitTitleCompany(header).company
      const prev: string[] = []
      if (!headerComplete) {
        if (cur) {
          // Short non-bullet lines right before the date belong to the new role
          const c: { _desc: string[]; _ach: string[]; _raw: string[] } = cur
          while (prev.length < 2 && c._raw.length && !BULLET.test(c._raw[c._raw.length - 1]) && c._raw[c._raw.length - 1].length < 70) {
            const l = c._raw.pop()!
            prev.unshift(l)
            const t = l.replace(BULLET, '')
            for (const arr of [c._desc, c._ach]) if (arr[arr.length - 1] === t) arr.pop()
          }
        } else prev.push(...pending.slice(-2))
      }
      pending.length = 0
      flush()
      const headerLines = [...prev, header].filter(Boolean)
      let parsed = splitTitleCompany(headerLines[0] ?? '')
      if (headerLines.length >= 2) {
        const second = splitTitleCompany(headerLines[1])
        parsed = parsed.company ? parsed : { title: parsed.title, company: second.title, location: second.company || second.location }
      }
      const isCurrent = /atual|momento|presente|present|current|hoje|now/i.test(m[2])
      cur = { ...parsed, start: m[1], end: isCurrent ? '' : m[2], description: '', achievements: '', _desc: [], _ach: [], _raw: [] }
      continue
    }
    if (!cur) {
      pending.push(line)
      continue
    }
    const c: { _desc: string[]; _ach: string[]; _raw: string[] } = cur
    const text = line.replace(BULLET, '')
    // Lines continuing the previous sentence (no bullet, lowercase start) are joined
    const last = c._raw.length ? c._raw[c._raw.length - 1].replace(BULLET, '') : null
    if (!BULLET.test(line) && /^[a-zà-ú]/.test(text) && last !== null) {
      for (const arr of [c._desc, c._ach]) if (arr[arr.length - 1] === last) arr[arr.length - 1] = `${last} ${text}`
      c._raw[c._raw.length - 1] += ` ${text}`
      continue
    }
    c._raw.push(line)
    const isAchievement = /\d+\s*%|\b\d+[xX]\b|R\$|US\$|\$\d|reduzi|aumentei|economi|reduced|increased|saved|grew/i.test(text)
    ;(isAchievement ? c._ach : c._desc).push(text)
  }
  flush()
  return out.filter((e) => e.title || e.company)
}

function parseEducation(lines: string[]): EducationData[] {
  const out: EducationData[] = []
  let buf: string[] = []
  const push = (start = '', end = '') => {
    const ls = buf.map(clean).filter(Boolean)
    buf = []
    if (!ls.length) return
    const degreeLine = ls.find((l) => /bacharel|licenciatura|tecn[oó]logo|t[eé]cnico|mba|mestrado|doutorado|p[oó]s|gradua|bachelor|master|phd|degree|b\.?sc|m\.?sc/i.test(l))
    const institution = ls.find((l) => l !== degreeLine) ?? ''
    const deg = degreeLine ?? ls[0]
    const [degree, field] = deg.split(/\s+(?:em|in|de)\s+|\s*[—–-]\s*/i).map(clean)
    out.push({ institution: institution === deg ? '' : institution, degree: degree ?? '', field: field ?? '', start, end })
  }
  for (const raw of lines) {
    const line = clean(raw.replace(BULLET, ''))
    if (!line) continue
    const m = line.match(RANGE) ?? line.match(/\b(\d{4})\b\s*$/)
    if (m) {
      const rest = clean(line.replace(m[0], '').replace(/[()|,–—-]\s*$/, ''))
      if (rest) buf.push(rest)
      push(m[2] ? m[1] : '', m[2] ?? m[1])
    } else buf.push(line)
  }
  push()
  return out
}

const splitList = (lines: string[]) =>
  lines
    .flatMap((l) => l.replace(BULLET, '').split(/\s*[,;•|·]\s*/))
    .map(clean)
    .filter((s) => s.length > 0 && s.length <= 50)

function parseLanguages(lines: string[]): LanguageData[] {
  return splitList(lines).map((s) => {
    const [name, ...lvl] = s.split(/\s*[-–—:(]\s*/)
    return { name: clean(name), level: clean(lvl.join(' ').replace(/\)$/, '')) }
  })
}

function parseSkills(lines: string[]): SkillData[] {
  // "Languages: TypeScript, Go" → strip the category label
  const items = lines.map((l) => l.replace(/^[^:]{2,30}:\s*/, ''))
  const seen = new Set<string>()
  return splitList(items)
    .filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .map((name) => ({ name, level: '', years: '' }))
}

export function parseResumeText(text: string): ParsedResume {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\t/g, ' ').trimEnd())
  const all = lines.join('\n')
  const sections = splitSections(lines.filter((l) => clean(l)))

  const email = all.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? ''
  const phone = all.match(/(?:\+?\d{2}\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/)?.[0] ?? ''
  const linkedin = all.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/i)?.[0] ?? ''
  const github = all.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i)?.[0] ?? ''
  const website =
    all
      .match(/(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|dev|io|me|net|com\.br|app|site)(?:\/[\w-]*)?/gi)
      ?.find((u) => !/linkedin|github|gmail|hotmail|outlook|yahoo/i.test(u) && !email.includes(u)) ?? ''

  const header = (sections.get('header') ?? []).map(clean)
  const isContact = (l: string) => /@|https?:|www\.|linkedin|github|\d{4,}|\(\d{2}\)/i.test(l)
  const nameLine = header.find((l) => !isContact(l) && l.split(' ').length <= 6 && /^[A-ZÀ-Ú]/.test(l)) ?? ''
  const rest = header.filter((l) => l !== nameLine && !isContact(l))
  const headline = rest.find((l) => l.split(' ').length <= 12) ?? ''
  const location =
    header
      .flatMap((l) => l.split(/\s*[|•·]\s*/))
      .map(clean)
      .find((p) => /^[A-ZÀ-Ú][\wÀ-ú\s]+,\s*(?:[A-Z]{2}|[A-ZÀ-Ú][\wÀ-ú\s]+)$/.test(p) && !p.includes('@')) ?? ''

  const summaryLines = sections.get('summary') ?? rest.filter((l) => l !== headline && l.split(' ').length > 12)

  return {
    profile: {
      fullName: nameLine,
      headline,
      email,
      phone: clean(phone),
      location,
      linkedin,
      github,
      website,
      summary: summaryLines.map(clean).join(' ')
    },
    experiences: parseExperiences(sections.get('experience') ?? []),
    education: parseEducation(sections.get('education') ?? []),
    skills: parseSkills(sections.get('skills') ?? []),
    projects: (sections.get('projects') ?? [])
      .map((l) => clean(l.replace(BULLET, '')))
      .filter(Boolean)
      .map((l) => {
        const [name, ...desc] = l.split(/\s+[—–-]\s+|:\s+/)
        return { name: clean(name), url: l.match(/https?:\/\/\S+/)?.[0] ?? '', description: clean(desc.join(' — ')), tech: '' }
      }),
    certifications: (sections.get('certifications') ?? [])
      .map((l) => clean(l.replace(BULLET, '')))
      .filter(Boolean)
      .map((l) => {
        const date = l.match(/\b(?:\d{1,2}\/)?\d{4}\b/)?.[0] ?? ''
        const [name, issuer] = l.replace(date, '').split(/\s+[—–-]\s+|\s*\|\s*|,\s+/).map(clean)
        return { name: name ?? l, issuer: issuer ?? '', date }
      }),
    languages: parseLanguages(sections.get('languages') ?? [])
  }
}
