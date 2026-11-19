import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod/v4'
import { checkWriting } from '@shared/writingCheck'
import type { ApplicationStatus, BlacklistKind, CoverLetterDoc, FormField, Job, Lang } from '@shared/types'
import { applicationsRepo, blacklistRepo, jobsRepo, outreachRepo, profileRepo, qaRepo } from '../db/repos'
import { jobKey, matchBlacklist, type BlacklistTarget } from './blacklist'
import { coverLetterText, writeApplicationFiles } from '../docs'
import { emit } from '../events'
import { logger } from '../log'
import { retrieve } from '../rag'
import { answerFields, rememberAnswers } from '../services/easyApply'
import { profileSkeleton } from '../services/context'
import { analyzeJob, answerGap, generateResume } from '../services/generator'
import { getSettings } from '../settings'
import { applicationsAtCompany, hasApplied, normalizeCompany } from './history'
import { emailIdsInNotes, STATUS_WORD, statusMove, type EmailStatus } from './emailUpdates'
import { agentFilesDir } from './paths'
import { addEvent, ask, currentRun, granted, patchRun, runFlags } from './session'

/**
 * The app's own MCP server ("jobsearch"), served over Streamable HTTP on 127.0.0.1 with a random bearer token.
 * It is the agent's only way into the candidate's data: knowledge base, documents, bookkeeping, questions to
 * the candidate and the permission gate before every final Submit/Send.
 */

type Json = Record<string, unknown> | unknown[]
const ok = (data: Json | string) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

const linkedinIdOf = (url: string): string | null => url.match(/\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/)?.[1] ?? url.match(/[?&]currentJobId=(\d+)/)?.[1] ?? null

function jobOrThrow(id: number) {
  const job = jobsRepo.get(id)
  if (!job) throw new Error(`Job #${id} not found. Call save_job first.`)
  return job
}

/** What the app knows about earlier applications for this job and at its company. */
function applicationHistory(jobId: number) {
  const job = jobOrThrow(jobId)
  return {
    alreadyApplied: hasApplied(job, applicationsRepo.getByJob(jobId)),
    appliedAtSameCompany: applicationsAtCompany(job.company, job.id, jobsRepo.list(), (id) => applicationsRepo.getByJob(id))
  }
}

/** The blacklist entry ruling this job / company / person out, as the agent should see it. */
function blacklisted(t: BlacklistTarget) {
  const e = matchBlacklist(blacklistRepo.list(), t) as ReturnType<typeof blacklistRepo.list>[number] | null
  return e ? { kind: e.kind, entry: e.label, reason: e.reason || 'the candidate said so' } : null
}
const jobTarget = (j: Job): BlacklistTarget => ({ jobId: j.id, url: j.url, company: j.company, title: j.title })

/** Adds an entry the candidate asked for during a run. */
function blacklistFromRun(kind: BlacklistKind, job: Job | null, reason: string, label?: string): void {
  const value = label ?? (kind === 'company' ? job?.company : job?.url)
  if (!value) return
  blacklistRepo.add({ kind, label: value, reason, jobId: job?.id ?? null }, 'agent')
  emit({ type: 'blacklist-changed' })
  addEvent({ kind: 'status', text: `Added to the blacklist: ${kind} "${value}"` })
}

/** The last thing the agent recorded about a job ("skipped — score 45 < 60"), so it doesn't evaluate it again. */
function lastAgentNote(jobId: number): string | null {
  const notes = applicationsRepo.getByJob(jobId)?.notes ?? ''
  const all = [...notes.matchAll(/Agent: (skipped|failed)[^\n]*/g)]
  return all.length ? all[all.length - 1][0].replace(/^Agent: /, '') : null
}

const sentTo = (profileUrl: string) => outreachRepo.list({ profileUrl }).filter((o) => o.status === 'sent')

function appendNote(jobId: number, line: string): void {
  const a = applicationsRepo.ensure(jobId)
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  applicationsRepo.save({ ...a, notes: `${a.notes ? `${a.notes}\n` : ''}[${stamp}] ${line}` })
}

/** The candidate applied before, outside the app: mark it applied (not counted as this run's application). */
function markAppliedBefore(jobId: number, why: string): void {
  appendNote(jobId, `Agent: found an earlier application made outside the app (${why})`)
  applicationsRepo.setStatus(applicationsRepo.ensure(jobId).id, 'applied')
  jobsRepo.setStatus(jobId, 'applied')
  addEvent({ kind: 'status', text: `Job #${jobId} was already applied to earlier — skipping it` })
}

