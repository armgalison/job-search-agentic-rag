import { getChat } from '../ai'
import { applicationsRepo, factsRepo, jobsRepo, profileRepo } from '../db/repos'
import { retrieve } from '../rag'
import { getSettings } from '../settings'
import { WRITING_RULES, checkWriting } from '@shared/writingCheck'
import type { Application, CoverLetterDoc, Fact, Job, Lang, ResumeDoc } from '@shared/types'
import { NO_FABRICATION, factsBlock, jobBlock, jobQueries, languageName, profileSkeleton } from './context'
import { CoverLetterSchema, JobRequirementsSchema, MatchSchema, NewFactsSchema, ResumeSchema } from './schemas'

/** Output language: explicit choice, otherwise the default from Settings (English unless changed). */
const outputLang = (lang?: Lang): Lang => lang ?? getSettings().defaultLang

/** Extracts structured requirements from the job and scores the profile fit via RAG. */
export async function analyzeJob(jobId: number): Promise<Job> {
  const job = jobsRepo.get(jobId)
  if (!job) throw new Error('Job not found')
  const chat = getChat('analyze-job')
  const lang = languageName(getSettings().defaultLang)

  const requirements = await chat.json({
    name: 'job_requirements',
    schema: JobRequirementsSchema,
    system: `You are an experienced technical recruiter. Extract the job requirements faithfully and concisely. Write the extracted items in ${lang}; set "language" to the language the posting itself is written in.`,
    prompt: `Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\n\nDescription:\n${job.description.slice(0, 20000)}`
  })
  const withReq: Job = { ...job, requirements }
  const facts = await retrieve(jobQueries(withReq), { perQuery: 4, limit: 40 })

  const match = await chat.json({
    name: 'match',
    schema: MatchSchema,
    system:
      'You assess how well a candidate fits a job based ONLY on the evidence provided. Be honest and rigorous. ' +
      `Requirements without explicit evidence are gaps, even if they seem likely. Write in ${lang}.`,
    prompt: `${jobBlock(withReq)}\n\nPROFILE:\n${profileSkeleton()}\n\nRETRIEVED FACTS:\n${factsBlock(facts)}`
  })
  match.score = Math.max(0, Math.min(100, Math.round(match.score)))
  jobsRepo.setAnalysis(jobId, requirements, match)
  return jobsRepo.get(jobId)!
}

async function ensureAnalyzed(jobId: number): Promise<Job> {
  const job = jobsRepo.get(jobId)
  if (!job) throw new Error('Job not found')
  return job.requirements ? job : analyzeJob(jobId)
}

export async function generateResume(jobId: number, lang?: Lang): Promise<Application> {
  const job = await ensureAnalyzed(jobId)
  const language = outputLang(lang)
  const facts = await retrieve(jobQueries(job), { perQuery: 6, limit: 60, minScore: 0.15 })

  const resume: ResumeDoc = await getChat('resume').json({
    name: 'resume',
    schema: ResumeSchema,
    system: `You are an expert at writing resumes optimized for both ATS and human recruiters.
Write in ${languageName(language)}.
${NO_FABRICATION}
- Include ALL experiences from the profile (company, title, location and period exactly as in the profile), most recent first.
- For each experience, write 2 to 5 bullets starting with an action verb, prioritizing the facts most relevant to the job and using the job's keywords where there is evidence.
- skills: up to 15 items, prioritizing those the job asks for AND the candidate demonstrably has.
- summary: 3-4 sentences aligned with the job.
- contact: email, phone, city, LinkedIn, GitHub/website — only those that exist.
${WRITING_RULES}`,
    prompt: `${jobBlock(job)}\n\nPROFILE:\n${profileSkeleton()}\n\nRELEVANT FACTS (ranked by relevance):\n${factsBlock(facts)}`
  })

  resume.lang = language
  const appRow = applicationsRepo.ensure(jobId)
  applicationsRepo.save({ ...appRow, resume })
  return applicationsRepo.get(appRow.id)!
}

