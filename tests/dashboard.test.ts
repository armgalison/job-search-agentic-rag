import { describe, expect, it } from 'vitest'
import { countAxis, dashboardStats, weekStart } from '@shared/dashboard'
import type { ApplicationListItem, Job } from '@shared/types'
import { emailUrl, latestEmail } from '@shared/email'

const job = (id: number, company: string, score: number | null, createdAt: string, status: Job['status'] = 'analyzed') => ({
  id,
  company,
  status,
  createdAt,
  match: score == null ? null : { score, summary: '', matched: [], gaps: [] }
})
const app = (id: number, jobId: number, status: ApplicationListItem['status'], appliedAt: string | null, score: number | null, company = 'Acme'): ApplicationListItem => ({
  id,
  jobId,
  resume: null,
  coverLetter: null,
  status,
  notes: '',
  appliedAt,
  updatedAt: '2026-11-18 10:00:00',
  archivedAt: null,
  job: { id: jobId, title: 'Dev', company, url: '', score }
})

describe('dashboard stats', () => {
  const now = new Date('2026-11-19T12:00:00Z') // a Thursday
  const jobs = [job(1, 'Acme', 82, '2026-11-17 09:00:00'), job(2, 'Beta', 55, '2026-11-10 09:00:00'), job(3, 'Gamma', 30, '2026-11-18 09:00:00'), job(4, 'Delta', null, '2026-01-01 09:00:00', 'lead')]
  const apps = [
    app(1, 1, 'scheduling', '2026-11-17 10:00:00', 82),
    app(2, 2, 'rejected', '2026-11-11 10:00:00', 55, 'Beta'),
    app(3, 3, 'draft', null, 30, 'Gamma')
  ]
  const s = dashboardStats(jobs, apps, [{ status: 'sent' }, { status: 'failed' }], now)

  it('counts the funnel', () => {
    expect(s).toMatchObject({ jobs: 4, analyzed: 3, sent: 2, replied: 2, interviewing: 1, rejected: 1, offers: 0, drafts: 1, awaitingScheduling: 1, messages: 1, responseRate: 100, avgScoreSent: 69 })
    expect(s.byStatus.find((b) => b.status === 'draft')?.count).toBe(1)
    expect(s.topCompanies).toEqual([
      { company: 'Acme', count: 1 },
      { company: 'Beta', count: 1 }
    ])
  })

  it('buckets weeks from Monday, oldest first', () => {
    expect(weekStart(now)).toBe('2026-11-16')
    expect(s.weekly).toHaveLength(12)
    expect(s.weekly.at(-1)).toEqual({ week: '2026-11-16', jobs: 2, applications: 1 })
    expect(s.weekly.at(-2)).toEqual({ week: '2026-11-09', jobs: 1, applications: 1 })
    // Older than 12 weeks: not plotted
    expect(s.weekly.reduce((n, w) => n + w.jobs, 0)).toBe(3)
  })

  it('splits fit scores by applied', () => {
    expect(s.scores[8]).toMatchObject({ from: 80, applied: 1, notApplied: 0 })
    expect(s.scores[5]).toMatchObject({ applied: 1 })
    expect(s.scores[3]).toMatchObject({ applied: 0, notApplied: 1 })
    expect(s.scores[9].to).toBe(100)
  })

  it('has no response rate before the first application', () => {
    expect(dashboardStats([], [], [], now).responseRate).toBeNull()
  })

  it('makes clean count axes', () => {
    expect(countAxis(0)).toEqual({ max: 1, ticks: [0, 1] })
    expect(countAxis(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] })
    expect(countAxis(37).ticks).toEqual([0, 10, 20, 30, 40])
  })
})

describe('email links on the board', () => {
  const notes = [
    'Applied by the agent.',
    'Email 19a2b3c4d5e6f708 (2026-11-17, jobs@acme.com): "Next steps" — They want to talk. Next: pick a slot [→ awaiting interview scheduling]'
  ].join('\n')

  it('opens the latest Gmail message by id', () => {
    expect(latestEmail(notes)).toEqual({ id: '19a2b3c4d5e6f708', subject: 'Next steps', link: null })
    expect(emailUrl(notes, 'gmail-connector', '')).toBe('https://mail.google.com/mail/u/0/#all/19a2b3c4d5e6f708')
  })

  it('prefers the link a webmail run recorded, else searches the subject', () => {
    const web = 'Email acme_2026-11-17_Next (2026-11-17, Acme) link https://outlook.live.com/mail/0/id/AQMk: "Interview" — Hi.'
    expect(emailUrl(web, 'webmail', 'https://outlook.live.com/mail/')).toBe('https://outlook.live.com/mail/0/id/AQMk')
    expect(emailUrl('Email acme_x (d): "Interview" — Hi.', 'webmail', 'https://outlook.live.com/mail/')).toBe('https://outlook.live.com/mail/0/search?q=Interview')
    expect(emailUrl('no emails', 'gmail-connector', '')).toBeNull()
  })
})
