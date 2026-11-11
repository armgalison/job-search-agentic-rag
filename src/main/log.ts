import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel, LogSource } from '@shared/types'
import { emit } from './events'

/**
 * App-wide log: kept in memory (last MAX entries, shown in the Console page), streamed to the UI,
 * and appended to <userData>/logs/app.log (rotated at 2 MB) so problems can be diagnosed after the fact.
 */
const MAX = 1000
const entries: LogEntry[] = []
let seq = 0
let file: string | null = null
const listeners = new Set<(e: LogEntry) => void>()

/** Subscribe to new log entries (e.g. to mirror them into the LinkedIn panel's console). */
export function onLog(fn: (e: LogEntry) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function initLogFile(dir: string): string {
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'app.log')
  return file
}

export function logFilePath(): string | null {
  return file
}

function writeFile(e: LogEntry): void {
  if (!file) return
  try {
    if (existsSync(file) && statSync(file).size > 2 * 1024 * 1024) renameSync(file, `${file}.1`)
    appendFileSync(file, `${e.ts} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}${e.detail ? ` | ${e.detail}` : ''}\n`)
  } catch {
    /* logging must never break the app */
  }
}

const redact = (s: string) => s.replace(/sk-ant-[\w-]{10,}/g, 'sk-ant-***').replace(/sk-[\w-]{20,}/g, 'sk-***')

export function log(level: LogLevel, source: LogSource, message: string, detail?: unknown): LogEntry {
  const d = detail == null ? '' : typeof detail === 'string' ? detail : safeJson(detail)
  const e: LogEntry = { id: ++seq, ts: new Date().toISOString(), level, source, message: redact(message).slice(0, 2000), detail: redact(d).slice(0, 4000) }
  entries.push(e)
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
  writeFile(e)
  emit({ type: 'log', entry: e })
  for (const fn of listeners) {
    try {
      fn(e)
    } catch {
      /* ignore */
    }
  }
  return e
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const logger = {
  debug: (s: LogSource, m: string, d?: unknown) => log('debug', s, m, d),
  info: (s: LogSource, m: string, d?: unknown) => log('info', s, m, d),
  warn: (s: LogSource, m: string, d?: unknown) => log('warn', s, m, d),
  error: (s: LogSource, m: string, d?: unknown) => log('error', s, m, d)
}

export function listLogs(): LogEntry[] {
  return [...entries]
}

export function clearLogs(): void {
  entries.length = 0
}
