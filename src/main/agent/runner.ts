import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { AgentRunInfo, AgentTask, Job } from '@shared/types'
import { cliOptions } from '../ai'
import { cleanEnv } from '../ai/claudeCli'
import { effectivePrices } from '../ai/pricing'
import { blacklistRepo, jobsRepo } from '../db/repos'
import { logger } from '../log'
import { getSettings } from '../settings'
import { budgetBlock, recordUsage } from '../usage'
import { ensureMcpServer } from './mcpServer'
import { agentWorkspace, browserProfileDir, playwrightMcpCli, pluginDir } from './paths'
import { taskPrompt, type Continuation } from './prompt'
import { afterAttempt, applicationTarget } from './retry'
import { describeBlacklist } from './blacklist'
import { agentArgs, mcpConfig } from './args'
import { addEvent, beginRun, currentRun, endRun, granted, patchRun, runFlags } from './session'
import { StreamParser } from './stream'

/**
 * Runs Claude Code headless (`claude -p`) as the job agent:
 * - skills come from the bundled job-agent plugin (--plugin-dir), and nothing else of the user's setup is loaded
 *   (--setting-sources "", --strict-mcp-config, an app-owned empty working directory);
 * - built-in tools are limited to Skill + TodoWrite (no shell, no file edits);
 * - MCP servers: the app's own "jobsearch" server (HTTP, token) and either Playwright MCP driving a visible
 *   Chrome/Edge with a persistent profile, or the Claude in Chrome extension (--chrome);
 * - --permission-mode dontAsk + --allowedTools: only those tools run, nothing prompts.
 * Its stream-json output becomes live events on the Agent page.
 */

let child: ChildProcess | null = null
let stopping = false
/** Pending relaunch between two attempts */
let retryTimer: NodeJS.Timeout | null = null
/** Pause before a new attempt (lets the old browser and MCP servers exit) */
const RETRY_DELAY_MS = 15_000

export async function startAgent(task: AgentTask): Promise<AgentRunInfo> {
  if ((child || retryTimer) && currentRun()?.status === 'running') throw new Error('An agent run is already in progress. Stop it first.')
  const settings = getSettings()
  const blocked = budgetBlock(settings.budget, 'subscription')
  if (blocked) throw new Error(blocked)

  let job = null
  if ((task.mode === 'apply-job' || task.mode === 'outreach') && task.jobId) {
    job = jobsRepo.get(task.jobId)
    if (!job) throw new Error('Job not found.')
  }
  // Validates the task before anything starts (throws a readable error)
  taskPrompt(task, settings.agent, { today: today(), job, blacklist: '' })
  const plugin = pluginDir()
  if (!existsSync(plugin)) throw new Error(`Agent skills not found at ${plugin}.`)

  beginRun(task)
  stopping = false
  const maxAttempts = settings.agent.autoContinue ? Math.max(1, settings.agent.maxAttempts) : 1
  patchRun({ attempt: 1, maxAttempts })
  try {
    await launchAttempt(task, job, { attempt: 1, idle: 0, totalCost: null, appliedBefore: 0 })
  } catch (err) {
    endRun('failed', (err as Error).message, null)
    throw err
  }
  return currentRun()!
}

const today = () => new Date().toISOString().slice(0, 10)

interface AttemptState {
  attempt: number
  /** Attempts in a row before this one that added no application */
  idle: number
  totalCost: number | null
  /** Applications granted before this attempt */
  appliedBefore: number
  continuation?: Continuation
}