export async function generateCoverLetter(jobId: number, lang?: Lang, tone = 'professional and warm'): Promise<Application> {
  const job = await ensureAnalyzed(jobId)
  const language = outputLang(lang)
  const facts = await retrieve(jobQueries(job), { perQuery: 4, limit: 25, minScore: 0.2 })
  const p = profileRepo.get()

  const draft: CoverLetterDoc = await getChat('cover-letter').json({
    name: 'cover_letter',
    schema: CoverLetterSchema,
    system: `You write concise, specific cover letters (250-350 words) in ${languageName(language)}, with a ${tone} tone.
${NO_FABRICATION}
- Structure: an opening that connects the candidate to the role/company; 1-2 paragraphs with 2-3 concrete achievements tied to the requirements; a closing that invites a conversation.
- Do not restate the whole resume.
- greeting: "Hello <Company> team," (or the Portuguese equivalent) unless a person's name is known. Never "Dear Hiring Manager" or a placeholder.
- signature: the candidate's full name.
${WRITING_RULES}`,
    prompt: `${jobBlock(job)}\n\nPROFILE:\n${profileSkeleton()}\n\nRELEVANT FACTS:\n${factsBlock(facts)}\n\nName for signature: ${p.fullName}`
  })
  const letter = await reviseWriting(draft)

  letter.lang = language
  const appRow = applicationsRepo.ensure(jobId)
  applicationsRepo.save({ ...appRow, coverLetter: letter })
  return applicationsRepo.get(appRow.id)!
}

/**
 * One revision pass when the draft shows mechanical signs of AI writing (em dashes, AI vocabulary, clichés…).
 * Keeps the facts; only rewrites the flagged sentences.
 */
async function reviseWriting(letter: CoverLetterDoc): Promise<CoverLetterDoc> {
  const text = [letter.greeting, ...letter.paragraphs, letter.closing].join('\n\n')
  const issues = checkWriting(text)
  if (!issues.length) return letter
  try {
    const revised = await getChat('cover-letter').json({
      name: 'cover_letter',
      schema: CoverLetterSchema,
      system: `Revise this cover letter so it no longer shows the listed signs of AI-generated writing. Rewrite the affected sentences with plain, specific wording. Keep every fact, the language and the length; add nothing new.\n${WRITING_RULES}`,
      prompt: `LETTER (JSON):\n${JSON.stringify(letter)}\n\nISSUES FOUND:\n${issues.map((i) => `- ${i.rule}: "${i.match}" — ${i.advice}`).join('\n')}`
    })
    return { ...revised, signature: revised.signature || letter.signature }
  } catch {
    return letter
  }
}

/** The candidate answered a job gap: the answer becomes new facts in the knowledge base. */
export async function answerGap(jobId: number, gap: string, answer: string): Promise<Fact> {
  const job = jobsRepo.get(jobId)
  const { facts } = await getChat('gap-answer').json({
    name: 'new_facts',
    schema: NewFactsSchema,
    system:
      `Turn the candidate's answer into 1-3 atomic facts written in ${languageName(getSettings().defaultLang)}, with an implicit subject ` +
      '(e.g. "2 years of experience running Kubernetes in production at Company X"). ' +
      'Use only what the candidate stated. If they said they do not have the experience, return an empty list.',
    prompt: `Job: ${job?.title ?? ''}\nQuestion/gap: ${gap}\nCandidate's answer: ${answer}`
  })
  let last: Fact | null = null
  for (const f of facts) if (!factsRepo.exists(f)) last = factsRepo.add(f, 'gap-answer')
  if (!last) last = factsRepo.add(`${gap} — ${answer}`, 'gap-answer')
  return last
}

/** Resume bullets edited by hand that are not yet in the base become facts (source 'editor'). */
export async function learnFromEdits(appId: number): Promise<{ added: number }> {
  const a = applicationsRepo.get(appId)
  if (!a?.resume) return { added: 0 }
  const candidates = a.resume.experiences.flatMap((e) => e.bullets.map((b) => `${e.title} at ${e.company}: ${b}`))
  let added = 0
  for (const c of candidates) {
    if (factsRepo.exists(c)) continue
    // A bullet is "known" if some fact is already nearly identical to it
    const hit = (await retrieve([c], { perQuery: 1, limit: 1, minScore: 0.95 }))[0]
    if (!hit) {
      factsRepo.add(c, 'editor')
      added++
    }
  }
  return { added }
}
