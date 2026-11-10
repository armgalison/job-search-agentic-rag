import { describe, expect, it } from 'vitest'
import { parseResumeText } from '../src/shared/resumeHeuristics'

const PT = `Ana Exemplo
Engenheira de Software Backend
São Paulo, SP | ana@example.com | (11) 98765-4321
linkedin.com/in/ana-exemplo | github.com/anaex

Resumo
Engenheira backend com 6 anos de experiência em Node.js, sistemas distribuídos e pagamentos.

Experiência Profissional
Engenheira de Software Sênior — Acme Pagamentos
03/2021 - atual
• Desenvolvimento de APIs em Node.js e TypeScript
• Reduzi a latência p95 do checkout em 40%
Desenvolvedora Backend | Beta Tech | Campinas
jan 2018 – fev 2021
- Mensageria com RabbitMQ e Kafka
- Migração do monólito
  para microsserviços

Formação
Bacharelado em Ciência da Computação
Universidade de São Paulo 2014 - 2017

Habilidades
Linguagens: TypeScript, Go, Python
Bancos: PostgreSQL; Redis

Idiomas
Inglês - fluente, Espanhol (intermediário)

Certificações
AWS Solutions Architect – Amazon 2022
`

describe('parseResumeText', () => {
  const r = parseResumeText(PT)

  it('extracts contact info and header', () => {
    expect(r.profile.fullName).toBe('Ana Exemplo')
    expect(r.profile.headline).toBe('Engenheira de Software Backend')
    expect(r.profile.email).toBe('ana@example.com')
    expect(r.profile.phone).toContain('98765-4321')
    expect(r.profile.linkedin).toContain('linkedin.com/in/ana-exemplo')
    expect(r.profile.github).toContain('github.com/anaex')
    expect(r.profile.location).toBe('São Paulo, SP')
    expect(r.profile.summary).toContain('6 anos')
  })

  it('splits experiences with title, company, dates, description and achievements', () => {
    expect(r.experiences).toHaveLength(2)
    const [a, b] = r.experiences
    expect(a).toMatchObject({ title: 'Engenheira de Software Sênior', company: 'Acme Pagamentos', start: '03/2021', end: '' })
    expect(a.description).toBe('Desenvolvimento de APIs em Node.js e TypeScript')
    expect(a.achievements).toBe('Reduzi a latência p95 do checkout em 40%')
    expect(b).toMatchObject({ title: 'Desenvolvedora Backend', company: 'Beta Tech', location: 'Campinas', start: 'jan 2018', end: 'fev 2021' })
    expect(b.description.split('\n')).toEqual(['Mensageria com RabbitMQ e Kafka', 'Migração do monólito para microsserviços'])
  })

  it('parses education, skills, languages and certifications', () => {
    expect(r.education[0]).toMatchObject({ degree: 'Bacharelado', field: 'Ciência da Computação', institution: 'Universidade de São Paulo', start: '2014', end: '2017' })
    expect(r.skills.map((s) => s.name)).toEqual(['TypeScript', 'Go', 'Python', 'PostgreSQL', 'Redis'])
    expect(r.languages).toEqual([
      { name: 'Inglês', level: 'fluente' },
      { name: 'Espanhol', level: 'intermediário' }
    ])
    expect(r.certifications[0]).toMatchObject({ name: 'AWS Solutions Architect', issuer: 'Amazon', date: '2022' })
  })

  it('handles English resumes with the date on the title line', () => {
    const en = parseResumeText(`John Doe\nSenior Engineer\n\nExperience\nStaff Engineer at Globex  Jan 2020 - Present\n- Increased throughput by 3x\n\nSkills\nRust, Kubernetes`)
    expect(en.experiences[0]).toMatchObject({ title: 'Staff Engineer', company: 'Globex', start: 'Jan 2020', end: '' })
    expect(en.experiences[0].achievements).toBe('Increased throughput by 3x')
    expect(en.skills.map((s) => s.name)).toEqual(['Rust', 'Kubernetes'])
  })
})
