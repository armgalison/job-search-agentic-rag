import type { AgentSettings, AgentTask } from '@shared/types'

/**
 * Pure rules (unit-tested) for continuing a run after an attempt ends: an error on one job, a crash or a lost
 * browser must not end a search run. The run keeps going, in a fresh `claude -p` attempt, until it has the
 * applications it was asked for, the Claude credits / usage limit or the app budget run out, the agent says it must
 * stop for good (end_run), or it stops making progress.
 */

/** Claude Code's messages when the subscription usage limit or the API credits are used up */
const OUT_OF_CREDITS =
  /usage limit|hit your (usage )?limit|limit reached|limit will reset|resets? (at|in) \d|credit balance is too low|insufficient (credits|quota|funds)|out of (extra )?(usage|credits)|billing (error|issue)|exceeded your (current )?quota/i

export const isOutOfCredits = (text: string): boolean => OUT_OF_CREDITS.test(text)

/** How many applications the task asks for (null = the task has no application goal). */
export function applicationTarget(task: AgentTask, s: Pick<AgentSettings, 'maxApplicationsPerRun'>): number | null {
  if (task.mode === 'search') return Math.max(1, Math.min(task.maxJobs, s.maxApplicationsPerRun))
  if (task.mode === 'apply-job') return 1
  return null
}

/** Consecutive attempts without a new application after which the run gives up */
export const MAX_IDLE_ATTEMPTS = 3

export interface AttemptEnd {
  task: AgentTask
  settings: Pick<AgentSettings, 'autoContinue' | 'maxAttempts' | 'maxApplicationsPerRun' | 'dryRun'>
  /** Attempt that just ended (1-based) */
  attempt: number
  /** The candidate pressed Stop */
  stopped: boolean
  /** The attempt ended with an error, or without a result */
  isError: boolean
  /** Final result text and the tail of stderr */
  output: string
  /** Applications granted in the whole run so far */
  applied: number
  /** Attempts in a row (including this one) that added no application */
  idleAttempts: number
  /** Set when the app budget blocks further spending */
  budgetBlocked: string | null
  /** Set when the agent called end_run (must not be retried: LinkedIn restriction, the candidate said stop…) */
  agentEnded: string | null
}

export type Decision = { retry: true; reason: string } | { retry: false; reason: string; status: 'done' | 'failed' | 'stopped' }

export function afterAttempt(e: AttemptEnd): Decision {
  const end = (reason: string, status: 'done' | 'failed' | 'stopped' = e.isError ? 'failed' : 'done'): Decision => ({ retry: false, reason, status })
  if (e.stopped) return end('Stopped by the candidate.', 'stopped')
  if (e.agentEnded) return end(`The agent ended the run: ${e.agentEnded}`)
  if (e.isError && isOutOfCredits(e.output)) return end('Claude usage limit or credits used up. Start the run again when they reset.', 'failed')
  if (e.budgetBlocked) return end(e.budgetBlocked, 'failed')
  const target = applicationTarget(e.task, e.settings)
  if (target != null && e.applied >= target) return end(`Goal reached: ${e.applied} application(s).`, 'done')
  // Only a search has more jobs to try after a clean finish; other tasks retry only after an error
  if (!e.isError && (e.task.mode !== 'search' || e.settings.dryRun)) return end('Finished.')
  if (!e.settings.autoContinue) return end(e.isError ? 'The attempt failed (automatic continue is off).' : 'Finished.')
  if (e.attempt >= Math.max(1, e.settings.maxAttempts)) return end(`Gave up after ${e.attempt} attempt(s).`)
  if (e.idleAttempts >= MAX_IDLE_ATTEMPTS) return end(`${e.idleAttempts} attempts in a row without a new application: no more jobs to apply to for now.`)
  return {
    retry: true,
    reason: e.isError ? 'the attempt ended with an error' : `only ${e.applied} of ${target} application(s) so far`
  }
}
