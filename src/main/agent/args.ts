import type { AgentSettings, AgentTask } from '@shared/types'
import { SYSTEM_APPEND } from './prompt'

/** Command line and MCP config of an agent run. Pure (no Electron), so they are unit-tested. */

export interface McpEndpoint {
  url: string
  token: string
}

/** MCP config passed inline with --mcp-config. Exported for tests. */
export function mcpConfig(s: AgentSettings, app: McpEndpoint, pw: { node: string; cli: string; profileDir: string; outputDir: string }): Record<string, unknown> {
  const servers: Record<string, unknown> = {
    jobsearch: { type: 'http', url: app.url, headers: { Authorization: `Bearer ${app.token}` } }
  }
  if (s.browser !== 'claude-in-chrome') {
    servers.browser = {
      type: 'stdio',
      command: pw.node,
      args: [
        pw.cli,
        '--browser',
        s.browser,
        '--user-data-dir',
        pw.profileDir,
        '--output-dir',
        pw.outputDir,
        '--allow-unrestricted-file-access',
        '--viewport-size',
        '1366x900'
      ],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
  }
  return { mcpServers: servers }
}

/**
 * Read-only tools of the claude.ai Gmail connector. Nothing that sends, drafts, labels or deletes is ever allowed.
 * claude.ai connectors are deferred tools: they load through ToolSearch, and only when --strict-mcp-config is off.
 */
export const GMAIL_READ_TOOLS = ['search_threads', 'get_thread', 'get_message', 'list_labels'].map((t) => `mcp__claude_ai_Gmail__${t}`)

/** True when this run reads the inbox through the claude.ai Gmail connector. */
export const usesGmailConnector = (s: AgentSettings, task?: AgentTask): boolean => task?.mode === 'check-email' && s.emailSource === 'gmail-connector'

/** Command-line arguments for an agent run. Exported for tests. */
export function agentArgs(s: AgentSettings, plugin: string, mcpJson: string, task?: AgentTask): string[] {
  const gmail = usesGmailConnector(s, task)
  const allowed = ['mcp__jobsearch', 'Skill', 'TodoWrite', s.browser === 'claude-in-chrome' ? 'mcp__claude-in-chrome' : 'mcp__browser', ...(gmail ? ['ToolSearch', ...GMAIL_READ_TOOLS] : [])]
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    s.model,
    '--plugin-dir',
    plugin,
    '--setting-sources',
    '',
    // Off only for Gmail runs, so the account's claude.ai connectors load; --allowedTools + dontAsk still limit what runs
    ...(gmail ? [] : ['--strict-mcp-config']),
    '--mcp-config',
    mcpJson,
    '--tools',
    gmail ? 'Skill,TodoWrite,ToolSearch' : 'Skill,TodoWrite',
    '--allowedTools',
    allowed.join(','),
    '--permission-mode',
    'dontAsk',
    '--append-system-prompt',
    SYSTEM_APPEND,
    '--no-session-persistence',
    ...(s.browser === 'claude-in-chrome' ? ['--chrome'] : ['--no-chrome'])
  ]
}

