import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry, LogLevel, LogSource } from '@shared/types'
import { api, useAction, useToast } from '../hooks'

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
const SOURCES: LogSource[] = ['app', 'linkedin', 'ai', 'cli', 'embeddings', 'import', 'ipc', 'docs']
const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-zinc-500',
  info: 'text-zinc-800 dark:text-zinc-200',
  warn: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-700 dark:text-red-400'
}
const LEVEL_ICON: Record<LogLevel, string> = { debug: '·', info: 'ℹ', warn: '⚠', error: '✖' }

export default function ConsolePage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [minLevel, setMinLevel] = useState<LogLevel>('info')
  const [source, setSource] = useState<LogSource | 'all'>('all')
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [, run] = useAction()
  const toast = useToast()
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.logs.list().then(setEntries)
    void api.logs.filePath().then(setFilePath)
    return api.onEvent((e) => {
      if (e.type === 'log') setEntries((cur) => [...cur.slice(-999), e.entry])
    })
  }, [])

  const shown = useMemo(() => {
    const min = LEVELS.indexOf(minLevel)
    const q = query.toLowerCase()
    return entries.filter(
      (e) =>
        LEVELS.indexOf(e.level) >= min &&
        (source === 'all' || e.source === source) &&
        (!q || e.message.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q))
    )
  }, [entries, minLevel, source, query])

  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: 'end' })
  }, [shown, follow])

  const errors = entries.filter((e) => e.level === 'error').length
  const asText = (list: LogEntry[]) => list.map((e) => `${e.ts} ${e.level.toUpperCase()} [${e.source}] ${e.message}${e.detail ? ` | ${e.detail}` : ''}`).join('\n')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-semibold">Console</h1>
        <span className="text-sm text-zinc-500">
          {entries.length} entries{errors ? ` · ${errors} error(s)` : ''}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={minLevel} onChange={(e) => setMinLevel(e.target.value as LogLevel)} aria-label="Minimum level">
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l === 'debug' ? 'All levels' : `${l} and above`}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={source} onChange={(e) => setSource(e.target.value as LogSource | 'all')} aria-label="Source">
            <option value="all">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input className="input w-48" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
          <button className="btn-sec" onClick={() => navigator.clipboard.writeText(asText(shown)).then(() => toast('Copied to the clipboard'))}>
            Copy
          </button>
          <button
            className="btn-sec"
            onClick={() =>
              run(async () => {
                await api.logs.clear()
                setEntries([])
              })
            }
          >
            Clear
          </button>
        </div>
      </div>
      <div className="card min-h-0 flex-1 overflow-auto p-0 font-mono text-xs" role="log" aria-live="off">
        {shown.map((e) => (
          <div key={e.id} className="border-b border-zinc-100 px-3 py-1 last:border-0 dark:border-zinc-800">
            <button className={`flex w-full gap-2 text-left ${LEVEL_STYLE[e.level]}`} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
              <span className="shrink-0 text-zinc-500 tabular-nums">{new Date(e.ts).toLocaleTimeString('en-US', { hour12: false })}</span>
              <span className="w-3 shrink-0" aria-label={e.level}>
                {LEVEL_ICON[e.level]}
              </span>
              <span className="w-20 shrink-0 text-indigo-600 dark:text-indigo-400">{e.source}</span>
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{e.message}</span>
              {e.detail && <span className="shrink-0 text-zinc-400">{expanded === e.id ? '▾' : '▸'}</span>}
            </button>
            {expanded === e.id && e.detail && (
              <pre className="mt-1 mb-1 ml-28 overflow-x-auto rounded bg-zinc-50 p-2 whitespace-pre-wrap text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">{pretty(e.detail)}</pre>
            )}
          </div>
        ))}
        {shown.length === 0 && <div className="p-4 font-sans text-sm text-zinc-500">Nothing logged yet. Actions in the app and the LinkedIn panel show up here.</div>}
        <div ref={bottom} />
      </div>
      {filePath && <p className="mt-2 text-xs text-zinc-500">Also saved to {filePath}</p>}
    </div>
  )
}

function pretty(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2)
  } catch {
    return detail
  }
}
