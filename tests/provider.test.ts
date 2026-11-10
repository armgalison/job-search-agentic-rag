import { describe, expect, it } from 'vitest'
import * as z from 'zod/v4'
import { AiError, parseJsonText } from '../src/main/ai/provider'
import { ResumeSchema } from '../src/main/services/schemas'
import { coverLetterHtml, resumeHtml } from '../src/main/docs/templates'

describe('parseJsonText', () => {
  const S = z.object({ a: z.number() })
  it('extracts JSON wrapped in prose / code fences', () => {
    expect(parseJsonText('Claro! ```json\n{"a": 1}\n```', S)).toEqual({ a: 1 })
  })
  it('rejects invalid shapes', () => {
    expect(() => parseJsonText('{"a": "x"}', S)).toThrow(AiError)
    expect(() => parseJsonText('sem json', S)).toThrow(AiError)
  })
})

const resume = ResumeSchema.parse({
  name: 'Ana <Silva>',
  headline: 'Engenheira de Software',
  contact: ['ana@example.com'],
  summary: 'Resumo',
  skills: ['TypeScript', 'Node.js'],
  experiences: [{ company: 'Acme', title: 'Dev', location: 'SP', period: '2020 – atual', bullets: ['Fez X'] }],
  education: [],
  projects: [],
  certifications: [],
  languages: ['Inglês fluente']
})

describe('templates', () => {
  it('defaults to English, escapes HTML and omits empty sections', () => {
    const html = resumeHtml(resume)
    expect(html).toContain('Ana &lt;Silva&gt;')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Experience')
    expect(html).not.toContain('Education')
    expect(resumeHtml({ ...resume, lang: 'pt' })).toContain('Experiência')
  })
  it('renders cover letter', () => {
    const html = coverLetterHtml(
      { greeting: 'Olá', paragraphs: ['P1', 'P2'], closing: 'Abraços', signature: 'Ana' },
      { name: 'Ana', contact: [], company: 'Acme', date: '1 de jan' }
    )
    expect(html).toContain('<p>P2</p>')
    expect(html).toContain('Acme')
  })
})
