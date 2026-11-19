import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../src/main/db/client'
import { exportData, importData, parseBackup } from '../src/main/db/backup'
import { applicationsRepo, blacklistRepo, embeddingsRepo, factsRepo, jobsRepo, kv, profileRepo, qaRepo } from '../src/main/db/repos'

beforeEach(() => {
  openDb(':memory:')
})

function seed() {
  profileRepo.save({ ...profileRepo.get(), fullName: 'Ana', email: 'ana@example.com' })
  const item = profileRepo.saveItem('skill', { name: 'Go', level: '', years: '5' })
  const f = factsRepo.add('Habilidade: Go', 'profile', item.id)
  embeddingsRepo.upsert(f.id, 'm', Float32Array.from([0.6, 0.8]))
  const job = jobsRepo.upsertCaptured({ url: 'u', linkedinId: '42', title: 'Dev', company: 'Acme', location: '', description: 'd', easyApply: true })
  const app = applicationsRepo.ensure(job.id)
  applicationsRepo.setStatus(app.id, 'scheduling')
  qaRepo.save('Notice period?', '30 days')
  blacklistRepo.add({ kind: 'company', label: 'Proxify' })
  kv.set('settings', { defaultLang: 'pt' })
  kv.set('key:claude', 'encrypted-secret')
}

describe('backup', () => {
  it('exports everything but embeddings and API keys', () => {
    seed()
    const b = exportData()
    expect(Object.keys(b.tables)).not.toContain('embeddings')
    expect(JSON.stringify(b)).not.toContain('encrypted-secret')
    expect(b.tables.jobs).toHaveLength(1)
  })

  it('round-trips into another database, keeping that machine’s keys', () => {
    seed()
    const text = JSON.stringify(exportData())
    openDb(':memory:')
    kv.set('key:openai', 'other-machine-key')
    jobsRepo.upsertCaptured({ url: 'x', linkedinId: '7', title: 'Old', company: 'Old', location: '', description: '', easyApply: false })

    const counts = importData(parseBackup(text))
    expect(counts.jobs).toBe(1)
    expect(profileRepo.get().fullName).toBe('Ana')
    expect(jobsRepo.list().map((j) => j.title)).toEqual(['Dev'])
    expect(applicationsRepo.list()[0].status).toBe('scheduling')
    expect(factsRepo.list()[0].itemId).toBe(profileRepo.listItems('skill')[0].id)
    expect(qaRepo.list()[0].answer).toBe('30 days')
    expect(blacklistRepo.list()).toHaveLength(1)
    expect(kv.get('settings')).toEqual({ defaultLang: 'pt' })
    expect(kv.get('key:openai')).toBe('other-machine-key')
    expect(kv.get('key:claude')).toBeNull()
    // New rows continue after the imported ids
    const next = jobsRepo.upsertCaptured({ url: 'n', linkedinId: '8', title: 'New', company: 'N', location: '', description: '', easyApply: false })
    expect(next.id).toBeGreaterThan(jobsRepo.list().find((j) => j.title === 'Dev')!.id)
  })

  it('ignores unknown columns and rejects foreign files', () => {
    seed()
    const b = exportData()
    b.tables.jobs = b.tables.jobs!.map((r) => ({ ...r, future_column: 'x' }))
    expect(() => importData(b)).not.toThrow()
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 1 })
    expect(() => parseBackup('{"hello":1}')).toThrow(/not a Job Search RAG backup/)
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/)
    expect(() => parseBackup(JSON.stringify({ ...b, version: 99 }))).toThrow(/newer version/)
  })
})
