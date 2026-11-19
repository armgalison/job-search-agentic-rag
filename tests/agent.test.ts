import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/types'
import { checkWriting } from '@shared/writingCheck'
import { agentArgs, mcpConfig } from '../src/main/agent/args'
import { applicationsAtCompany, hasApplied, normalizeCompany, normalizeJobUrl } from '../src/main/agent/history'
import { SEARCH_SOURCES, taskPrompt } from '../src/main/agent/prompt'
import { describeBlacklist, jobKey, matchBlacklist, normalizeBlacklistValue } from '../src/main/agent/blacklist'
import { StreamParser, prettyToolName, summarizeToolInput } from '../src/main/agent/stream'

const rules = (text: string) => checkWriting(text).map((i) => i.rule)

describe('checkWriting (signs of AI writing)', () => {
  it('flags AI vocabulary, em dashes, chatbot phrases and clichés', () => {
    const text =
      'I am writing to express my interest — this role is a testament to my passion. Additionally, I delve into robust systems, showcasing my skills. I hope this helps!'
    const r = rules(text)
    expect(r).toEqual(expect.arrayContaining(['ai-vocabulary', 'em-dash', 'additionally', 'chatbot-phrase', 'job-cliche', 'ing-tail', 'copula-dodge']))
  })

  it('flags placeholders, Markdown, emoji, curly quotes and negative parallelisms', () => {
    const r = rules('Hi [Hiring Manager], **Experience:** it’s not only fast but also cheap 🚀')
    expect(r).toEqual(expect.arrayContaining(['placeholder', 'markdown', 'emoji', 'curly-quotes', 'negative-parallelism']))
  })

  it('flags Portuguese clichés', () => {
    expect(rules('Venho por meio desta manifestar interesse. Sou apaixonado por tecnologia e quero agregar valor.')).toContain('job-cliche')
  })

  it('passes plain, specific text', () => {
    const msg =
      "Hi Ana, I applied today for the Senior Backend role. I built the Go payments API at Acme that handles 3k req/s, which looks close to what your team does. Open to a quick chat?"
    expect(checkWriting(msg)).toEqual([])
  })

  it('flags too many lists of three', () => {
    expect(rules('I like Go, Rust, and Python. I use AWS, GCP, and Azure. I know SQL, Redis, and Kafka.')).toContain('rule-of-three')
  })
})

