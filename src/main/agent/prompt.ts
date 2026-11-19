import type { AgentSettings, AgentTask, Job, JobSource } from '@shared/types'

/**
 * Prompts for agent runs. Pure functions (unit-tested): the run's rules live in the job-agent plugin's skills;
 * these prompts only say what to do this time and with which limits.
 */

export const SYSTEM_APPEND = `You are the background agent of "Job Search RAG", a desktop app that applies to jobs on behalf of one candidate.
You control a real browser that the candidate can see, and the app's MCP server "jobsearch" (knowledge base, documents, bookkeeping, ask_user, request_permission).
Before doing anything else, load the skill "job-agent:job-agent" with the Skill tool and follow it. Load the other job-agent skills when it tells you to.
Never invent facts about the candidate. Only ask the candidate (ask_user) about missing knowledge or when a human must act (login, CAPTCHA, verification code).
Always call request_permission right before any final Submit / Send click, and obey the answer.
A problem with one job (a broken form, a closed job, a page that will not load, a tool error) never ends the run: record it (record_application status "failed" with what happened) and continue with the next job. Call end_run only when continuing would be wrong (a site restricted the account, the candidate asked to stop).
Write your progress as short plain-text lines (no Markdown headings, no emoji), in English.`

export function describeLimits(s: AgentSettings): string {
  return [
    `- Minimum fit score to apply: ${s.minScore}%.`,
    `- At most ${s.maxApplicationsPerRun} application(s) and ${s.maxMessagesPerRun} outreach message(s) in this run (request_permission enforces this).`,
    s.outreach ? '- After applying, find the job poster / recruiter / hiring manager and message them (find-contacts → outreach-message → send-linkedin-message).' : '- Do NOT contact anyone in this run (outreach is off).',
    s.alwaysCoverLetter ? '- Always write a cover letter, even when the form has no field for it (upload it if there is any attachment field).' : '- Write a cover letter only when the application has a cover letter field or upload.',
    s.dryRun ? '- DRY RUN: fill everything, but request_permission will refuse every final Submit/Send. Record those as skipped.' : '',
    s.instructions.trim()
      ? `- Candidate's standing instructions: ${s.instructions.trim()}\n  If they rule out companies, jobs, title keywords or people, call add_to_blacklist for each one at the start of the run.`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Which skill runs each search source (agent-plugin/skills/<skill>/SKILL.md). */
export const SEARCH_SOURCES: Record<JobSource, { where: string; skill: string }> = {
  linkedin: { where: 'LinkedIn Jobs', skill: 'find-jobs' },
  'remote-boards': { where: 'remote job boards (Himalayas, Get on Board, Remotive, We Work Remotely, Working Nomads, Work at a Startup)', skill: 'find-jobs-remote-boards' },
  wellfound: { where: 'Wellfound (startup jobs)', skill: 'find-jobs-wellfound' },
  google: { where: 'Google (company career sites and ATS job boards)', skill: 'find-jobs-google' },
  'funded-startups': { where: 'startups that recently raised funding, and their open roles', skill: 'find-funded-startups' }
}

const jobLine = (j: Pick<Job, 'id' | 'title' | 'company' | 'url' | 'linkedinId'>) =>
  `job #${j.id}: ${j.title || '(untitled)'} — ${j.company || '?'} — ${j.linkedinId ? `https://www.linkedin.com/jobs/view/${j.linkedinId}/` : j.url}`

/** A fresh attempt of a run whose earlier attempt ended early (see retry.ts) */
export interface Continuation {
  attempt: number
  maxAttempts: number
  /** Applications made so far in this run */
  applied: number
  target: number | null
  /** Why the previous attempt ended, and the end of its output */
  reason: string
  lastOutput: string
}

export function continuationNote(c: Continuation): string {
  const last = c.lastOutput.trim().slice(-600)
  return `

CONTINUATION — attempt ${c.attempt} of ${c.maxAttempts}. The previous attempt of this run ended early (${c.reason}).${last ? `\nIts last output:\n${last}` : ''}
So far this run made ${c.applied} application(s)${c.target != null ? ` of the ${c.target} asked for` : ''}; they count toward the limits.
Do not redo work: the app remembers every job already saved, applied to, failed or skipped (check_jobs, alreadyApplied, list_jobs). Skip those, start with jobs not tried yet, and use queries not run yet. If the same job or site failed before, do not retry it: record it as failed and move on. The browser may still show the previous page; start from a clean tab.`
}

export function taskPrompt(task: AgentTask, s: AgentSettings, ctx: { today: string; job?: Job | null; blacklist?: string; continuation?: Continuation }): string {
  return taskBody(task, s, ctx) + (ctx.continuation ? continuationNote(ctx.continuation) : '')
}

function taskBody(task: AgentTask, s: AgentSettings, ctx: { today: string; job?: Job | null; blacklist?: string }): string {
  const banned = ctx.blacklist?.trim()
    ? `Blacklist (the candidate's explicit "no"; never apply, never contact, don't even open these; check_jobs, save_job and request_permission enforce it):\n${ctx.blacklist.trim()}\n\n`
    : ''
  const head = `Today is ${ctx.today}.\n\nRun limits and options:\n${describeLimits(s)}\n\n${banned}`
  switch (task.mode) {
    case 'apply-job': {
      const target = ctx.job ? jobLine(ctx.job) : task.url
      if (!target) throw new Error('Pick a job or paste a job URL.')
      return `${head}TASK: Run the full pipeline for this one job: ${target}
Open it, save and analyze it, close the important gaps, prepare the tailored resume, apply (Easy Apply or the company site)${s.outreach ? ', then reach out to the right people' : ''}. Finish with the short report.`
    }
    case 'search': {
      const source = SEARCH_SOURCES[task.source ?? 'linkedin']
      const months = Math.max(1, task.fundedWithinMonths ?? 6)
      const filters = [
        task.location && `location "${task.location}"`,
        task.remote && 'remote only',
        task.easyApplyOnly && (task.source ?? 'linkedin') === 'linkedin' && 'Easy Apply only',
        task.source === 'funded-startups' && `funding round announced in the last ${months} month(s)`
      ]
        .filter(Boolean)
        .join(', ')
      return `${head}TASK: Search ${source.where} for "${task.keywords || "(use the candidate's target roles)"}"${filters ? ` (${filters})` : ''}.
Load the ${source.skill} skill and the search-strategy skill to collect and score candidates, then run the full pipeline for the best ${Math.max(1, task.maxJobs)} job(s) at or above the minimum score, best fit first.
Keep searching (more queries, more pages, more locations) until you have ${Math.max(1, task.maxJobs)} application(s) or the search-strategy budget is used up. Weak results on one query are a reason to try the next query, not to stop. Finish with the short report, including the queries you ran and how many new results each gave.`
    }
    case 'outreach': {
      if (!ctx.job) throw new Error('Job not found.')
      return `${head}TASK: Outreach only, for ${jobLine(ctx.job)}. Do not apply.
Open the job, then use find-contacts, outreach-message and send-linkedin-message to contact up to 3 people (job poster first). Finish with the short report.`
    }
    case 'check-email': {
      const days = Math.max(1, Math.min(90, Math.round(task.days || 14)))
      const inbox =
        s.emailSource === 'gmail-connector'
          ? `Read the inbox through the Gmail connector. In this run MCP tools load on demand: use ToolSearch to load the jobsearch tools you need (list_tracked_applications, update_application_from_email, ask_user) and the read-only Gmail tools (search_threads, get_thread, get_message). Never send, draft, label or delete anything.`
          : `Read the inbox in the browser: open ${s.webmailUrl || 'the candidate\'s webmail'} (if it asks for a login, ask_user with kind "action"). Only read; never send, reply, move or delete anything.`
      return `${head}TASK: Check the candidate's email for replies to job applications from the last ${days} day(s) and update the applications board.
${inbox}
Load the check-email skill and follow it. Do not apply to jobs or contact anyone in this run. Finish with the short report: emails read, applications moved (from → to, with the email that justified it), and replies you could not match to an application.`
    }
    case 'custom':
      if (!task.instructions.trim()) throw new Error('Write what the agent should do.')
      return `${head}TASK (from the candidate): ${task.instructions.trim()}\nFollow the job-agent skill's ground rules while doing it. Finish with the short report.`
  }
}
