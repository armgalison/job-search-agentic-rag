import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractText } from '../src/main/services/importResume'
import { parseResumeText } from '../src/shared/resumeHeuristics'

describe('PDF import (main process)', () => {
  it('reads a PDF with a broken xref table (the "bad XRef entry" case)', async () => {
    const text = await extractText('tests/fixtures/bad-xref.pdf')
    expect(text).toContain('Jane Doe')
    expect(text).toContain('jane@example.com')
  })

  it('reads a normal PDF and keeps line structure for the parser', async () => {
    const text = await extractText('tests/fixtures/resume-sample.pdf')
    const r = parseResumeText(text)
    expect(r.profile.email).toBe('ana@example.com')
    expect(r.experiences).toHaveLength(2)
  })

  it('gives a readable error for a file that is not a valid PDF', async () => {
    await expect(extractText('tests/fixtures/not-a-pdf.pdf')).rejects.toThrow(/Could not read this PDF/)
  })
})

describe('fixtures sanity', () => {
  it('the broken fixture really has wrong xref offsets', () => {
    expect(readFileSync('tests/fixtures/bad-xref.pdf', 'latin1')).toContain('0000000999 00000 n')
  })
})
