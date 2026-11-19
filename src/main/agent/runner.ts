import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { AgentRunInfo, AgentTask } from '@shared/types'
import { cliOptions } from '../ai'
import { cleanEnv } from '../ai/claudeCli'
import { effectivePrices } from '../ai/pricing'
import { blacklistRepo, jobsRepo } from '../db/repos'
import { logger } from '../log'
import { getSettings } from '../settings'
import { budgetBlock, recordUsage } from '../usage'
import { ensureMcpServer } from './mcpServer'
import { agentWorkspace, browserProfileDir, playwrightMcpCli, pluginDir } from './paths'
import { taskPrompt } from './prompt'
import { describeBlacklist } from './blacklist'
import { agentArgs, mcpConfig } from './args'
import { addEvent, beginRun, currentRun, endRun } from './session'
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

export async function startAgent(task: AgentTask): Promise<AgentRunInfo> {
  if (child && currentRun()?.status === 'running') throw new Error('An agent run is already in progress. Stop it first.')
  const settings = getSettings()
  const s = settings.agent
  const blocked = budgetBlock(settings.budget, 'subscription')
  if (blocked) throw new Error(blocked)

  let job = null
  if ((task.mode === 'apply-job' || task.mode === 'outreach') && task.jobId) {
    job = jobsRepo.get(task.jobId)
    if (!job) throw new Error('Job not found.')
  }
  const prompt = taskPrompt(task, s, { today: new Date().toISOString().slice(0, 10), job, blacklist: describeBlacklist(blacklistRepo.list()) })

  const plugin = pluginDir()
  if (!existsSync(plugin)) throw new Error(`Agent skills not found at ${plugin}.`)
  const workspace = agentWorkspace()
  mkdirSync(workspace, { recursive: true })
  mkdirSync(browserProfileDir(), { recursive: true })
  const endpoint = await ensureMcpServer()
  const cfg = mcpConfig(s, endpoint, { node: process.execPath, cli: s.browser === 'claude-in-chrome' ? '' : playwrightMcpCli(), profileDir: browserProfileDir(), outputDir: workspace })
  const args = agentArgs(s, plugin, JSON.stringify(cfg), task)
  const { cliPath } = cliOptions()

  const run = beginRun(task)
  stopping = false
  addEvent({ kind: 'status', text: `Starting the agent (${s.model}, ${s.browser === 'claude-in-chrome' ? 'Claude in Chrome' : `Playwright + ${s.browser === 'msedge' ? 'Edge' : 'Chrome'}`})…`, detail: prompt })
  logger.info('agent', `Run ${run.runId} started`, { task, model: s.model, browser: s.browser })

  const proc = spawn(cliPath, args, {
    cwd: workspace,
    env: { ...cleanEnv(), MCP_TOOL_TIMEOUT: String(3 * 60 * 60_000), MCP_TIMEOUT: '90000' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  child = proc
  const parser = new StreamParser()
  let stderr = ''

  createInterface({ input: proc.stdout! }).on('line', (line) => {
    for (const ev of parser.parseLine(line)) addEvent(ev)
  })
  proc.stderr!.on('data', (d) => {
    stderr += d
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
  })
  proc.on('error', (err: NodeJS.ErrnoException) => {
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
    const status = stopping ? 'stopped' : r && !r.isError ? 'done' : 'failed'
    endRun(status, r?.text ?? (stopping ? 'Stopped by the candidate.' : stderr.trim().split('\n').pop() ?? ''), r?.costUsd ?? null)
    logger.info('agent', `Run ${run.runId} ${status}`)
  })
  proc.stdin!.end(prompt)
  return currentRun()!
}

export function stopAgent(): void {
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