async function launchAttempt(task: AgentTask, job: Job | null, st: AttemptState): Promise<void> {
  const settings = getSettings()
  const s = settings.agent
  const prompt = taskPrompt(task, s, { today: today(), job, blacklist: describeBlacklist(blacklistRepo.list()), continuation: st.continuation })
  const workspace = agentWorkspace()
  mkdirSync(workspace, { recursive: true })
  mkdirSync(browserProfileDir(), { recursive: true })
  const endpoint = await ensureMcpServer()
  const cfg = mcpConfig(s, endpoint, { node: process.execPath, cli: s.browser === 'claude-in-chrome' ? '' : playwrightMcpCli(), profileDir: browserProfileDir(), outputDir: workspace })
  const args = agentArgs(s, pluginDir(), JSON.stringify(cfg), task)
  const { cliPath } = cliOptions()
  const runId = currentRun()?.runId

  patchRun({ attempt: st.attempt })
  addEvent({
    kind: 'status',
    text:
      st.attempt === 1
        ? `Starting the agent (${s.model}, ${s.browser === 'claude-in-chrome' ? 'Claude in Chrome' : `Playwright + ${s.browser === 'msedge' ? 'Edge' : 'Chrome'}`})…`
        : `Attempt ${st.attempt} of ${currentRun()?.maxAttempts ?? s.maxAttempts}: continuing the run…`,
    detail: prompt
  })
  logger.info('agent', `Run ${runId} attempt ${st.attempt} started`, { task, model: s.model, browser: s.browser })

  const proc = spawn(cliPath, args, {
    cwd: workspace,
    env: { ...cleanEnv(), MCP_TOOL_TIMEOUT: String(3 * 60 * 60_000), MCP_TIMEOUT: '90000' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  child = proc
  const parser = new StreamParser()
  let stderr = ''
  let spawnFailed = false

  createInterface({ input: proc.stdout! }).on('line', (line) => {
    for (const ev of parser.parseLine(line)) addEvent(ev)
  })
  proc.stderr!.on('data', (d) => {
    stderr += d
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
  })
  proc.on('error', (err: NodeJS.ErrnoException) => {
    spawnFailed = true
    addEvent({
      kind: 'error',
      isError: true,
      text: err.code === 'ENOENT' ? `Claude Code CLI not found ("${cliPath}"). Install it and log in, or set its path in Settings.` : `Could not start Claude Code: ${err.message}`
    })
  })
  proc.on('close', (code) => {
    child = null
    const r = parser.result
    if (r) {
      recordUsage(
        {
          provider: 'claude-cli',
          model: r.model ?? s.model,
          operation: 'agent',
          billing: 'subscription',
          ...r.usage,
          reportedCostUsd: r.costUsd,
          ok: !r.isError,
          error: r.isError ? r.text.slice(0, 500) : ''
        },
        effectivePrices(settings.prices)
      )
    } else if (!stopping) {
      addEvent({ kind: 'error', isError: true, text: `Claude Code exited (code ${code}) without a result.`, detail: stderr.trim().slice(-4000) || undefined })
    }
    const totalCost = r?.costUsd != null ? (st.totalCost ?? 0) + r.costUsd : st.totalCost
    patchRun({ costUsd: totalCost })
    const applied = granted.application
    const idle = applied > st.appliedBefore ? 0 : st.idle + 1
    const output = `${r?.text ?? ''}\n${stderr.trim().slice(-2000)}`
    const decision = afterAttempt({
      task,
      settings: { ...getSettings().agent, maxAttempts: currentRun()?.maxAttempts ?? 1 },
      attempt: st.attempt,
      stopped: stopping,
      // A missing CLI will not appear by retrying
      isError: !r || r.isError,
      output,
      applied,
      idleAttempts: idle,
      budgetBlocked: budgetBlock(getSettings().budget, 'subscription'),
      agentEnded: spawnFailed ? 'Claude Code could not start.' : runFlags.ended
    })
    logger.info('agent', `Run ${runId} attempt ${st.attempt} ended: ${decision.retry ? `retrying (${decision.reason})` : decision.reason}`)

    if (!decision.retry) {
      const summary = r?.text?.trim() || (stopping ? 'Stopped by the candidate.' : stderr.trim().split('\n').pop() ?? '')
      const note = decision.reason === 'Finished.' || decision.status === 'stopped' ? '' : `\n\n${decision.reason}${st.attempt > 1 ? ` (${st.attempt} attempts)` : ''}`
      endRun(decision.status, `${summary}${note}`.trim(), totalCost)
      return
    }
    addEvent({ kind: 'status', text: `The attempt ended early (${decision.reason}). Continuing in ${RETRY_DELAY_MS / 1000}s with a fresh attempt…` })
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (stopping || currentRun()?.runId !== runId) return
      const next = st.attempt + 1
      launchAttempt(task, job, {
        attempt: next,
        idle,
        totalCost,
        appliedBefore: applied,
        continuation: {
          attempt: next,
          maxAttempts: currentRun()?.maxAttempts ?? next,
          applied,
          target: applicationTarget(task, getSettings().agent),
          reason: decision.reason,
          lastOutput: output
        }
      }).catch((err: Error) => {
        addEvent({ kind: 'error', isError: true, text: `Could not continue the run: ${err.message}` })
        endRun('failed', err.message, totalCost)
      })
    }, RETRY_DELAY_MS)
  })
  proc.stdin!.end(prompt)
}

export function stopAgent(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
    stopping = true
    addEvent({ kind: 'status', text: 'Stopped before the next attempt.' })
    endRun('stopped', 'Stopped by the candidate.', currentRun()?.costUsd ?? null)
    return
  }
  if (!child) return
  stopping = true
  addEvent({ kind: 'status', text: 'Stopping…' })
  child.kill()
  // Windows: kill() only ends claude itself; its MCP children exit when their stdio closes
}

/** Checks that Playwright MCP can start (Settings → Agent → Check). */
export function checkBrowser(): Promise<{ ok: boolean; detail: string }> {
  const s = getSettings().agent
  if (s.browser === 'claude-in-chrome')
    return Promise.resolve({ ok: true, detail: 'Uses the Claude in Chrome extension: install it in Chrome and sign in with the same Claude account as the CLI.' })
  return new Promise((resolve) => {
    let out = ''
    let cli: string
    try {
      cli = playwrightMcpCli()
    } catch (err) {
      resolve({ ok: false, detail: `Playwright MCP is missing: ${(err as Error).message}` })
      return
    }
    const p = spawn(process.execPath, [cli, '--version'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true })
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('error', (err) => resolve({ ok: false, detail: err.message }))
    p.on('close', (code) =>
      resolve(
        code === 0
          ? { ok: true, detail: `Playwright MCP ${out.trim()} ready. It opens your installed ${s.browser === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'} with its own profile (${browserProfileDir()}).` }
          : { ok: false, detail: out.trim().slice(0, 500) || `exit ${code}` }
      )
    )
  })
}
