import { getEmbedder } from '../ai'
import { embeddingsRepo, factsRepo, profileRepo } from '../db/repos'
import type { Fact, ProfileItem } from '@shared/types'
import { itemToFacts } from './facts'
import { mergeResults, topK } from './similarity'
import { logger } from '../log'

/** Regenerates the facts derived from a profile item (called when the item is saved). */
export function syncItemFacts(item: ProfileItem): void {
  factsRepo.deleteByItem(item.id)
  for (const text of itemToFacts(item)) if (text.trim() && !factsRepo.isExcluded(text)) factsRepo.add(text, 'profile', item.id)
}

/** Embeds every fact not yet indexed with the current model. */
export async function indexPending(): Promise<number> {
  const embedder = getEmbedder()
  const pending = embeddingsRepo.missing(embedder.modelId)
  if (!pending.length) return 0
  logger.info('embeddings', `Indexing ${pending.length} fact(s) with ${embedder.modelId}…`)
  const started = Date.now()
  const vectors = await embedder.embedDocuments(pending.map((f) => f.text))
  logger.info('embeddings', `Indexed ${pending.length} fact(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  pending.forEach((f, i) => embeddingsRepo.upsert(f.id, embedder.modelId, vectors[i]))
  return pending.length
}

/** Rebuilds all profile facts and reindexes. */
export async function rebuildIndex(): Promise<number> {
  for (const item of profileRepo.listItems()) syncItemFacts(item)
  return indexPending()
}

export interface Retrieved extends Fact {
  score: number
}

/**
 * Semantic search: each query (e.g. a job requirement) retrieves its k nearest facts,
 * and the results are merged.
 */
export async function retrieve(queries: string[], opts: { perQuery?: number; limit?: number; minScore?: number } = {}): Promise<Retrieved[]> {
  try {
    return await semanticRetrieve(queries, opts)
  } catch (err) {
    // Never let an embedding problem (model download, native module…) block analysis/generation
    logger.warn('embeddings', `Semantic search unavailable, using keyword search instead: ${(err as Error).message.split('\n')[0]}`)
    return keywordRetrieve(queries, opts.limit ?? 40)
  }
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9+#.]+/)
      .filter((t) => t.length > 2)
  )

/** Fallback ranking by word overlap between the queries and each fact. Exported for tests. */
export function keywordRetrieve(queries: string[], limit: number): Retrieved[] {
  const q = queries.map(tokens)
  return factsRepo
    .list()
    .map((f) => {
      const ft = tokens(f.text)
      let best = 0
      for (const qt of q) {
        if (!qt.size) continue
        let hit = 0
        for (const t of qt) if (ft.has(t)) hit++
        best = Math.max(best, hit / qt.size)
      }
      return { ...f, score: best }
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

async function semanticRetrieve(queries: string[], opts: { perQuery?: number; limit?: number; minScore?: number }): Promise<Retrieved[]> {
  await indexPending()
  const embedder = getEmbedder()
  const all = embeddingsRepo.all(embedder.modelId)
  if (!all.length || !queries.length) return []
  const lists = []
  for (const q of queries.filter((q) => q.trim())) {
    lists.push(topK(await embedder.embedQuery(q), all, opts.perQuery ?? 5, opts.minScore ?? 0.2))
  }
  const merged = mergeResults(lists, opts.limit ?? 40)
  const byId = new Map(factsRepo.byIds(merged.map((m) => m.id)).map((f) => [f.id, f]))
  return merged.flatMap((m) => {
    const f = byId.get(m.id)
    return f ? [{ ...f, score: m.score }] : []
  })
}
