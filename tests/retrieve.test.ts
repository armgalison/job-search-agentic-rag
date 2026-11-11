import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/jsr-test' }, safeStorage: { isEncryptionAvailable: () => false } }))
// Simulate the embedding model failing to load (e.g. a missing native module)
vi.mock('../src/main/ai', () => ({
  getEmbedder: () => {
    throw new Error('Could not load the "sharp" module using the win32-x64 runtime')
  }
}))

import { openDb } from '../src/main/db/client'
import { factsRepo } from '../src/main/db/repos'
import { retrieve } from '../src/main/rag'

beforeEach(() => openDb(':memory:'))

describe('retrieve', () => {
  it('falls back to keyword search when embeddings are unavailable', async () => {
    factsRepo.add('Skill: TypeScript (advanced level)', 'profile')
    factsRepo.add('Built React dashboards at Acme', 'profile')
    factsRepo.add('Language: Spanish — intermediate level', 'profile')
    const r = await retrieve(['TypeScript', 'React'], { limit: 5 })
    expect(r.map((f) => f.text).sort()).toEqual(['Built React dashboards at Acme', 'Skill: TypeScript (advanced level)'])
  })
})