describe('agent stream parser', () => {
  it('labels tool calls, skills, results and the final result', () => {
    const p = new StreamParser()
    const init = p.parse({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', skills: ['job-agent:job-agent', 'debug'], mcp_servers: [{ name: 'jobsearch', status: 'connected' }, { name: 'browser', status: 'failed' }] })
    expect(init[0].text).toContain('1 skills')
    expect(init[1]).toMatchObject({ kind: 'error', text: expect.stringContaining('browser') })

    const a = p.parse({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Opening the job page' },
          { type: 'tool_use', id: 't1', name: 'mcp__browser__browser_navigate', input: { url: 'https://www.linkedin.com/jobs/view/1/' } },
          { type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'job-agent:easy-apply' } }
        ]
      }
    })
    expect(a.map((e) => e.kind)).toEqual(['text', 'tool', 'skill'])
    expect(a[1]).toMatchObject({ tool: 'browser · navigate', text: 'https://www.linkedin.com/jobs/view/1/' })

    const u = p.parse({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Page loaded' }] }, { type: 'tool_result', tool_use_id: 't2', content: 'skill body' }] } })
    expect(u).toHaveLength(1) // skill bodies are not shown
    expect(u[0]).toMatchObject({ kind: 'tool-result', tool: 'browser · navigate', text: 'Page loaded' })

    const r = p.parse({ type: 'result', subtype: 'success', is_error: false, result: 'Applied to 1 job.', total_cost_usd: 0.42, usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { 'claude-sonnet-5-5': {} } })
    expect(r[0]).toMatchObject({ kind: 'result', text: 'Applied to 1 job.' })
    expect(p.result).toMatchObject({ isError: false, costUsd: 0.42, model: 'claude-sonnet-5-5', usage: { inputTokens: 10, outputTokens: 5 } })
  })

  it('ignores non-JSON noise gracefully and names tools', () => {
    expect(new StreamParser().parseLine('Warning: something')[0].kind).toBe('status')
    expect(prettyToolName('mcp__jobsearch__save_job')).toBe('app · save_job')
    expect(prettyToolName('mcp__claude-in-chrome__navigate')).toBe('chrome · navigate')
    expect(summarizeToolInput('mcp__browser__browser_file_upload', { paths: ['C:\\x\\Ana-Acme.pdf'] })).toBe('Ana-Acme.pdf')
  })
})

describe('agent command line', () => {
  const app = { url: 'http://127.0.0.1:5000/mcp', token: 'tok' }
  const pw = { node: '/electron', cli: '/pw/cli.js', profileDir: '/profile', outputDir: '/ws' }

  it('isolates the run: plugin skills only, no user settings, no shell, only allowed MCP tools', () => {
    const args = agentArgs(defaultSettings.agent, '/plugin', '{}')
    const val = (flag: string) => args[args.indexOf(flag) + 1]
    expect(val('--plugin-dir')).toBe('/plugin')
    expect(val('--setting-sources')).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(val('--tools')).toBe('Skill,TodoWrite')
    expect(val('--permission-mode')).toBe('dontAsk')
    expect(val('--allowedTools').split(',')).toEqual(['mcp__jobsearch', 'Skill', 'TodoWrite', 'mcp__browser'])
    expect(val('--output-format')).toBe('stream-json')
    expect(args).toContain('--no-chrome')
  })

  it('uses Playwright with a persistent profile, or Claude in Chrome', () => {
    const cfg = mcpConfig(defaultSettings.agent, app, pw) as { mcpServers: Record<string, { args?: string[]; headers?: Record<string, string>; env?: Record<string, string> }> }
    expect(cfg.mcpServers.jobsearch.headers).toEqual({ Authorization: 'Bearer tok' })
    expect(cfg.mcpServers.browser.args).toEqual(expect.arrayContaining(['/pw/cli.js', '--browser', 'chrome', '--user-data-dir', '/profile']))
    expect(cfg.mcpServers.browser.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })

    const chrome = { ...defaultSettings.agent, browser: 'claude-in-chrome' as const }
    expect(Object.keys((mcpConfig(chrome, app, pw) as { mcpServers: object }).mcpServers)).toEqual(['jobsearch'])
    const args = agentArgs(chrome, '/plugin', '{}')
    expect(args).toContain('--chrome')
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__claude-in-chrome')
  })

  it('builds task prompts with the run limits', () => {
    const s = { ...defaultSettings.agent, dryRun: true, outreach: false }
    const p = taskPrompt({ mode: 'apply-job', url: 'https://www.linkedin.com/jobs/view/123/' }, s, { today: '2026-11-17' })
    expect(p).toContain('https://www.linkedin.com/jobs/view/123/')
    expect(p).toContain('DRY RUN')
    expect(p).toContain('Do NOT contact anyone')
    expect(() => taskPrompt({ mode: 'apply-job' }, s, { today: 'x' })).toThrow()
    expect(taskPrompt({ mode: 'search', keywords: 'Go', location: 'Brazil', remote: true, easyApplyOnly: false, maxJobs: 3 }, defaultSettings.agent, { today: 'x' })).toContain('best 3 job(s)')
  })
})

