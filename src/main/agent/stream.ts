import type { AgentEventKind } from '@shared/types'

/**
 * Turns `claude -p --output-format stream-json --verbose` lines into short, human-readable events for the
 * Agent page. Pure (no Electron), so it is unit-tested.
 */

export interface ParsedEvent {
  kind: AgentEventKind
  text: string
  tool?: string
  detail?: string
  isError?: boolean
}

export interface StreamResult {
  isError: boolean
  text: string
  costUsd: number | null
  model: string | null
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const DETAIL_MAX = 6000

/** "mcp__browser__browser_click" → "browser · click"; "mcp__jobsearch__save_job" → "app · save_job" */
export function prettyToolName(name: string): string {
  const m = name.match(/^mcp__([^_]+(?:-[^_]+)*)__(.+)$/)
  if (!m) return name
  const server = m[1] === 'jobsearch' ? 'app' : m[1] === 'claude-in-chrome' ? 'chrome' : m[1]
  return `${server} · ${m[2].replace(/^browser_/, '')}`
}

/** One-line summary of a tool call's input (URL for navigation, element for clicks, etc.). */
export function summarizeToolInput(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {}
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const short = name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '')
  if (name === 'Skill') return str('skill')
  if (/navigate/.test(short)) return str('url')
  if (/click|hover/.test(short)) return str('element') || str('ref')
  if (/type/.test(short)) return `${str('element')}: "${clip(str('text'), 60)}"`
  if (/fill_form/.test(short) && Array.isArray(i.fields)) return `${(i.fields as unknown[]).length} field(s)`
  if (/select_option/.test(short)) return `${str('element')} → ${JSON.stringify(i.values ?? '')}`
  if (/file_upload/.test(short)) return Array.isArray(i.paths) ? (i.paths as string[]).map((p) => p.split(/[\\/]/).pop()).join(', ') : ''
  if (short === 'ask_user') return clip(str('question'), 140)
  if (short === 'request_permission') return `${str('kind')}: ${clip(str('summary'), 100)}`
  if (short === 'search_knowledge' && Array.isArray(i.queries)) return clip((i.queries as string[]).join(' | '), 140)
  if (short === 'save_job') return `${str('title')} — ${str('company')}`
  if (short === 'record_application') return `job #${i.job_id}: ${str('status')}`
  if (short === 'record_outreach') return `${str('name')} (${str('channel')}): ${str('status')}`
  if (short === 'TodoWrite') return ''
  const json = JSON.stringify(i)
  return json === '{}' ? '' : clip(json, 140)
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((c: { type?: string; text?: string }) => (c?.type === 'text' ? (c.text ?? '') : c?.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n')
  return ''
}

/** Keeps tool_use ids → names across lines, so results can be labeled with the tool that produced them. */
export class StreamParser {
  private toolNames = new Map<string, string>()
  result: StreamResult | null = null

  parseLine(line: string): ParsedEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    let o: Record<string, unknown>
    try {
      o = JSON.parse(trimmed)
    } catch {
      return [{ kind: 'status', text: clip(trimmed, 300) }]
    }
    return this.parse(o)
  }

  parse(o: Record<string, unknown>): ParsedEvent[] {
    const out: ParsedEvent[] = []
    switch (o.type) {
      case 'system': {
        if (o.subtype !== 'init') return []
        const servers = (o.mcp_servers as { name: string; status: string }[] | undefined) ?? []
        const skills = ((o.skills as string[] | undefined) ?? []).filter((s) => s.startsWith('job-agent:'))
        out.push({
          kind: 'status',
          text: `Session started · model ${o.model ?? '?'} · ${skills.length} skills · MCP: ${servers.map((s) => `${s.name} (${s.status})`).join(', ') || 'none'}`,
          detail: JSON.stringify({ tools: o.tools, skills, mcp_servers: servers }, null, 1)
        })
        for (const s of servers) {
          if (s.status !== 'connected') out.push({ kind: 'error', text: `MCP server "${s.name}" is ${s.status}.`, isError: true })
        }
        return out
      }
      case 'assistant': {
        const content = ((o.message as { content?: unknown[] })?.content ?? []) as {
          type: string
          text?: string
          id?: string
          name?: string
          input?: Record<string, unknown>
        }[]
        for (const c of content) {
          if (c.type === 'text' && c.text?.trim()) out.push({ kind: 'text', text: c.text.trim() })
          else if (c.type === 'tool_use' && c.name) {
            if (c.id) this.toolNames.set(c.id, c.name)
            if (c.name === 'Skill') out.push({ kind: 'skill', text: `Using skill ${summarizeToolInput(c.name, c.input)}`, tool: 'Skill' })
            else
              out.push({
                kind: 'tool',
                tool: prettyToolName(c.name),
                text: summarizeToolInput(c.name, c.input),
                detail: clip(JSON.stringify(c.input ?? {}, null, 1), DETAIL_MAX)
              })
          }
        }
        return out
      }
      case 'user': {
        const content = ((o.message as { content?: unknown[] })?.content ?? []) as {
          type: string
          tool_use_id?: string
          content?: unknown
          is_error?: boolean
        }[]
        if (!Array.isArray(content)) return []
        for (const c of content) {
          if (c.type !== 'tool_result') continue
          const name = (c.tool_use_id && this.toolNames.get(c.tool_use_id)) || 'tool'
          if (name === 'Skill' || name === 'TodoWrite') continue
          const text = resultText(c.content)
          out.push({
            kind: 'tool-result',
            tool: prettyToolName(name),
            text: clip(text.replace(/\s+/g, ' ').trim(), 200) || (c.is_error ? 'error' : 'ok'),
            detail: clip(text, DETAIL_MAX),
            isError: !!c.is_error
          })
        }
        return out
      }
      case 'result': {
        const u = (o.usage as Record<string, number> | undefined) ?? {}
        const model = Object.keys((o.modelUsage as Record<string, unknown> | undefined) ?? {})[0] ?? null
        const isError = !!o.is_error || (typeof o.subtype === 'string' && o.subtype !== 'success')
        this.result = {
          isError,
          text: typeof o.result === 'string' ? o.result : String(o.subtype ?? ''),
          costUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
          model,
          usage: {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u.cache_creation_input_tokens ?? 0
          }
        }
        out.push({ kind: isError ? 'error' : 'result', text: this.result.text.trim() || (isError ? 'The run ended with an error.' : 'Done.'), isError })
        return out
      }
      default:
        return []
    }
  }
}
