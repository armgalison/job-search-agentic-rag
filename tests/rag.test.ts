import { describe, expect, it } from 'vitest'
import { itemToFacts } from '../src/main/rag/facts'
import { dot, mergeResults, topK } from '../src/main/rag/similarity'

const v = (...xs: number[]) => {
  const a = Float32Array.from(xs)
  const n = Math.hypot(...xs)
  return a.map((x) => x / n)
}

describe('similarity', () => {
  it('ranks by cosine and respects minScore', () => {
    const items = [
      { factId: 1, vector: v(1, 0) },
      { factId: 2, vector: v(0.7, 0.7) },
      { factId: 3, vector: v(0, 1) }
    ]
    const r = topK(v(1, 0), items, 2, 0.1)
    expect(r.map((x) => x.id)).toEqual([1, 2])
    expect(r[0].score).toBeCloseTo(1)
    expect(dot(v(1, 0), v(0, 1))).toBeCloseTo(0)
  })

  it('merges multiple query results keeping best score per fact', () => {
    const merged = mergeResults(
      [
        [{ id: 1, score: 0.5 }, { id: 2, score: 0.4 }],
        [{ id: 2, score: 0.9 }, { id: 3, score: 0.3 }]
      ],
      2
    )
    expect(merged).toEqual([
      { id: 2, score: 0.9 },
      { id: 1, score: 0.5 }
    ])
  })
})

describe('itemToFacts', () => {
  it('splits experience into atomic facts with context', () => {
    const facts = itemToFacts({
      id: 1,
      kind: 'experience',
      sort: 0,
      data: {
        company: 'Acme',
        title: 'Backend Dev',
        location: 'Austin',
        start: '01/2020',
        end: '',
        description: '- Node.js APIs\n- Queues with RabbitMQ',
        achievements: '• Cut p95 latency by 40%'
      }
    })
    expect(facts).toHaveLength(4)
    expect(facts[0]).toBe('Backend Dev at Acme (01/2020 – present). Location: Austin.')
    expect(facts[1]).toBe('Backend Dev at Acme (01/2020 – present): Node.js APIs')
    expect(facts[3]).toBe('Achievement as Backend Dev at Acme: Cut p95 latency by 40%')
  })

  it('formats skills', () => {
    expect(itemToFacts({ id: 2, kind: 'skill', sort: 0, data: { name: 'TypeScript', level: 'advanced', years: '5' } })[0]).toBe(
      'Skill: TypeScript (advanced level) — 5 years of experience'
    )
  })
})
