import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db/client'
import { applicationsRepo, embeddingsRepo, factsRepo, jobsRepo, normalizeQuestion, profileRepo, qaRepo } from '../src/main/db/repos'

beforeEach(() => {
  openDb(':memory:')
})

describe('repos', () => {
  it('cascades facts and embeddings when a profile item is deleted', () => {
    const item = profileRepo.saveItem('skill', { name: 'Go', level: '', years: '' })
    const f = factsRepo.add('Habilidade: Go', 'profile', item.id)
    embeddingsRepo.upsert(f.id, 'm', Float32Array.from([0.6, 0.8]))
    expect(embeddingsRepo.all('m')[0].vector[1]).toBeCloseTo(0.8)
    expect(embeddingsRepo.missing('m')).toHaveLength(0)
    expect(embeddingsRepo.missing('other')).toHaveLength(1)
    profileRepo.deleteItem(item.id)
    expect(factsRepo.list()).toHaveLength(0)
    expect(embeddingsRepo.all('m')).toHaveLength(0)
  })

  it('upserts captured jobs by LinkedIn id and promotes leads', () => {
    const lead = jobsRepo.upsertCaptured(
      { url: 'u', linkedinId: '42', title: 'Dev', company: 'Acme', location: '', description: '', easyApply: false },
      'lead'
    )
    expect(lead.status).toBe('lead')
    const full = jobsRepo.upsertCaptured({ url: 'u', linkedinId: '42', title: '', company: '', location: 'SP', description: 'desc', easyApply: true })
    expect(full.id).toBe(lead.id)
    expect(full.title).toBe('Dev')
    expect(full.status).toBe('captured')
    expect(full.easyApply).toBe(true)
    expect(jobsRepo.list()).toHaveLength(1)
  })

  it('tracks application status and applied date', () => {
    const job = jobsRepo.upsertCaptured({ url: 'u', linkedinId: '1', title: 'T', company: 'C', location: '', description: 'd', easyApply: false })
    const a = applicationsRepo.ensure(job.id)
    expect(applicationsRepo.ensure(job.id).id).toBe(a.id)
    applicationsRepo.setStatus(a.id, 'applied')
    expect(applicationsRepo.get(a.id)!.appliedAt).not.toBeNull()
  })

  it('bulk-deletes facts and keeps deleted profile facts excluded', async () => {
    const item = profileRepo.saveItem('skill', { name: 'Go', level: '', years: '' })
    const profileFact = factsRepo.add('Skill: Go', 'profile', item.id)
    const manual = factsRepo.add('Manual fact', 'manual')
    factsRepo.add('Keep me', 'manual')
    expect(factsRepo.deleteMany([profileFact.id, manual.id])).toBe(2)
    expect(factsRepo.list().map((f) => f.text)).toEqual(['Keep me'])
    expect(factsRepo.isExcluded('  skill: go ')).toBe(true)
    expect(factsRepo.isExcluded('Manual fact')).toBe(false)
  })

  it('normalizes questions in Q&A memory', () => {
    expect(normalizeQuestion('  Quantos anos de experiência com React?* ')).toBe('quantos anos de experiencia com react')
    qaRepo.save('Quantos anos de experiência com React?', '5')
    expect(qaRepo.find('quantos anos de EXPERIENCIA com react')).toBe('5')
  })
})

describe('resetAllData', () => {
  it('wipes every table, including settings and keys in kv', async () => {
    const { resetAllData, getDb } = await import('../src/main/db/client')
    const { kv } = await import('../src/main/db/repos')
    openDb(':memory:')
    profileRepo.save({ ...profileRepo.get(), fullName: 'Ana' })
    kv.set('key:claude', 'encrypted')
    const item = profileRepo.saveItem('skill', { name: 'Go', level: '', years: '' })
    const f = factsRepo.add('Skill: Go', 'profile', item.id)
    embeddingsRepo.upsert(f.id, 'm', Float32Array.from([1]))
    const job = jobsRepo.upsertCaptured({ url: 'u', linkedinId: '9', title: 'T', company: 'C', location: '', description: 'd', easyApply: false })
    applicationsRepo.ensure(job.id)
    qaRepo.save('q', 'a')

    resetAllData()

    for (const t of ['kv', 'profile_items', 'facts', 'embeddings', 'jobs', 'applications', 'qa_memory']) {
      expect((getDb().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0)
    }
    expect(profileRepo.get().fullName).toBe('')
    // The app keeps working after a reset, with ids starting over
    expect(profileRepo.saveItem('skill', { name: 'Rust', level: '', years: '' }).id).toBe(1)
  })
})
