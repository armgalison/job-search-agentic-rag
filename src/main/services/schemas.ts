import * as z from 'zod/v4'

// Simple schemas (no min/max) to stay compatible with every provider's structured output.

export const JobRequirementsSchema = z.object({
  title: z.string(),
  company: z.string(),
  seniority: z.string().describe('junior, mid, senior, staff, manager... or empty'),
  location: z.string(),
  workModel: z.string().describe('remote, hybrid, on-site, or empty'),
  language: z.enum(['pt', 'en']).describe('language the job posting is written in'),
  mustHave: z.array(z.string()).describe('required qualifications, one per item, short'),
  niceToHave: z.array(z.string()),
  keywords: z.array(z.string()).describe('ATS keywords: technologies, tools, methodologies'),
  responsibilities: z.array(z.string())
})

export const MatchSchema = z.object({
  score: z.number().describe('0 to 100'),
  summary: z.string().describe("2-3 sentences on how well the candidate fits"),
  matched: z.array(z.string()).describe('requirements met, with a short summary of the evidence'),
  gaps: z.array(z.string()).describe('requirements with no evidence in the knowledge base; phrase each as a short question to the candidate')
})

export const ResumeSchema = z.object({
  name: z.string(),
  headline: z.string(),
  contact: z.array(z.string()),
  summary: z.string(),
  skills: z.array(z.string()),
  experiences: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string(),
      period: z.string(),
      bullets: z.array(z.string())
    })
  ),
  education: z.array(z.object({ institution: z.string(), degree: z.string(), period: z.string() })),
  projects: z.array(z.object({ name: z.string(), description: z.string() })),
  certifications: z.array(z.string()),
  languages: z.array(z.string())
})

export const CoverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  closing: z.string(),
  signature: z.string()
})

export const ImportedProfileSchema = z.object({
  profile: z.object({
    fullName: z.string(),
    headline: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    linkedin: z.string(),
    github: z.string(),
    website: z.string(),
    summary: z.string()
  }),
  experiences: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string(),
      start: z.string(),
      end: z.string(),
      description: z.string().describe('responsibilities, one per line'),
      achievements: z.string().describe('measurable achievements, one per line')
    })
  ),
  education: z.array(z.object({ institution: z.string(), degree: z.string(), field: z.string(), start: z.string(), end: z.string() })),
  skills: z.array(z.object({ name: z.string(), level: z.string(), years: z.string() })),
  projects: z.array(z.object({ name: z.string(), url: z.string(), description: z.string(), tech: z.string() })),
  certifications: z.array(z.object({ name: z.string(), issuer: z.string(), date: z.string() })),
  languages: z.array(z.object({ name: z.string(), level: z.string() }))
})

export const FieldAnswersSchema = z.object({
  answers: z.array(
    z.object({
      key: z.string(),
      value: z.string().describe('the answer; for select/radio use exactly one of the options; empty if unknown'),
      known: z.boolean().describe('false if the knowledge base lacks enough information to answer confidently')
    })
  )
})

export const NewFactsSchema = z.object({
  facts: z.array(z.string()).describe('new, verifiable, self-contained facts about the candidate, one per item')
})
