import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, safeStorage: {} }))

describe('syncItemFacts', () => {
  beforeEach(async () => {
    const { openDb } = await import('../src/main/db/client')
    openDb(':memory:')
  })

  it('does not recreate profile facts the user deleted', async () => {
    const { factsRepo, profileRepo } = await import('../src/main/db/repos')
    const { syncItemFacts } = await import('../src/main/rag')
    const item = profileRepo.saveItem('experience', {
      company: 'Acme',
      title: 'Dev',
      location: '',
      start: '2020',
      end: '',
      description: 'Built APIs\nWrote docs',
      achievements: ''
    })
    syncItemFacts(item)
    const docs = factsRepo.list().find((f) => f.text.endsWith('Wrote docs'))!
    factsRepo.delete(docs.id)
    syncItemFacts(item) // e.g. the item is saved again
    const texts = factsRepo.list().map((f) => f.text)
    expect(texts.some((t) => t.endsWith('Built APIs'))).toBe(true)
    expect(texts.some((t) => t.endsWith('Wrote docs'))).toBe(false)
  })
})
