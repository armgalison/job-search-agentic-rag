/**
 * End-to-end check of "Check email replies" through the claude.ai Gmail connector, opt-in because it reads the real
 * mailbox of the Claude account the CLI is logged in with and spends subscription usage:
 *   RUN_EMAIL_TEST=1 npx vitest run tests/emailCheck.live.test.ts
 * Real: the runner, `claude -p`, the plugin skills, the app MCP server, the Gmail connector. The database is a
 * throwaway file seeded with one application, so the real board is never touched.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'email-live-'))
const root = resolve(__dirname, '..')

vi.mock('electron', () => ({
  app: { getPath: () => tmp, isPackaged: false, getAppPath: () => root },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: () => Buffer.from('') },
  BrowserWindow: class {},
  dialog: {},
  shell: {}
}))
vi.mock('../src/main/agent/paths', async (orig) => ({
  ...(await orig<typeof import('../src/main/agent/paths')>()),
  playwrightMcpCli: () => join(root, 'node_modules', '@playwright', 'mcp', 'cli.js')
}))

const RUN = process.env.RUN_EMAIL_TEST === '1'

describe.skipIf(!RUN)('check email (live, Gmail connector)', () => {
  beforeAll(async () => {
    const { openDb } = await import('../src/main/db/client')
    openDb(join(tmp, 'test.db'))
    const { updateSettings } = await import('../src/main/settings')
    updateSettings({ agent: { model: process.env.EMAIL_TEST_MODEL ?? 'claude-sonnet-5-5', emailSource: 'gmail-connector' } as never })
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it(
    'reads the inbox with read-only Gmail tools and records what it finds',
    async () => {
      const session = await import('../src/main/agent/session')
      const { startAgent } = await import('../src/main/agent/runner')
      session.setQuestionNotifier((q) => setTimeout(() => session.answer(q.id, q.kind === 'action' ? 'Done' : "I don't know"), 200))
      const { onLog } = await import('../src/main/log')
      onLog((e) => e.source === 'agent' && console.log(`[agent] ${e.message.slice(0, 300)}`))

      await startAgent({ mode: 'check-email', days: Number(process.env.EMAIL_TEST_DAYS ?? 3) })
      await vi.waitUntil(() => session.currentRun()?.status !== 'running', { timeout: 14 * 60_000, interval: 1000 })

      const run = session.currentRun()!
      const tools = session
        .agentState()
        .events.filter((e) => e.kind === 'tool')
        .map((e) => e.tool ?? '')
      console.log('RUN', run.status, run.summary)
      console.log('TOOLS', [...new Set(tools)].join(', '))
      expect(run.status).toBe('done')
      expect(tools.some((t) => /gmail/i.test(t) && /search/i.test(t)), 'searched Gmail').toBe(true)
      expect(tools.filter((t) => /send|draft|trash|delete|label|forward|reply|spam/i.test(t))).toEqual([])
      const { applicationsRepo } = await import('../src/main/db/repos')
      console.log('BOARD', JSON.stringify(applicationsRepo.list().map((a) => ({ company: a.job.company, title: a.job.title, status: a.status, notes: a.notes })), null, 1))
    },
    15 * 60_000
  )
})
