import { getDb } from './client'

/**
 * Full export / import of the app's data as one JSON file (Settings → Backup).
 * - Every table is included except `embeddings` (vectors are rebuilt from the facts after an import).
 * - API keys (kv `key:*`) are never exported: they are encrypted with this machine's keychain and would not
 *   decrypt elsewhere. An import keeps the keys already stored here.
 * - Columns are matched by name, so a backup from an older or newer version imports what both have in common.
 */

export const BACKUP_FORMAT = 'job-search-rag-backup'
export const BACKUP_VERSION = 1

/** Parents first (insert order); deletes run in reverse. */
const TABLES = ['kv', 'profile_items', 'facts', 'jobs', 'applications', 'outreach', 'blacklist', 'qa_memory', 'ai_usage'] as const
type Table = (typeof TABLES)[number]
type Row = Record<string, string | number | null>

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  tables: Partial<Record<Table, Row[]>>
}

const isSecretKv = (key: unknown) => typeof key === 'string' && key.startsWith('key:')

export function exportData(): Backup {
  const d = getDb()
  const tables: Backup['tables'] = {}
  for (const t of TABLES) {
    const rows = d.prepare(`SELECT * FROM ${t}`).all() as Row[]
    tables[t] = t === 'kv' ? rows.filter((r) => !isSecretKv(r.key)) : rows
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables }
}

/** Throws a readable error when the file is not one of our backups. */
export function parseBackup(text: string): Backup {
  let b: unknown
  try {
    b = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const o = b as Partial<Backup> | null
  if (!o || o.format !== BACKUP_FORMAT || typeof o.tables !== 'object' || !o.tables) throw new Error('This file is not a Job Search RAG backup.')
  if (typeof o.version !== 'number' || o.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.')
  for (const t of TABLES) {
    const rows = o.tables[t]
    if (rows !== undefined && !Array.isArray(rows)) throw new Error(`Invalid backup: "${t}" is not a list.`)
  }
  return o as Backup
}

/** Replaces ALL current data with the backup's (API keys stored on this machine are kept). Returns rows imported per table. */
export function importData(b: Backup): Record<string, number> {
  const d = getDb()
  const counts: Record<string, number> = {}
  d.transaction(() => {
    d.prepare('DELETE FROM embeddings').run()
    for (const t of [...TABLES].reverse()) {
      if (t === 'kv') d.prepare("DELETE FROM kv WHERE key NOT LIKE 'key:%'").run()
      else d.prepare(`DELETE FROM ${t}`).run()
    }
    d.prepare("DELETE FROM sqlite_sequence WHERE name <> 'kv'").run()
    for (const t of TABLES) {
      const cols = new Set((d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name))
      let n = 0
      for (const row of b.tables[t] ?? []) {
        if (!row || typeof row !== 'object' || (t === 'kv' && isSecretKv(row.key))) continue
        const keys = Object.keys(row).filter((k) => cols.has(k))
        if (!keys.length) continue
        const values = keys.map((k) => {
          const v = row[k]
          return v === null || typeof v === 'number' || typeof v === 'string' ? v : JSON.stringify(v)
        })
        d.prepare(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...values)
        n++
      }
      counts[t] = n
    }
  })()
  return counts
}
