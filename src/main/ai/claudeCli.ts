import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import * as z from 'zod/v4'
import type { CliStatus } from '@shared/types'
import { AiError, jsonSchemaOf, type CallUsage, type ChatRequest, type JsonRequest, type RawChatProvider, type Result } from './provider'

/**
 * Claude through your Claude subscription (Pro/Max), by running the Claude Code CLI in headless mode:
 * `claude -p --output-format json`. Usage counts against your plan's limits instead of per-token API billing.
 *
 * Safety/isolation of each call:
 * - `--tools ""`: no built-in tools (no shell, no file access) — it only generates text;
 * - `--strict-mcp-config` without `--mcp-config`: no MCP servers;
 * - `--setting-sources ""` + an empty working directory: none of your settings, hooks or CLAUDE.md files are loaded;
 * - `--no-session-persistence`: calls are not saved as resumable sessions;
 * - ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are removed from the environment so the subscription login is used.
 *   (`--bare` is not used on purpose: it only accepts API-key auth.)
 */

/** Shape of `claude -p --output-format json` (only the fields we use). */
const CliResultSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  api_error_status: z.unknown().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional()
    })
    .optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional()
})

export interface CliRunOptions {
  cliPath: string
  cwd: string
  timeoutMs?: number
}

/**
 * Turns the configured CLI command into a runnable path. Apps started from the desktop (Explorer, Finder, Dock)
 * often do not see PATH entries added after login — e.g. right after installing Claude Code — so when the
 * command is not found on PATH we also look in the native installer's default location (~/.local/bin).
 */
export function resolveCliPath(configured: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = homedir()): string {
  const cmd = (configured || 'claude').trim().replace(/^"(.*)"$/, '$1')
  if (isAbsolute(cmd) || /[\\/]/.test(cmd)) return cmd
  const exts = platform === 'win32' ? ['.exe', ''] : ['']
  const names = /\.[a-z]+$/i.test(cmd) ? [cmd] : exts.map((e) => cmd + e)
  const dirs = [...(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean), join(home, '.local', 'bin')]
  if (platform !== 'win32') dirs.push('/usr/local/bin', '/opt/homebrew/bin', join(home, '.claude', 'local'))
  for (const dir of dirs) for (const n of names) if (existsSync(join(dir, n))) return join(dir, n)
  return cmd
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.CLAUDE_CODE_SIMPLE
  return env
}

/** Runs the CLI with the prompt on stdin and returns stdout. Exported for tests. */
export function runCli(args: string[], stdin: string, opts: CliRunOptions): Promise<{ stdout: string; stderr: string; code: number | null }> {
  mkdirSync(opts.cwd, { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn(opts.cliPath, args, { cwd: opts.cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new AiError(`claude -p timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s.`))
    }, opts.timeoutMs ?? 10 * 60_000)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        new AiError(
          err.code === 'ENOENT'
            ? `Claude Code CLI not found ("${opts.cliPath}"). Install it and run "claude" once to log in, or set its path in Settings.`
            : `Could not start the Claude CLI: ${err.message}`
        )
      )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
    child.stdin.end(stdin)
  })
}

/** Parses the CLI's JSON output into a value + usage, or throws a user-facing AiError. */
export function parseCliOutput(stdout: string, stderr: string, code: number | null, requestedModel: string): { result: z.infer<typeof CliResultSchema>; usage: CallUsage } {
  let parsed: z.infer<typeof CliResultSchema> | null = null
  // Normally one JSON line; fall back to the last line in case the CLI printed anything before it
  const trimmed = stdout.trim()
  for (const candidate of [trimmed, trimmed.split('\n').filter(Boolean).pop() ?? '']) {
    try {
      const res = CliResultSchema.safeParse(JSON.parse(candidate))
      if (res.success && res.data.type === 'result') {
        parsed = res.data
        break
      }
    } catch {
      /* try the next candidate */
    }
  }
  if (!parsed) {
    const detail = (stderr || stdout).trim().slice(0, 400)
    throw new AiError(`claude -p failed${code != null ? ` (exit ${code})` : ''}${detail ? `: ${detail}` : '.'}`)
  }
  const u = parsed.usage ?? {}
  const servedModel = Object.keys(parsed.modelUsage ?? {})[0]
  const usage: CallUsage = {
    model: servedModel ?? requestedModel,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    reportedCostUsd: parsed.total_cost_usd ?? null
  }
  if (parsed.is_error || (parsed.subtype && parsed.subtype !== 'success')) {
    const msg = parsed.result?.trim() || parsed.subtype || 'unknown error'
    const e = new AiError(
      /limit|quota|rate/i.test(msg) ? `Claude subscription limit: ${msg}` : /log ?in|auth|credential/i.test(msg) ? `Claude CLI is not logged in: ${msg} — run "claude" in a terminal and log in.` : `claude -p error: ${msg}`
    )
    e.usage = usage
    throw e
  }
  return { result: parsed, usage }
}

export class ClaudeCliProvider implements RawChatProvider {
  readonly id = 'claude-cli'
  readonly billing = 'subscription' as const

  constructor(
    readonly model: string,
    private opts: CliRunOptions
  ) {}

  private baseArgs(system: string): string[] {
    return [
      '-p',
      '--output-format',
      'json',
      '--model',
      this.model,
      '--system-prompt',
      system,
      '--tools',
      '',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--no-session-persistence'
    ]
  }

  async completeRaw(req: ChatRequest): Promise<Result<string>> {
    const { stdout, stderr, code } = await runCli(this.baseArgs(req.system), req.prompt, this.opts)
    const { result, usage } = parseCliOutput(stdout, stderr, code, this.model)
    return { value: result.result ?? '', usage }
  }

  async jsonRaw<S extends z.ZodType>(req: JsonRequest<S>): Promise<Result<z.infer<S>>> {
    const schema = JSON.stringify(jsonSchemaOf(req.schema))
    const { stdout, stderr, code } = await runCli([...this.baseArgs(req.system), '--json-schema', schema], req.prompt, this.opts)
    const { result, usage } = parseCliOutput(stdout, stderr, code, this.model)
    const check = req.schema.safeParse(result.structured_output)
    if (!check.success) {
      const e = new AiError(`claude -p returned JSON in an unexpected shape: ${check.error.message.slice(0, 300)}`)
      e.usage = usage
      throw e
    }
    return { value: check.data, usage }
  }
}

/** `claude --version` + `claude auth status`, to show in Settings whether the subscription is usable. */
export async function cliStatus(opts: CliRunOptions): Promise<CliStatus> {
  const out: CliStatus = { found: false, loggedIn: false, authMethod: '', subscriptionType: '', version: '', error: '' }
  try {
    const v = await runCli(['--version'], '', { ...opts, timeoutMs: 20_000 })
    out.found = true
    out.version = v.stdout.trim()
    const a = await runCli(['auth', 'status'], '', { ...opts, timeoutMs: 20_000 })
    const json = a.stdout.slice(a.stdout.indexOf('{'), a.stdout.lastIndexOf('}') + 1)
    const st = JSON.parse(json || '{}') as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string }
    out.authMethod = st.authMethod ?? ''
    out.subscriptionType = st.subscriptionType ?? ''
    out.loggedIn = st.loggedIn ?? !!st.authMethod
    if (out.loggedIn && !/claude\.ai/i.test(out.authMethod)) {
      out.error = `The CLI is logged in with "${out.authMethod}", not a Claude subscription — calls may be billed to an API account.`
    }
  } catch (err) {
    out.error = (err as Error).message
  }
  return out
}
