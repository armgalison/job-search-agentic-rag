/** Dot product; stored vectors are already normalized, so this equals cosine similarity. */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

export interface Scored {
  id: number
  score: number
}

/** Returns the k items most similar to the query, above a minimum threshold. */
export function topK(query: Float32Array, items: { factId: number; vector: Float32Array }[], k: number, minScore = 0): Scored[] {
  return items
    .map((it) => ({ id: it.factId, score: dot(query, it.vector) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/**
 * Merges results from several queries: keeps the best score per fact,
 * then returns the overall top `limit`.
 */
export function mergeResults(lists: Scored[][], limit: number): Scored[] {
  const best = new Map<number, number>()
  for (const list of lists) for (const s of list) best.set(s.id, Math.max(best.get(s.id) ?? -Infinity, s.score))
  return [...best.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