/** Wraps a handler so errors become tool errors (the agent sees the message) instead of crashing the request. */
function safe<A>(name: string, fn: (args: A) => Promise<ReturnType<typeof ok>> | ReturnType<typeof ok>) {
  return async (args: A) => {
    try {
      return await fn(args)
    } catch (err) {
      logger.warn('agent', `Tool ${name} failed: ${(err as Error).message}`)
      return fail((err as Error).message)
    }
  }
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'jobsearch', version: '0.2.0' })

  server.registerTool(
    'get_candidate_profile',
    {
      description:
        "The candidate's profile: name, contact, headline, summary, every job with dates, education, skills, languages, certifications, preferences, plus saved application-form answers (question → answer). Call once per run.",
      inputSchema: {}
    },
    safe('get_candidate_profile', () => {
      const p = profileRepo.get()
      return ok({
        contact: { fullName: p.fullName, email: p.email, phone: p.phone, location: p.location, linkedin: p.linkedin, github: p.github, website: p.website },
        profile: profileSkeleton(),
        savedAnswers: qaRepo
          .list()
          .slice(0, 150)
          .map((q) => ({ question: q.question, answer: q.answer }))
      })
    })
  )

  server.registerTool(
    'search_knowledge',
    {
      description:
        "Semantic search over the candidate's knowledge base (atomic facts from their resume, profile and earlier answers). Pass several short queries; returns the best-matching facts with ids and scores. Use it before claiming anything about the candidate.",
      inputSchema: { queries: z.array(z.string()).min(1).max(20), limit: z.number().int().min(1).max(60).optional() }
    },
    safe('search_knowledge', async ({ queries, limit }: { queries: string[]; limit?: number }) => {
      const facts = await retrieve(queries, { perQuery: 4, limit: limit ?? 20, minScore: 0.2 })
      return ok(facts.length ? facts.map((f) => ({ id: f.id, text: f.text, score: Math.round(f.score * 100) / 100 })) : 'No matching facts. The knowledge base has nothing on this.')
    })
  )

  server.registerTool(
    'ask_user',
    {
      description:
        "Ask the candidate and WAIT for the answer (it can take minutes). Only for (a) facts about the candidate missing from the knowledge base (kind 'knowledge'), or (b) things only a human can do in the browser: log in, solve a CAPTCHA, enter a verification code (kind 'action'). One self-contained question at a time. With save_as_fact=true, a 'knowledge' answer is added to the knowledge base.",
      inputSchema: {
        question: z.string().min(3),
        reason: z.string().optional().describe('Why you need it (the job, the form field)'),
        kind: z.enum(['knowledge', 'action']).default('knowledge'),
        options: z.array(z.string()).max(12).optional(),
        job_id: z.number().int().optional(),
        save_as_fact: z.boolean().optional()
      }
    },
    safe(
      'ask_user',
      async (a: { question: string; reason?: string; kind: 'knowledge' | 'action'; options?: string[]; job_id?: number; save_as_fact?: boolean }) => {
        const opts = a.options?.length ? a.options : a.kind === 'action' ? ['Done', 'Skip this job', 'Never apply to this company', 'Stop the run'] : []
        const answer = (await ask(a.kind, a.question, a.reason ?? '', opts, a.job_id ?? null)).trim()
        if (a.kind === 'knowledge' && a.save_as_fact !== false && answer && !/^(skip|stop the run)/i.test(answer)) {
          try {
            await answerGap(a.job_id ?? 0, a.question, answer)
            emit({ type: 'facts-changed' })
          } catch (err) {
            logger.warn('agent', `Could not save the answer as a fact: ${(err as Error).message}`)
          }
        }
        if (/^stop the run/i.test(answer)) runFlags.ended = 'the candidate asked to stop'
        if (/^stop the run/i.test(answer)) return ok({ answer, instruction: 'The candidate asked to stop. Stop now and write the short report.' })
        const job = a.job_id != null ? jobsRepo.get(a.job_id) : null
        if (/^never apply to this company/i.test(answer)) {
          blacklistFromRun('company', job, `Answer to: ${a.question.slice(0, 160)}`)
          return ok({ answer, instruction: 'The company is now blacklisted. Do not apply to any of its jobs or contact anyone about them. record_application status "skipped" and move on.' })
        }
        if (/^skip this job/i.test(answer)) {
          blacklistFromRun('job', job, `Skipped by the candidate: ${a.question.slice(0, 160)}`)
          return ok({ answer, instruction: 'The candidate does not want this job, now or later (it is blacklisted). record_application status "skipped" and move on.' })
        }
        return ok({ answer })
      }
    )
  )

  server.registerTool(
    'save_job',
    {
      description:
        "Save (or update) a job read from LinkedIn or a career site. Pass the FULL description text, and applied_on_page=true when the page shows the candidate already applied ('Applied 3 days ago', 'Candidatou-se', 'Candidatura enviada', 'Application submitted'). Returns job_id, alreadyApplied, appliedAtSameCompany (other jobs at this company the candidate applied to) and contactedSoFar.",
      inputSchema: {
        url: z.string(),
        title: z.string(),
        company: z.string(),
        location: z.string().default(''),
        description: z.string().min(50),
        easy_apply: z.boolean().default(false),
        applied_on_page: z.boolean().default(false).describe('The page says the candidate already applied to this job')
      }
    },
    safe('save_job', (a: { url: string; title: string; company: string; location: string; description: string; easy_apply: boolean; applied_on_page: boolean }) => {
      const linkedinId = linkedinIdOf(a.url)
      const url = linkedinId ? `https://www.linkedin.com/jobs/view/${linkedinId}/` : a.url
      const job = jobsRepo.upsertCaptured({ url, linkedinId, title: a.title, company: a.company, location: a.location, description: a.description, easyApply: a.easy_apply })
      if (a.applied_on_page && !hasApplied(job, applicationsRepo.getByJob(job.id))) markAppliedBefore(job.id, 'the job page says the candidate already applied')
      emit({ type: 'jobs-changed' })
      const history = applicationHistory(job.id)
      const banned = blacklisted(jobTarget(job))
      const previously = lastAgentNote(job.id)
      return ok({
        job_id: job.id,
        status: jobsRepo.get(job.id)!.status,
        analyzed: !!job.match,
        score: job.match?.score ?? null,
        ...history,
        ...(banned ? { blacklisted: banned } : {}),
        ...(previously ? { previouslyRecorded: previously } : {}),
        contactedSoFar: outreachRepo.list({ jobId: job.id }).filter((o) => o.status === 'sent').length,
        ...(banned
          ? { instruction: `Blacklisted by the candidate (${banned.kind} "${banned.entry}": ${banned.reason}). Do NOT apply and do not contact anyone about it. Move on without recording anything.` }
          : history.alreadyApplied
          ? { instruction: 'Already applied: do NOT apply again. Go to outreach (if the run allows it), or move on.' }
          : history.appliedAtSameCompany.length
            ? { instruction: 'The candidate already applied to this company (see appliedAtSameCompany). If it is the same or a very similar role, record_application "skipped" (already applied at the company) and move on.' }
            : {})
      })
    })
  )

  server.registerTool(
    'analyze_job',
    {
      description: "Extract the job's requirements and score the candidate's fit (0-100) against the knowledge base. Returns score, summary, matched points, gaps and the requirements (incl. the posting's language).",
      inputSchema: { job_id: z.number().int(), force: z.boolean().optional() }
    },
    safe('analyze_job', async ({ job_id, force }: { job_id: number; force?: boolean }) => {
      let job = jobOrThrow(job_id)
      if (!job.match || force) job = await analyzeJob(job_id)
      emit({ type: 'jobs-changed' })
      return ok({ job_id, score: job.match?.score, summary: job.match?.summary, matched: job.match?.matched, gaps: job.match?.gaps, requirements: job.requirements })
    })
  )

  server.registerTool(
    'list_jobs',
    {
      description: 'Jobs already saved in the app (most recent first), with status and fit score.',
      inputSchema: { status: z.enum(['lead', 'captured', 'analyzed', 'applied', 'discarded']).optional(), limit: z.number().int().max(200).optional() }
    },
    safe('list_jobs', ({ status, limit }: { status?: string; limit?: number }) =>
      ok(
        jobsRepo
          .list()
          .filter((j) => !status || j.status === status)
          .slice(0, limit ?? 50)
          .map((j) => ({ job_id: j.id, title: j.title, company: j.company, url: j.url, status: j.status, score: j.match?.score ?? null, easyApply: j.easyApply }))
      )
    )
  )

  server.registerTool(
    'check_jobs',
    {
      description:
        "Triage search results BEFORE opening them: pass every card of a results page (url or LinkedIn job id, title, company). For each one returns verdict 'new' (open it), 'known' (already saved: status, score, what was recorded — don't re-evaluate unless asked), 'applied' (skip), or 'blacklisted' (the candidate ruled it out — skip). Call it on every results page.",
      inputSchema: {
        jobs: z
          .array(z.object({ url: z.string().describe('Job URL, or a bare LinkedIn job id'), title: z.string().default(''), company: z.string().default('') }))
          .min(1)
          .max(100)
      }
    },
    safe('check_jobs', ({ jobs }: { jobs: { url: string; title: string; company: string }[] }) => {
      const entries = blacklistRepo.list()
      const saved = jobsRepo.list()
      const byKey = new Map(saved.map((j) => [j.linkedinId ? `linkedin:${j.linkedinId}` : jobKey(j.url), j]))
      const results = jobs.map((c) => {
        const url = /^\d{6,}$/.test(c.url.trim()) ? `https://www.linkedin.com/jobs/view/${c.url.trim()}/` : c.url
        const known = byKey.get(jobKey(url))
        const target = known ? jobTarget(known) : { url, title: c.title, company: c.company }
        const ban = matchBlacklist(entries, target) as (typeof entries)[number] | null
        const base = { url, title: c.title || known?.title, company: c.company || known?.company }
        if (ban) return { ...base, verdict: 'blacklisted', why: `${ban.kind} "${ban.label}"${ban.reason ? `: ${ban.reason}` : ''}` }
        if (!known) {
          const atCompany = c.company ? applicationsAtCompany(c.company, -1, saved, (id) => applicationsRepo.getByJob(id)) : []
          return { ...base, verdict: 'new', ...(atCompany.length ? { appliedAtSameCompany: atCompany.map((a) => a.title) } : {}) }
        }
        if (hasApplied(known, applicationsRepo.getByJob(known.id))) return { ...base, job_id: known.id, verdict: 'applied' }
        return { ...base, job_id: known.id, verdict: 'known', status: known.status, score: known.match?.score ?? null, recorded: lastAgentNote(known.id) }
      })
      const count = (v: string) => results.filter((r) => r.verdict === v).length
      return ok({ summary: { new: count('new'), known: count('known'), applied: count('applied'), blacklisted: count('blacklisted') }, results })
    })
  )

  server.registerTool(
    'add_to_blacklist',
    {
      description:
        "Remember, for every future run, that the candidate does not want something: a company, a specific job, jobs whose title contains a keyword (e.g. 'PHP', 'estágio'), or a person not to contact. Call it whenever the candidate says so (in an answer, in the standing instructions, or by declining a job with a reason that will hold next time).",
      inputSchema: {
        kind: z.enum(['company', 'job', 'keyword', 'person']),
        value: z.string().min(1).describe('Company name, job URL, title keyword or LinkedIn profile URL'),
        reason: z.string().default('').describe("The candidate's reason, in their words"),
        job_id: z.number().int().optional()
      }
    },
    safe('add_to_blacklist', ({ kind, value, reason, job_id }: { kind: BlacklistKind; value: string; reason: string; job_id?: number }) => {
      const e = blacklistRepo.add({ kind, label: value, reason, jobId: job_id ?? null }, 'agent')
      emit({ type: 'blacklist-changed' })
      addEvent({ kind: 'status', text: `Added to the blacklist: ${kind} "${value}"` })
      return ok({ added: true, id: e.id })
    })
  )

  server.registerTool(
    'prepare_resume',
    {
      description:
        "Tailor the candidate's resume to the job from the knowledge base (never invents anything) and export it. Returns absolute paths of resume PDF and DOCX for browser_file_upload, plus an outline. regenerate=true after new facts were added.",
      inputSchema: { job_id: z.number().int(), lang: z.enum(['en', 'pt']).optional(), regenerate: z.boolean().optional() }
    },
    safe('prepare_resume', async ({ job_id, lang, regenerate }: { job_id: number; lang?: Lang; regenerate?: boolean }) => {
      jobOrThrow(job_id)
      const existing = applicationsRepo.getByJob(job_id)?.resume
      if (!existing || regenerate || (lang && existing.lang !== lang)) await generateResume(job_id, lang)
      emit({ type: 'applications-changed' })
      const r = applicationsRepo.getByJob(job_id)!.resume!
      const files = await writeApplicationFiles(job_id, agentFilesDir(job_id), 'resume')
      return ok({
        pdf: files.pdf,
        docx: files.docx,
        outline: { lang: r.lang, headline: r.headline, summary: r.summary, skills: r.skills, experiences: r.experiences.map((e) => `${e.title} — ${e.company} (${e.period}), ${e.bullets.length} bullets`) }
      })
    })
  )

  server.registerTool(
    'save_cover_letter',
    {
      description:
        'Store the cover letter you wrote for the job and export it. Returns PDF/DOCX paths, the plain text (for text areas) and any AI-writing signs still found (fix and save again if there are any).',
      inputSchema: {
        job_id: z.number().int(),
        greeting: z.string(),
        paragraphs: z.array(z.string()).min(1).max(8),
        closing: z.string(),
        lang: z.enum(['en', 'pt']).default('en')
      }
    },
    safe('save_cover_letter', async (a: { job_id: number; greeting: string; paragraphs: string[]; closing: string; lang: Lang }) => {
      jobOrThrow(a.job_id)
      const letter: CoverLetterDoc = { lang: a.lang, greeting: a.greeting, paragraphs: a.paragraphs, closing: a.closing, signature: profileRepo.get().fullName }
      const app = applicationsRepo.ensure(a.job_id)
      applicationsRepo.save({ ...app, coverLetter: letter })
      emit({ type: 'applications-changed' })
      const files = await writeApplicationFiles(a.job_id, agentFilesDir(a.job_id), 'cover-letter')
      const text = coverLetterText(letter)
      return ok({ pdf: files.pdf, docx: files.docx, text, words: text.split(/\s+/).length, writing_issues: checkWriting(text) })
    })
  )

  server.registerTool(
    'check_writing',
    {
      description:
        'Check a draft (message, note, cover letter, form answer) for the mechanical signs of AI-generated writing: AI vocabulary, em dashes, curly quotes, Markdown, emoji, placeholders, chatbot phrases, clichés, negative parallelisms. Returns issues with advice and the length. Fix every issue by rewriting.',
      inputSchema: { text: z.string(), max_chars: z.number().int().optional() }
    },
    safe('check_writing', ({ text, max_chars }: { text: string; max_chars?: number }) => {
      const issues = checkWriting(text)
      const tooLong = max_chars != null && text.length > max_chars
      return ok({ chars: text.length, ...(max_chars != null ? { max_chars, tooLong } : {}), clean: !issues.length && !tooLong, issues })
    })
  )

  server.registerTool(
    'suggest_form_answers',
    {
      description:
        "Answers for application form fields: saved earlier answers first (origin 'memory'), else grounded AI suggestions from the knowledge base (origin 'ai'), else origin 'unknown' (then derive or ask_user). Pass exact labels and the exact options of selects/radios.",
      inputSchema: {
        job_id: z.number().int().optional(),
        fields: z
          .array(
            z.object({
              key: z.string(),
              label: z.string(),
              type: z.enum(['text', 'textarea', 'number', 'select', 'radio', 'checkbox', 'file']),
              options: z.array(z.string()).default([]),
              required: z.boolean().default(false)
            })
          )
          .min(1)
          .max(60)
      }
    },
    safe('suggest_form_answers', async ({ job_id, fields }: { job_id?: number; fields: Omit<FormField, 'value'>[] }) =>
      ok(await answerFields(job_id ?? null, fields.map((f) => ({ ...f, value: '' }))))
    )
  )

  server.registerTool(
    'remember_answers',
    {
      description: 'Save the final answers you gave in an application form, so future applications reuse them (long free-text answers also become facts).',
      inputSchema: {
        fields: z
          .array(z.object({ label: z.string(), value: z.string(), type: z.enum(['text', 'textarea', 'number', 'select', 'radio', 'checkbox', 'file']).default('text') }))
          .max(80)
      }
    },
    safe('remember_answers', ({ fields }: { fields: { label: string; value: string; type: FormField['type'] }[] }) => {
      const saved = rememberAnswers(fields.map((f, i) => ({ key: String(i), label: f.label, value: f.value, type: f.type, options: [], required: false })))
      if (saved) emit({ type: 'facts-changed' })
      return ok({ saved })
    })
  )

  server.registerTool(
    'request_permission',
    {
      description:
        "MUST be called right before clicking a final irreversible button: submitting an application (kind 'application') or sending a message / connection invitation (kind 'message'). Returns allowed=true/false and an instruction. Never click when allowed is false.",
      inputSchema: {
        kind: z.enum(['application', 'message']),
        job_id: z.number().int().optional().describe('Required for applications'),
        profile_url: z.string().optional().describe("Required for messages: the person's LinkedIn profile URL"),
        summary: z.string()
      }
    },
    safe('request_permission', async ({ kind, job_id, profile_url, summary }: { kind: 'application' | 'message'; job_id?: number; profile_url?: string; summary: string }) => {
      const job = job_id != null ? jobsRepo.get(job_id) : null
      const banned = job ? blacklisted(jobTarget(job)) : null
      if (kind === 'application') {
        if (job_id == null) return ok({ allowed: false, instruction: 'Pass job_id (from save_job) and ask again.' })
        if (banned) return ok({ allowed: false, instruction: `Blacklisted by the candidate (${banned.kind} "${banned.entry}": ${banned.reason}). Do NOT submit. Close the form and move on.` })
        if (applicationHistory(job_id).alreadyApplied)
          return ok({ allowed: false, instruction: 'The candidate already applied to this job. Do NOT submit. Close the form without submitting and move on.' })
      } else {
        if (!profile_url) return ok({ allowed: false, instruction: "Pass the person's profile_url and ask again." })
        const person = blacklisted({ profileUrl: profile_url }) ?? (banned?.kind === 'company' ? banned : null)
        if (person) return ok({ allowed: false, instruction: `Blacklisted by the candidate (${person.kind} "${person.entry}": ${person.reason}). Do NOT send. Close the overlay and move on.` })
        const earlier = sentTo(profile_url)
        if (earlier.length)
          return ok({
            allowed: false,
            instruction: `This person was already contacted (${earlier[0].channel}, ${earlier[0].createdAt}). Do NOT send. Clear the text box, close the overlay and pick another contact or move on.`
          })
      }
      const s = getSettings().agent
      const max = kind === 'application' ? s.maxApplicationsPerRun : s.maxMessagesPerRun
      if (s.dryRun)
        return ok({ allowed: false, instruction: 'Dry run: do NOT click. Leave the form as is, record it as skipped ("dry run") and continue.' })
      if (granted[kind] >= max)
        return ok({
          allowed: false,
          instruction: `Limit reached: ${max} ${kind === 'application' ? 'application(s)' : 'message(s)'} per run. Do not click. ${kind === 'application' ? 'Stop applying' : 'Stop sending messages'} for this run.`
        })
      if (s.confirmBeforeSubmit) {
        const label = kind === 'application' ? 'Submit this application?' : 'Send this message?'
        const options =
          kind === 'application'
            ? ['Approve', 'Skip', 'Never apply to this job', 'Never apply to this company', 'Stop the run']
            : ['Approve', 'Skip', 'Never contact this person', 'Stop the run']
        const answer = await ask('approval', label, summary, options, job_id ?? null)
        if (/^stop/i.test(answer)) return ok({ allowed: false, instruction: 'The candidate stopped the run. Stop now and write the short report.' })
        const never = answer.match(/^never (apply to this job|apply to this company|contact this person)/i)?.[1]?.toLowerCase()
        if (never) {
          if (never === 'contact this person') blacklistFromRun('person', job, `Declined: ${summary.slice(0, 160)}`, profile_url)
          else blacklistFromRun(never.endsWith('company') ? 'company' : 'job', job, `Declined: ${summary.slice(0, 160)}`)
          return ok({ allowed: false, instruction: `The candidate said "${answer}" (now blacklisted). Do not click; close it, record it as skipped and continue.` })
        }
        if (!/^approve/i.test(answer)) return ok({ allowed: false, instruction: `The candidate declined${answer && !/^skip$/i.test(answer) ? `: "${answer}"` : ''}. Do not click; record it as skipped and continue.` })
      }
      granted[kind]++
      return ok({ allowed: true, instruction: 'Go ahead and click it now, then confirm it worked and record it.' })
    })
  )

  server.registerTool(
    'record_application',
    {
      description:
        "Record the outcome of an application attempt: 'applied', 'failed' (with the reason) or 'skipped' (with the reason, e.g. low fit). Use status 'applied' with applied_before=true when you find out the candidate had already applied earlier (the site says so, an account shows the application).",
      inputSchema: {
        job_id: z.number().int(),
        status: z.enum(['applied', 'failed', 'skipped']),
        channel: z.enum(['easy-apply', 'external', 'none']).default('none'),
        notes: z.string().default(''),
        url: z.string().optional(),
        applied_before: z.boolean().default(false).describe('The candidate had already applied earlier, outside this run')
      }
    },
    safe('record_application', (a: { job_id: number; status: 'applied' | 'failed' | 'skipped'; channel: string; notes: string; url?: string; applied_before: boolean }) => {
      jobOrThrow(a.job_id)
      if (a.applied_before) {
        markAppliedBefore(a.job_id, [a.url, a.notes].filter(Boolean).join(' — ') || 'reported by the agent')
        emit({ type: 'applications-changed' })
        emit({ type: 'jobs-changed' })
        return ok({ recorded: true })
      }
      if (a.status === 'applied' && applicationHistory(a.job_id).alreadyApplied) return ok({ recorded: false, note: 'This job was already recorded as applied.' })
      appendNote(a.job_id, `Agent: ${a.status}${a.channel !== 'none' ? ` via ${a.channel}` : ''}${a.url ? ` (${a.url})` : ''}${a.notes ? ` — ${a.notes}` : ''}`)
      if (a.status === 'applied') {
        const app = applicationsRepo.ensure(a.job_id)
        applicationsRepo.setStatus(app.id, 'applied')
        jobsRepo.setStatus(a.job_id, 'applied')
        const run = currentRun()
        if (run) patchRun({ applications: run.applications + 1 })
        addEvent({ kind: 'status', text: `Applied to job #${a.job_id}${a.channel !== 'none' ? ` (${a.channel})` : ''}` })
      }
      emit({ type: 'applications-changed' })
      emit({ type: 'jobs-changed' })
      return ok({ recorded: true })
    })
  )

  server.registerTool(
    'record_outreach',
    {
      description:
        'Record a message / connection request sent (or attempted) to a person about a job. Always call after sending. When the LinkedIn thread or a pending invitation shows the candidate contacted this person before, record it with contacted_before=true (status "sent", message = what you saw) so they are never contacted again.',
      inputSchema: {
        job_id: z.number().int().optional(),
        name: z.string(),
        profile_url: z.string(),
        role: z.string().default('').describe('recruiter, hiring manager, job poster…'),
        channel: z.enum(['connection', 'message', 'inmail', 'email']),
        message: z.string().default(''),
        status: z.enum(['sent', 'failed', 'skipped']),
        notes: z.string().default(''),
        contacted_before: z.boolean().default(false).describe('The candidate had already contacted this person outside this run')
      }
    },
    safe(
      'record_outreach',
      (a: {
        job_id?: number
        name: string
        profile_url: string
        role: string
        channel: 'connection' | 'message' | 'inmail' | 'email'
        message: string
        status: 'sent' | 'failed' | 'skipped'
        notes: string
        contacted_before: boolean
      }) => {
        if (a.contacted_before) {
          if (!sentTo(a.profile_url).length) {
            const notes = `Contacted earlier, outside the app (found in the LinkedIn history)${a.notes ? ` — ${a.notes}` : ''}`
            outreachRepo.add({ jobId: a.job_id ?? null, name: a.name, profileUrl: a.profile_url, role: a.role, channel: a.channel, message: a.message, status: 'sent', notes })
            emit({ type: 'outreach-changed' })
          }
          addEvent({ kind: 'status', text: `${a.name} was already contacted earlier — skipping` })
          return ok({ recorded: true })
        }
        const o = outreachRepo.add({ jobId: a.job_id ?? null, name: a.name, profileUrl: a.profile_url, role: a.role, channel: a.channel, message: a.message, status: a.status, notes: a.notes })
        if (a.status === 'sent') {
          const run = currentRun()
          if (run) patchRun({ messages: run.messages + 1 })
          addEvent({ kind: 'status', text: `Message sent to ${a.name} (${a.channel})` })
        }
        emit({ type: 'outreach-changed' })
        return ok({ recorded: true, id: o.id })
      }
    )
  )

  server.registerTool(
    'list_tracked_applications',
    {
      description:
        "Every application on the candidate's board that is past draft (and drafts with include_drafts): job_id, title, company, url, status, applied_at, archived, the people contacted for it, and emails_seen (email ids already processed: skip those). Use it to match recruiters' emails to applications.",
      inputSchema: { include_drafts: z.boolean().default(false) }
    },
    safe('list_tracked_applications', ({ include_drafts }: { include_drafts: boolean }) => {
      const contacts = new Map<number, string[]>()
      for (const o of outreachRepo.list({})) if (o.jobId != null && o.status === 'sent') contacts.set(o.jobId, [...(contacts.get(o.jobId) ?? []), `${o.name}${o.role ? ` (${o.role})` : ''}`])
      return ok(
        applicationsRepo
          .list()
          .filter((a) => include_drafts || a.status !== 'draft' || !!a.appliedAt)
          .slice(0, 400)
          .map((a) => ({
            job_id: a.jobId,
            title: a.job.title,
            company: a.job.company,
            url: a.job.url,
            status: a.status,
            applied_at: a.appliedAt,
            archived: !!a.archivedAt,
            contacted: contacts.get(a.jobId) ?? [],
            emails_seen: emailIdsInNotes(a.notes)
          }))
      )
    })
  )

  server.registerTool(
    'update_application_from_email',
    {
      description:
        "Record what a company's email says about an application, and move it on the board. status: 'scheduling' (they want an interview and a date/time is not confirmed yet: scheduling link, availability request), 'interview' (an interview date/time is confirmed, or an interview happened), 'offer', 'rejected', 'applied' (an application confirmation for a job not on the board yet), or 'no-change' (relevant but nothing changes, e.g. 'still reviewing'). Give job_id when the email matches a tracked application; for an application the candidate made outside the app, give company + title instead and it is added to the board. The same email_id is recorded only once.",
      inputSchema: {
        job_id: z.number().int().optional(),
        company: z.string().optional().describe('Only without job_id'),
        title: z.string().optional().describe('Only without job_id'),
        email_id: z.string().min(3).max(200).describe('Message or thread id from the mailbox (any stable id; for webmail, sender + date + subject)'),
        email_from: z.string().default(''),
        email_subject: z.string().default(''),
        email_date: z.string().default(''),
        email_url: z
          .string()
          .default('')
          .describe('Webmail runs: the address of the open message (from the address bar), so the candidate can open it from the board. Gmail connector: leave empty.'),
        status: z.enum(['applied', 'scheduling', 'interview', 'offer', 'rejected', 'no-change']),
        summary: z.string().min(1).describe('One or two sentences: what the email says'),
        next_step: z.string().default('').describe("What the candidate has to do, with any deadline or date (e.g. 'pick a slot at <link> by Friday', 'interview Tue 25 Nov 14:00 BRT')"),
        force: z.boolean().default(false).describe('Allow moving an application that is already offer/rejected')
      }
    },
    safe(
      'update_application_from_email',
      (a: {
        job_id?: number
        company?: string
        title?: string
        email_id: string
        email_from: string
        email_subject: string
        email_date: string
        email_url: string
        status: EmailStatus
        summary: string
        next_step: string
        force: boolean
      }) => {
        const emailId = a.email_id.trim().replace(/\s+/g, '_')
        let job: Job | null = a.job_id != null ? jobOrThrow(a.job_id) : null
        let created = false
        if (!job) {
          const company = a.company?.trim()
          const title = a.title?.trim()
          if (!company || !title) throw new Error('Give job_id, or company and title for an application made outside the app.')
          const key = normalizeCompany(company)
          const sameCompany = jobsRepo.list().filter((j) => normalizeCompany(j.company) === key)
          job = sameCompany.find((j) => j.title.trim().toLowerCase() === title.toLowerCase()) ?? null
          if (!job && sameCompany.length) {
            return ok({
              recorded: false,
              note: 'There are saved jobs at this company. If the email is about one of them, call again with its job_id; otherwise call again with the exact title.',
              jobs_at_company: sameCompany.map((j) => ({ job_id: j.id, title: j.title, status: applicationsRepo.getByJob(j.id)?.status ?? j.status }))
            })
          }
          if (!job) {
            job = jobsRepo.upsertCaptured({ url: `email:${emailId}`, linkedinId: null, title, company, location: '', description: '', easyApply: false }, 'applied')
            created = true
          }
        }
        const app = applicationsRepo.ensure(job.id)
        if (emailIdsInNotes(app.notes).includes(emailId)) return ok({ recorded: false, note: 'This email was already recorded for this application.' })
        // An email from the company means the candidate applied, even if the app had only a draft
        const current: ApplicationStatus = app.status === 'draft' ? 'applied' : app.status
        const move = statusMove(current, a.status, a.force)
        if (move.refused) return ok({ recorded: false, note: move.refused })
        const link = /^https?:\/\/\S+$/i.test(a.email_url.trim()) ? ` link ${a.email_url.trim()}` : ''
        const head = `Email ${emailId} (${[a.email_date, a.email_from].filter(Boolean).join(', ').replace(/[()]/g, '') || 'no date'})${link}`
        appendNote(
          job.id,
          `${head}: "${a.email_subject.slice(0, 200)}" — ${a.summary.slice(0, 600)}${a.next_step ? ` Next: ${a.next_step.slice(0, 300)}` : ''}${move.changed || app.status === 'draft' ? ` [→ ${STATUS_WORD[move.status]}]` : ''}`
        )
        if (app.status === 'draft') applicationsRepo.setStatus(app.id, 'applied')
        if (move.changed) applicationsRepo.setStatus(app.id, move.status)
        if (app.archivedAt && move.changed && move.status !== 'rejected') applicationsRepo.setArchived(app.id, false)
        jobsRepo.setStatus(job.id, 'applied')
        addEvent({
          kind: 'status',
          text: `${job.company} — ${job.title}: ${move.changed ? `${STATUS_WORD[app.status]} → ${STATUS_WORD[move.status]}` : 'email noted'}${created ? ' (added to the board)' : ''}`
        })
        emit({ type: 'applications-changed' })
        emit({ type: 'jobs-changed' })
        return ok({ recorded: true, job_id: job.id, created, status: move.status, changed: move.changed })
      }
    )
  )

  server.registerTool(
    'end_run',
    {
      description:
        "Ends the whole run for good. The app normally starts a fresh attempt when a run ends early (after an error, or a search short of its goal); call this first when continuing would be wrong: LinkedIn or a site warned about automated activity or restricted the account, the candidate asked to stop, or a human must fix something before any more work. Not for a single job that fails: record it and move on to the next one.",
      inputSchema: { reason: z.string().min(3).max(500) }
    },
    safe('end_run', ({ reason }: { reason: string }) => {
      runFlags.ended = reason.trim()
      addEvent({ kind: 'status', text: `The agent ended the run: ${reason.trim()}` })
      return ok({ ended: true, instruction: 'Write the short report now and finish.' })
    })
  )

  server.registerTool(
    'list_outreach',
    {
      description:
        'Messages already sent, by job and/or person (profile URL). Check before contacting anyone, to never message the same person twice. This only knows what the app recorded: also read the LinkedIn conversation before typing.',
      inputSchema: { job_id: z.number().int().optional(), profile_url: z.string().optional() }
    },
    safe('list_outreach', ({ job_id, profile_url }: { job_id?: number; profile_url?: string }) =>
      ok(
        outreachRepo
          .list({ jobId: job_id, profileUrl: profile_url })
          .slice(0, 100)
          .map((o) => ({ name: o.name, profile_url: o.profileUrl, role: o.role, channel: o.channel, status: o.status, at: o.createdAt, job_id: o.jobId, message: o.message }))
      )
    )
  )

  return server
}

let http: Server | null = null
let endpoint: { url: string; token: string } | null = null

/** Starts the MCP endpoint once (127.0.0.1, random port, bearer token) and returns how to reach it. */
export async function ensureMcpServer(): Promise<{ url: string; token: string }> {
  if (endpoint && http?.listening) return endpoint
  const token = randomBytes(24).toString('hex')
  const srv = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end()
      return
    }
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end()
      return
    }
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream / session deletion
      res.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    const mcp = buildMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(req, res)
    } catch (err) {
      logger.error('agent', `MCP request failed: ${(err as Error).message}`)
      if (!res.headersSent) res.writeHead(500).end()
    }
  })
  // ask_user can wait a long time for the candidate: never time out the request
  srv.requestTimeout = 0
  srv.keepAliveTimeout = 120_000
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => resolve())
  })
  http = srv
  endpoint = { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`, token }
  logger.info('agent', `App MCP server listening on ${endpoint.url}`)
  return endpoint
}

export function stopMcpServer(): void {
  http?.close()
  http = null
  endpoint = null
}
