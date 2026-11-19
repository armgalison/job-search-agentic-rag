import { describe, expect, it } from 'vitest'
import { defaultSettings, type AgentTask } from '@shared/types'
import { afterAttempt, isOutOfCredits, type AttemptEnd } from '../src/main/agent/retry'
import { taskPrompt } from '../src/main/agent/prompt'

const search: AgentTask = { mode: 'search', keywords: 'react', location: '', remote: true, easyApplyOnly: false, maxJobs: 5 }
const base: AttemptEnd = {
  task: search,
  settings: { ...defaultSettings.agent, maxApplicationsPerRun: 5, maxAttempts: 8 },
  attempt: 1,
  stopped: false,
  isError: true,
  output: 'Error: browser closed',
  applied: 1,
  idleAttempts: 0,
  budgetBlocked: null,
  agentEnded: null
}

describe('continuing a run after an attempt ends', () => {
  it('retries a search after an error, and when it ended short of its goal', () => {
    expect(afterAttempt(base).retry).toBe(true)
    expect(afterAttempt({ ...base, isError: false, output: 'Done, 1 applied' })).toMatchObject({ retry: true, reason: 'only 1 of 5 application(s) so far' })
  })

  it('stops when the goal is reached', () => {
    expect(afterAttempt({ ...base, applied: 5 })).toMatchObject({ retry: false, status: 'done' })
    // The goal is the smaller of the task's jobs and the per-run limit
    expect(afterAttempt({ ...base, applied: 2, settings: { ...base.settings, maxApplicationsPerRun: 2 } })).toMatchObject({ retry: false })
  })

  it('stops when the Claude credits or usage limit run out, or the budget blocks', () => {
    for (const msg of ['Claude AI usage limit reached|1763575200', "You've hit your limit · resets 3pm", 'Credit balance is too low']) {
      expect(isOutOfCredits(msg)).toBe(true)
      expect(afterAttempt({ ...base, output: msg })).toMatchObject({ retry: false, status: 'failed' })
    }
    expect(isOutOfCredits('Error: browser closed')).toBe(false)
    expect(afterAttempt({ ...base, budgetBlocked: 'Monthly budget reached' })).toMatchObject({ retry: false, reason: 'Monthly budget reached' })
  })

  it('never retries a stop, an end_run, or past the attempt limit', () => {
    expect(afterAttempt({ ...base, stopped: true })).toMatchObject({ retry: false, status: 'stopped' })
    expect(afterAttempt({ ...base, agentEnded: 'LinkedIn restricted the account' }).retry).toBe(false)
    expect(afterAttempt({ ...base, attempt: 8 }).retry).toBe(false)
    expect(afterAttempt({ ...base, settings: { ...base.settings, autoContinue: false } }).retry).toBe(false)
  })

  it('gives up after attempts in a row without a new application', () => {
    expect(afterAttempt({ ...base, idleAttempts: 2 }).retry).toBe(true)
    expect(afterAttempt({ ...base, idleAttempts: 3 }).retry).toBe(false)
  })

  it('retries other tasks only after an error', () => {
    const email: AgentTask = { mode: 'check-email', days: 7 }
    expect(afterAttempt({ ...base, task: email }).retry).toBe(true)
    expect(afterAttempt({ ...base, task: email, isError: false }).retry).toBe(false)
    expect(afterAttempt({ ...base, isError: false, settings: { ...base.settings, dryRun: true } }).retry).toBe(false)
  })

  it('tells the next attempt what was already done', () => {
    const p = taskPrompt(search, defaultSettings.agent, {
      today: '2026-11-19',
      continuation: { attempt: 2, maxAttempts: 8, applied: 1, target: 5, reason: 'the attempt ended with an error', lastOutput: 'browser closed' }
    })
    expect(p).toContain('CONTINUATION — attempt 2 of 8')
    expect(p).toContain('1 application(s) of the 5 asked for')
    expect(taskPrompt(search, defaultSettings.agent, { today: '2026-11-19' })).not.toContain('CONTINUATION')
  })
})
