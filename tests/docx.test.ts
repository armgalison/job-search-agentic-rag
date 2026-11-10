import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

describe('docx export', () => {
  it('produces a valid zip (docx) buffer', async () => {
    const { resumeDocx, coverLetterDocx } = await import('../src/main/docs/render')
    const buf = await resumeDocx({
      name: 'Ana',
      headline: 'Dev',
      contact: ['a@b.c'],
      summary: 'S',
      skills: ['TS'],
      experiences: [{ company: 'Acme', title: 'Dev', location: '', period: '2020', bullets: ['X'] }],
      education: [{ institution: 'USP', degree: 'BSc', period: '2019' }],
      projects: [],
      certifications: [],
      languages: []
    })
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    const letter = await coverLetterDocx({ greeting: 'Olá', paragraphs: ['P'], closing: 'Att', signature: 'Ana' }, { name: 'Ana', contact: [], company: 'Acme', date: 'hoje' })
    expect(letter.length).toBeGreaterThan(1000)
  })
})
