import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/types'
import { agentArgs, GMAIL_READ_TOOLS } from '../src/main/agent/args'
import { emailIdsInNotes, statusMove } from '../src/main/agent/emailUpdates'
import { taskPrompt } from '../src/main/agent/prompt'

const val = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('check-email runs', () => {
  it('loads the claude.ai Gmail connector with read-only tools only', () => {
    const args = agentArgs(defaultSettings.agent, '/plugin', '{}', { mode: 'check-email', days: 14 })
    expect(args).not.toContain('--strict-mcp-config')
    expect(val(args, '--tools')).toBe('Skill,TodoWrite,ToolSearch')
    const allowed = val(args, '--allowedTools').split(',')
    expect(allowed).toEqual(expect.arrayContaining(['ToolSearch', ...GMAIL_READ_TOOLS]))
    // Never a whole-server grant, nothing that sends, drafts, labels or deletes
    expect(allowed).not.toContain('mcp__claude_ai_Gmail')
    expect(allowed.filter((t) => /send|draft|label_|trash|delete|forward|reply|spam/.test(t))).toEqual([])
    expect(val(args, '--permission-mode')).toBe('dontAsk')
  })

  it('keeps other runs (and webmail checks) strict', () => {
    expect(agentArgs(defaultSettings.agent, '/plugin', '{}', { mode: 'search', keywords: '', location: '', remote: false, easyApplyOnly: false, maxJobs: 1 })).toContain('--strict-mcp-config')
    const webmail = agentArgs({ ...defaultSettings.agent, emailSource: 'webmail' }, '/plugin', '{}', { mode: 'check-email', days: 7 })
    expect(webmail).toContain('--strict-mcp-config')
    expect(val(webmail, '--allowedTools')).not.toContain('Gmail')
  })

  it('prompts with the window and the inbox', () => {
    const gmail = taskPrompt({ mode: 'check-email', days: 7 }, defaultSettings.agent, { today: 'x' })
    expect(gmail).toContain('last 7 day(s)')
    expect(gmail).toContain('Gmail connector')
    expect(gmail).toContain('check-email skill')
    const web = taskPrompt({ mode: 'check-email', days: 500 }, { ...defaultSettings.agent, emailSource: 'webmail', webmailUrl: 'https://outlook.live.com/mail/' }, { today: 'x' })
    expect(web).toContain('https://outlook.live.com/mail/')
    expect(web).toContain('last 90 day(s)')
  })

  it('remembers processed email ids from the notes', () => {
    const notes = '[2026-11-18 10:00] Agent: applied via easy-apply\n[2026-11-19 09:00] Email 1a1f3dcdf0131ada (2026-11-18, ana@acme.com): "Next steps" — wants to talk [→ awaiting interview scheduling]'
    expect(emailIdsInNotes(notes)).toEqual(['1a1f3dcdf0131ada'])
    expect(emailIdsInNotes('')).toEqual([])
  })

  it('moves statuses, but never reopens offer/rejected without force', () => {
    expect(statusMove('applied', 'scheduling')).toEqual({ status: 'scheduling', changed: true })
    expect(statusMove('interview', 'scheduling').changed).toBe(true)
    expect(statusMove('scheduling', 'no-change')).toEqual({ status: 'scheduling', changed: false })
    expect(statusMove('rejected', 'interview').refused).toBeTruthy()
    expect(statusMove('rejected', 'interview', true)).toEqual({ status: 'interview', changed: true })
    expect(statusMove('offer', 'offer').changed).toBe(false)
  })
})
