import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentQuestion, AgentQuestionKind, AgentRunInfo, AgentState, AgentTask } from '@shared/types'
import { emit } from '../events'
import { logger } from '../log'

/**
 * State of the (single) agent run: its events, the questions waiting for the candidate, and the counters
 * request_permission uses to enforce per-run limits. Shared by the runner and the MCP server.
 */

const MAX_EVENTS = 3000
let run: AgentRunInfo | null = null
let events: AgentEvent[] = []
let seq = 0
const pending = new Map<string, { q: AgentQuestion; resolve: (answer: string) => void }>()
/** Final Submit/Send clicks granted in this run */
export const granted = { application: 0, message: 0 }

let onQuestion: (q: AgentQuestion) => void = () => {}
/** Lets the main process notify the user (OS notification, focus the window) when the agent asks something. */
export function setQuestionNotifier(fn: (q: AgentQuestion) => void): void {
  onQuestion = fn
}

export function currentRun(): AgentRunInfo | null {
  return run
}

export function agentState(): AgentState {
  return { run, questions: [...pending.values()].map((p) => p.q), events: events.slice(-800) }
}

const pushState = () => emit({ type: 'agent-state', state: { run, questions: [...pending.values()].map((p) => p.q), events: [] } })

export function beginRun(task: AgentTask): AgentRunInfo {
  run = { runId: randomUUID(), task, startedAt: new Date().toISOString(), endedAt: null, status: 'running', applications: 0, messages: 0, costUsd: null, summary: '' }
  events = []
  granted.application = 0
  granted.message = 0
  pushState()
  return run
}

export function endRun(status: AgentRunInfo['status'], summary: string, costUsd: number | null): void {
  if (!run) return
  run = { ...run, status, summary, costUsd, endedAt: new Date().toISOString() }
  // Nobody is left to read pending answers
  for (const [id, p] of pending) {
    p.resolve('The run was stopped; no answer.')
    pending.delete(id)
  }
  pushState()
}

export function patchRun(patch: Partial<Pick<AgentRunInfo, 'applications' | 'messages'>>): void {
  if (!run) return
  run = { ...run, ...patch }
  pushState()
}

export function addEvent(e: Omit<AgentEvent, 'runId' | 'seq' | 'ts'>): AgentEvent {
  const ev: AgentEvent = { ...e, runId: run?.runId ?? '', seq: ++seq, ts: new Date().toISOString() }
  events.push(ev)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  emit({ type: 'agent', event: ev })
  const line = ev.tool ? `${ev.tool}: ${ev.text}` : ev.text
  if (ev.kind === 'error') logger.error('agent', line.slice(0, 500), ev.detail)
  else if (ev.kind !== 'tool-result') logger.info('agent', line.slice(0, 500))
  return ev
}

/** Blocks until the candidate answers in the app (or the run ends). */
export function ask(kind: AgentQuestionKind, question: string, reason: string, options: string[], jobId: number | null): Promise<string> {
  if (!run || run.status !== 'running') return Promise.resolve('No agent run is active.')
  const q: AgentQuestion = { id: randomUUID(), runId: run.runId, kind, question, reason, options, jobId, createdAt: new Date().toISOString() }
  addEvent({ kind: 'question', text: question, detail: reason || undefined })
  return new Promise((resolve) => {
    pending.set(q.id, { q, resolve })
    pushState()
    try {
      onQuestion(q)
    } catch {
      /* notifications are best effort */
    }
  })
}

export function answer(questionId: string, text: string): void {
  const p = pending.get(questionId)
  if (!p) throw new Error('This question is no longer pending.')
  pending.delete(questionId)
  addEvent({ kind: 'answer', text: text || '(no answer)' })
  p.resolve(text)
  pushState()
}
