/**
 * End-to-end check of the background agent, opt-in because it spends Claude subscription usage and opens a real
 * Chrome window: RUN_AGENT_TEST=1 npx vitest run tests/agent.live.test.ts
 *
 * Real: the runner, `claude -p`, the job-agent plugin skills, the app MCP server, Playwright MCP + Chrome, the
 * SQLite knowledge base, resume/cover-letter generation through claude -p. Mocked: only Electron (paths, PDF
 * rendering) and a local fake job page + application form instead of LinkedIn.
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'agent-live-'))
const root = resolve(__dirname, '..')

vi.mock('electron', () => ({
  app: { getPath: () => tmp, isPackaged: false, getAppPath: () => root },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: () => Buffer.from('') },
  BrowserWindow: class {},
  dialog: {},
  shell: {}
}))
vi.mock('../src/main/docs/render', async (orig) => ({
  ...(await orig<typeof import('../src/main/docs/render')>()),
  htmlToPdf: async (html: string) => Buffer.from(`%PDF-1.4\n% test pdf, ${html.length} chars of HTML\n%%EOF\n`)
}))
vi.mock('../src/main/agent/paths', async (orig) => ({
  ...(await orig<typeof import('../src/main/agent/paths')>()),
  playwrightMcpCli: () => join(root, 'node_modules', '@playwright', 'mcp', 'cli.js')
}))

const RUN = process.env.RUN_AGENT_TEST === '1'

const JOB_HTML = `<!doctype html><html><head><title>Senior Go Engineer - Pagaleve</title></head><body>
<h1>Senior Go Engineer</h1><p class="company">Pagaleve</p><p>São Paulo, Brazil (remote)</p>
<h2>About the job</h2>
<p>Pagaleve is a buy-now-pay-later company. We are hiring a Senior Go Engineer for our payments platform team.
You will design and run high-throughput payment APIs in Go, work with PostgreSQL and Kafka, and own services in production on AWS.</p>
<h3>Requirements</h3><ul><li>5+ years of backend development</li><li>Strong Go experience</li><li>PostgreSQL</li><li>Kafka or another message broker</li></ul>
<h3>Nice to have</h3><ul><li>Fintech or payments experience</li></ul>
<a href="/apply">Apply</a></body></html>`

const FORM_HTML = `<!doctype html><html><head><title>Apply - Senior Go Engineer - Pagaleve</title></head><body>
<h1>Apply: Senior Go Engineer at Pagaleve</h1>
<form method="post" action="/submit" enctype="multipart/form-data">
<p><label for="name">Full name *</label><input id="name" name="name" required></p>
<p><label for="email">Email *</label><input id="email" name="email" type="email" required></p>
<p><label for="years">Years of experience with Go *</label><input id="years" name="years" type="number" required></p>
<p><label for="salary">Expected monthly salary (BRL) *</label><input id="salary" name="salary" required></p>
<p><label for="resume">Resume (PDF) *</label><input id="resume" name="resume" type="file" accept=".pdf" required></p>
<p><label for="cover">Cover letter</label><textarea id="cover" name="cover" rows="10" cols="80"></textarea></p>
<p><button type="submit">Submit application</button></p>
</form></body></html>`

let site: Server
let base = ''
let submission: string | null = null

describe.skipIf(!RUN)('agent (live)', () => {
  beforeAll(async () => {
    site = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/submit') {
        let body = ''
        req.setEncoding('latin1')
        req.on('data', (d) => (body += d))
        req.on('end', () => {
          submission = body
          res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Thank you! Your application was received.</h1>')
        })
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(req.url === '/apply' ? FORM_HTML : JOB_HTML)
    })
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`

    const { openDb } = await import('../src/main/db/client')
    openDb(join(tmp, 'test.db'))
    const { profileRepo, factsRepo } = await import('../src/main/db/repos')
    const { updateSettings } = await import('../src/main/settings')
    const { syncItemFacts } = await import('../src/main/rag')
    profileRepo.save({
      fullName: 'Rafael Souza',
      headline: 'Backend engineer (Go)',
      email: 'rafael.souza@example.org',
      phone: '+55 11 90000-0000',
      location: 'São Paulo, Brazil',
      linkedin: '',
      github: '',
      website: '',
      summary: 'Backend engineer building payment systems in Go.',
      targetRoles: 'Senior backend engineer',
      preferences: 'Remote'
    })
    const exp = profileRepo.saveItem('experience', {
      company: 'Acme Pay',
      title: 'Backend Engineer',
      location: 'São Paulo',
      start: '2019-03',
      end: '',
      description: 'Payments API in Go',
      achievements: 'Built the Go payments API handling 3,000 requests per second with PostgreSQL; moved settlement jobs to Kafka consumers, cutting settlement time from 4 hours to 20 minutes.'
    })
    syncItemFacts(exp)
    syncItemFacts(profileRepo.saveItem('skill', { name: 'Go', level: 'advanced', years: '6' }))
    syncItemFacts(profileRepo.saveItem('skill', { name: 'PostgreSQL', level: 'advanced', years: '6' }))
    factsRepo.add('Ran Kafka consumers in production at Acme Pay for settlement (2021-present)', 'manual')
    updateSettings({
      chatModel: { 'claude-cli': 'claude-haiku-5-5' } as never,
      embedProvider: 'ollama',
      ollamaUrl: 'http://127.0.0.1:9', // unreachable → keyword search fallback, no model download
      agent: { model: 'claude-sonnet-5-5', outreach: false, confirmBeforeSubmit: true, alwaysCoverLetter: true, minScore: 30 } as never
    })
  })

  afterAll(() => {
    site?.close()
    rmSync(tmp, { recursive: true, force: true })
  })

  it(
    'applies on a company site: grounded answers, asks for the salary, uploads the resume, writes a cover letter, asks approval before submitting',
    async () => {
      const session = await import('../src/main/agent/session')
      const { startAgent } = await import('../src/main/agent/runner')
      const asked: { kind: string; question: string }[] = []
      session.setQuestionNotifier((q) => {
        asked.push({ kind: q.kind, question: q.question })
        const reply = q.kind === 'approval' ? 'Approve' : /salary|salár/i.test(q.question) ? '18000' : q.kind === 'action' ? 'Done' : "I don't know"
        setTimeout(() => session.answer(q.id, reply), 200)
      })
      const { onLog } = await import('../src/main/log')
      onLog((e) => e.source === 'agent' && console.log(`[agent] ${e.message}`))

      await startAgent({ mode: 'custom', instructions: `Apply to this job (not on LinkedIn, on the company's site): ${base}/` })
      await vi.waitUntil(() => session.currentRun()?.status !== 'running', { timeout: 14 * 60_000, interval: 1000 })

      const run = session.currentRun()!
      console.log('RUN', run.status, run.summary)
      console.log('QUESTIONS', JSON.stringify(asked, null, 1))
      expect(run.status).toBe('done')
      expect(submission, 'the form was submitted').toBeTruthy()
      expect(submission).toContain('Rafael Souza')
      expect(submission).toContain('rafael.souza@example.org')
      expect(submission).toContain('18000')
      expect(submission).toMatch(/filename="[^"]+\.pdf"/)
      expect(asked.some((q) => q.kind === 'approval')).toBe(true)
      expect(asked.some((q) => /salary|salár/i.test(q.question))).toBe(true)
      const cover = submission!.match(/name="cover"\r\n\r\n([\s\S]*?)\r\n--/)?.[1] ?? ''
      console.log('COVER LETTER\n', cover)
      expect(cover.length).toBeGreaterThan(200)
      expect(cover).not.toContain('—')

      if (process.env.AGENT_TEST_DUMP) {
        const { writeFileSync } = await import('node:fs')
        const events = session.agentState().events.map((e) => `${e.kind.padEnd(11)} ${e.tool ? `${e.tool}: ` : ''}${e.text}`)
        writeFileSync(process.env.AGENT_TEST_DUMP, [`RUN ${run.status}`, ...events, '', 'QUESTIONS', JSON.stringify(asked, null, 1), '', 'COVER LETTER', cover].join('\n'))
      }
      const { jobsRepo } = await import('../src/main/db/repos')
      expect(jobsRepo.list().some((j) => j.status === 'applied')).toBe(true)
    },
    15 * 60_000
  )
})
