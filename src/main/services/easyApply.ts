import { getChat } from '../ai'
import { factsRepo, jobsRepo, qaRepo } from '../db/repos'
import { retrieve } from '../rag'
import type { FieldAnswer, FormField } from '@shared/types'
import { factsBlock, profileSkeleton } from './context'
import { FieldAnswersSchema } from './schemas'
import { WRITING_RULES } from '@shared/writingCheck'

/**
 * Suggests answers for Easy Apply fields.
 * Priority: memory of previous answers → AI with profile + RAG → leave blank.
 * File fields are skipped here (the resume is attached separately).
 */
export async function answerFields(jobId: number | null, fields: FormField[]): Promise<FieldAnswer[]> {
  const result = new Map<string, FieldAnswer>()
  const pending: FormField[] = []

  for (const f of fields) {
    if (f.type === 'file') continue
    const remembered = qaRepo.find(f.label)
    if (remembered != null && (!f.options.length || f.options.includes(remembered))) {
      result.set(f.key, { key: f.key, value: remembered, origin: 'memory' })
    } else {
      pending.push(f)
    }
  }

  if (pending.length) {
    const job = jobId ? jobsRepo.get(jobId) : null
    const facts = await retrieve(
      pending.map((f) => f.label),
      { perQuery: 3, limit: 30, minScore: 0.25 }
    )
    const { answers } = await getChat('easy-apply').json({
      name: 'field_answers',
      schema: FieldAnswersSchema,
      system:
        'You fill in job application forms on behalf of the candidate, using ONLY the profile and facts provided. ' +
        'For numeric "years of experience" questions, add up the documented periods and answer with a whole number only. ' +
        'For select/radio, answer with the exact text of one of the options. Answer free-text fields in the language of the question. ' +
        'If the information is not available (e.g. salary expectations, availability or work authorization not provided), set known=false and leave value empty. Never guess.\n' +
        `For free-text answers:\n${WRITING_RULES}`,
      prompt:
        `${job ? `Job: ${job.title} — ${job.company}\n\n` : ''}PROFILE:\n${profileSkeleton()}\n\nFACTS:\n${factsBlock(facts)}\n\n` +
        `FIELDS:\n${JSON.stringify(pending.map(({ key, label, type, options, required }) => ({ key, label, type, options, required })), null, 1)}`
    })
    for (const a of answers) {
      const field = pending.find((f) => f.key === a.key)
      if (!field) continue
      const valid = a.known && a.value.trim() && (!field.options.length || field.options.includes(a.value))
      result.set(a.key, { key: a.key, value: valid ? a.value : '', origin: valid ? 'ai' : 'unknown' })
    }
  }

  return fields.filter((f) => f.type !== 'file').map((f) => result.get(f.key) ?? { key: f.key, value: '', origin: 'unknown' })
}

/**
 * Stores the user's final answers in memory and, for descriptive answers,
 * also as facts — so the candidate's knowledge base grows with every application.
 */
export function rememberAnswers(fields: FormField[]): number {
  let saved = 0
  for (const f of fields) {
    if (f.type === 'file' || !f.label.trim() || !f.value.trim()) continue
    qaRepo.save(f.label, f.value)
    saved++
    const isDescriptive = (f.type === 'textarea' || f.type === 'text') && f.value.trim().length >= 40
    const fact = `Application question: "${f.label}" — Candidate's answer: ${f.value.trim()}`
    if (isDescriptive && !factsRepo.exists(fact)) factsRepo.add(fact, 'easy-apply')
  }
  return saved
}
