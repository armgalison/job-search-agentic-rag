import { describe, expect, it } from 'vitest'
import * as z from 'zod/v4'
import { ClaudeCliProvider } from '../src/main/ai/claudeCli'
import { JobRequirementsSchema } from '../src/main/services/schemas'

// Opt-in: makes a real (tiny) call through your Claude subscription. Run with RUN_CLI_TEST=1 npx vitest run tests/claudeCli.live.test.ts
describe.skipIf(!process.env.RUN_CLI_TEST)('ClaudeCliProvider (live)', () => {
  it('returns schema-valid JSON and token usage through claude -p', async () => {
    const p = new ClaudeCliProvider('haiku', { cliPath: 'claude', cwd: '/tmp/jsr-cli-sandbox', timeoutMs: 120_000 })
    const { value, usage } = await p.jsonRaw({
      name: 'extract',
      schema: z.object({ name: z.string(), years: z.number() }),
      system: 'Extract the data.',
      prompt: 'Maria has 7 years of Go experience.'
    })
    expect(value).toEqual({ name: 'Maria', years: 7 })
    expect(usage.outputTokens).toBeGreaterThan(0)
    expect(usage.reportedCostUsd).toBeGreaterThan(0)
  }, 150_000)

  it('handles the app\'s real job-requirements schema (enum + descriptions)', async () => {
    const p = new ClaudeCliProvider('haiku', { cliPath: 'claude', cwd: '/tmp/jsr-cli-sandbox', timeoutMs: 120_000 })
    const { value } = await p.jsonRaw({
      name: 'job_requirements',
      schema: JobRequirementsSchema,
      system: 'Extract the job requirements faithfully.',
      prompt: 'Senior Backend Engineer at Globex (Remote). Requirements: 5+ years Go, Kubernetes, PostgreSQL. Nice to have: Kafka.'
    })
    expect(value.language).toBe('en')
    expect(value.mustHave.join(' ')).toMatch(/Go/)
  }, 150_000)
})