describe('job-agent plugin skills', () => {
  const dir = join(__dirname, '..', 'agent-plugin', 'skills')
  const skills = readdirSync(dir)

  it('every skill has a SKILL.md with a matching name and a description', () => {
    expect(skills.length).toBeGreaterThanOrEqual(10)
    for (const name of skills) {
      const md = readFileSync(join(dir, name, 'SKILL.md'), 'utf8')
      const front = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
      expect(front, name).toContain(`name: ${name}`)
      expect(front, name).toMatch(/description: .{40,}/)
    }
  })

  it('skills only reference tools the app MCP server provides', () => {
    const server = readFileSync(join(__dirname, '..', 'src', 'main', 'agent', 'mcpServer.ts'), 'utf8')
    const provided = new Set([...server.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]))
    for (const name of skills) {
      const md = readFileSync(join(dir, name, 'SKILL.md'), 'utf8')
      for (const m of md.matchAll(/`(?:mcp__jobsearch__)?([a-z]+_[a-z_]+)(?:\([^`]*\))?`/g)) {
        if (m[1].startsWith('browser_')) continue
        expect(provided, `${name} → ${m[1]}`).toContain(m[1])
      }
    }
  })
})

describe('application history (never apply twice)', () => {
  it('treats any status past draft as applied', () => {
    expect(hasApplied({ status: 'analyzed' }, null)).toBe(false)
    expect(hasApplied({ status: 'analyzed' }, { status: 'draft', appliedAt: null })).toBe(false)
    expect(hasApplied({ status: 'applied' }, null)).toBe(true)
    expect(hasApplied({ status: 'analyzed' }, { status: 'rejected', appliedAt: null })).toBe(true)
    expect(hasApplied({ status: 'analyzed' }, { status: 'interview', appliedAt: null })).toBe(true)
    expect(hasApplied({ status: 'analyzed' }, { status: 'draft', appliedAt: '2026-11-01' })).toBe(true)
  })

  it('normalizes company names', () => {
    expect(normalizeCompany('Kake, Inc.')).toBe('kake')
    expect(normalizeCompany('kake')).toBe('kake')
    expect(normalizeCompany('4DF Connect (LWSA / Octadesk)')).toBe('4df connect')
    expect(normalizeCompany('Petrobrás S.A.')).toBe('petrobras')
    expect(normalizeCompany('Itaú Unibanco Ltda')).toBe('itau unibanco')
  })

  it('finds earlier applications at the same company, excluding the job itself', () => {
    const jobs = [
      { id: 1, title: 'Senior Backend', company: 'Kake', status: 'applied' as const },
      { id: 2, title: 'Full Stack', company: 'Kake Inc', status: 'analyzed' as const },
      { id: 3, title: 'Backend', company: 'Other', status: 'applied' as const },
      { id: 4, title: 'Node Dev', company: 'KAKE', status: 'analyzed' as const }
    ]
    const apps: Record<number, { status: 'draft' | 'rejected'; appliedAt: string | null }> = { 4: { status: 'rejected', appliedAt: null } }
    const found = applicationsAtCompany('Kake', 2, jobs, (id) => apps[id] ?? null)
    expect(found.map((f) => f.job_id)).toEqual([1, 4])
    expect(found[1].status).toBe('rejected')
    expect(applicationsAtCompany('', 2, jobs, () => null)).toEqual([])
  })
})

describe('search sources', () => {
  const base = { mode: 'search' as const, keywords: 'Node', location: 'Brazil', remote: true, easyApplyOnly: true, maxJobs: 2 }
  const skills = readdirSync(join(__dirname, '..', 'agent-plugin', 'skills'))

  it('every source has a skill, and the prompt names it', () => {
    for (const [source, { skill }] of Object.entries(SEARCH_SOURCES)) {
      expect(skills).toContain(skill)
      expect(taskPrompt({ ...base, source: source as keyof typeof SEARCH_SOURCES }, defaultSettings.agent, { today: 'x' })).toContain(`${skill} skill`)
    }
  })

  it('defaults to LinkedIn and keeps Easy Apply / funding filters to their source', () => {
    const linkedin = taskPrompt(base, defaultSettings.agent, { today: 'x' })
    expect(linkedin).toContain('LinkedIn Jobs')
    expect(linkedin).toContain('Easy Apply only')
    const google = taskPrompt({ ...base, source: 'google' }, defaultSettings.agent, { today: 'x' })
    expect(google).not.toContain('Easy Apply only')
    expect(taskPrompt({ ...base, source: 'funded-startups', fundedWithinMonths: 3 }, defaultSettings.agent, { today: 'x' })).toContain('last 3 month(s)')
  })
})

describe('normalizeJobUrl', () => {
  it('matches the same posting across tracking params, case and trailing slashes', () => {
    expect(normalizeJobUrl('https://jobs.lever.co/Acme/123-abc/?lever-source=LinkedIn#x')).toBe(normalizeJobUrl('http://www.jobs.lever.co/acme/123-abc'))
    expect(normalizeJobUrl('https://boards.greenhouse.io/acme/jobs/42?utm_source=x')).toBe('boards.greenhouse.io/acme/jobs/42')
  })
  it('keeps query params that carry the job id', () => {
    expect(normalizeJobUrl('https://acme.com/careers?gh_jid=1')).not.toBe(normalizeJobUrl('https://acme.com/careers?gh_jid=2'))
  })
})

describe('blacklist', () => {
  const entry = (kind: 'company' | 'job' | 'keyword' | 'person', label: string, jobId: number | null = null) => ({ kind, value: normalizeBlacklistValue(kind, label), jobId, label })

  it('normalizes values per kind', () => {
    expect(normalizeBlacklistValue('company', 'Proxify AB')).toBe('proxify')
    expect(normalizeBlacklistValue('company', 'Proxify, Inc.')).toBe('proxify')
    expect(normalizeBlacklistValue('job', 'https://www.linkedin.com/jobs/view/senior-dev-at-x-4304136993/?trk=abc')).toBe('linkedin:4304136993')
    expect(normalizeBlacklistValue('job', 'https://www.linkedin.com/jobs/search/?currentJobId=4304136993&keywords=x')).toBe('linkedin:4304136993')
    expect(normalizeBlacklistValue('keyword', '  Estágio ')).toBe('estagio')
    expect(normalizeBlacklistValue('person', 'https://br.linkedin.com/in/Some-One?miniProfile=1')).toBe('https://www.linkedin.com/in/some-one/')
    expect(jobKey('https://jobs.lever.co/acme/1/?src=x')).toBe('jobs.lever.co/acme/1')
  })

  it('matches companies, jobs, title keywords and people', () => {
    const list = [entry('company', 'Proxify'), entry('job', 'https://www.linkedin.com/jobs/view/111111111/'), entry('keyword', 'java'), entry('keyword', 'estágio'), entry('person', 'https://www.linkedin.com/in/ana/')]
    expect(matchBlacklist(list, { company: 'Proxify', title: 'Senior Backend' })?.kind).toBe('company')
    expect(matchBlacklist(list, { company: 'PROXIFY Inc.' })?.kind).toBe('company')
    expect(matchBlacklist(list, { url: 'https://www.linkedin.com/jobs/view/111111111/?trk=1' })?.kind).toBe('job')
    expect(matchBlacklist(list, { title: 'Senior Java Developer' })?.kind).toBe('keyword')
    expect(matchBlacklist(list, { title: 'Estagio em Desenvolvimento' })?.kind).toBe('keyword')
    expect(matchBlacklist(list, { title: 'Senior JavaScript Developer', company: 'Kake' })).toBeNull()
    expect(matchBlacklist(list, { profileUrl: 'https://linkedin.com/in/ANA' })?.kind).toBe('person')
    expect(matchBlacklist(list, { company: 'Proxify Talent' })).toBeNull()
  })

  it('matches a job entry by job id even when the URL changed', () => {
    expect(matchBlacklist([{ kind: 'job', value: 'x.com/a', jobId: 7 }], { jobId: 7, url: 'https://other.com/b' })).not.toBeNull()
  })

  it('goes into the task prompt', () => {
    const text = describeBlacklist([
      { kind: 'company', label: 'Proxify', reason: 'rejected me' },
      { kind: 'keyword', label: 'PHP', reason: '' }
    ])
    expect(text).toContain('Never apply to these companies: Proxify (rejected me)')
    expect(text).toContain('title contains: PHP')
    const prompt = taskPrompt({ mode: 'search', keywords: '', location: '', remote: true, easyApplyOnly: false, maxJobs: 3 }, defaultSettings.agent, { today: 'x', blacklist: text })
    expect(prompt).toContain('Blacklist')
    expect(prompt).toContain('Proxify')
    expect(taskPrompt({ mode: 'search', keywords: '', location: '', remote: true, easyApplyOnly: false, maxJobs: 3 }, defaultSettings.agent, { today: 'x', blacklist: '' })).not.toContain('Blacklist')
  })
})
