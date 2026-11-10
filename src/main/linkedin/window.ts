import { join } from 'node:path'
import { BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { applicationsRepo, jobsRepo } from '../db/repos'
import { resumeFileName, resumePdf } from '../docs'
import { answerFields, rememberAnswers } from '../services/easyApply'
import { analyzeJob, generateResume } from '../services/generator'
import type { AppEvent, CapturedJob, FormField, JobSearchQuery } from '@shared/types'

let liWin: BrowserWindow | null = null
let emit: (e: AppEvent) => void = () => {}

const ALLOWED_HOST = /(^|\.)linkedin\.com$|(^|\.)licdn\.com$/

function isAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname)
  } catch {
    return false
  }
}

export function openLinkedIn(url = 'https://www.linkedin.com/jobs/'): void {
  if (!isAllowed(url)) throw new Error('URL is outside LinkedIn')
  if (liWin && !liWin.isDestroyed()) {
    liWin.loadURL(url)
    liWin.show()
    liWin.focus()
    return
  }
  liWin = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'LinkedIn — Job Search RAG',
    webPreferences: {
      partition: 'persist:linkedin', // keeps the login across sessions
      preload: join(__dirname, '../preload/linkedin.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  // Keep the window restricted to LinkedIn; external links open in the default browser
  liWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (isAllowed(u)) liWin?.loadURL(u)
    else if (/^https?:/.test(u)) shell.openExternal(u)
    return { action: 'deny' }
  })
  liWin.webContents.on('will-navigate', (e, u) => {
    if (!isAllowed(u)) {
      e.preventDefault()
      if (/^https?:/.test(u)) shell.openExternal(u)
    }
  })
  liWin.on('closed', () => (liWin = null))
  liWin.loadURL(url)
}

/** Closes the LinkedIn window and wipes its session (login cookies, cache, storage). */
export async function clearLinkedInSession(): Promise<void> {
  if (liWin && !liWin.isDestroyed()) liWin.destroy()
  liWin = null
  const s = session.fromPartition('persist:linkedin')
  await s.clearStorageData()
  await s.clearCache()
}

export function searchUrl(q: JobSearchQuery): string {
  const p = new URLSearchParams()
  if (q.keywords) p.set('keywords', q.keywords)
  if (q.location) p.set('location', q.location)
  if (q.remote) p.set('f_WT', '2')
  if (q.easyApplyOnly) p.set('f_AL', 'true')
  p.set('sortBy', 'DD')
  return `https://www.linkedin.com/jobs/search/?${p.toString()}`
}

export function jobUrl(linkedinId: string): string {
  return `https://www.linkedin.com/jobs/view/${encodeURIComponent(linkedinId)}/`
}

/** Only accept messages coming from the LinkedIn window. */
function guard<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) {
  return async (e: IpcMainInvokeEvent, ...args: A): Promise<R> => {
    if (!liWin || e.sender !== liWin.webContents) throw new Error('Unauthorized sender')
    return fn(...args)
  }
}

function jobIdFor(linkedinId: string | null): number | null {
  return linkedinId ? (jobsRepo.byLinkedinId(linkedinId)?.id ?? null) : null
}

export function registerLinkedInIpc(emitter: (e: AppEvent) => void): void {
  emit = emitter

  ipcMain.handle(
    'li:capture',
    guard(async (c: CapturedJob) => {
      const job = jobsRepo.upsertCaptured(c)
      emit({ type: 'jobs-changed' })
      if (job.requirements) return { jobId: job.id, score: job.match?.score ?? null }
      try {
        const analyzed = await analyzeJob(job.id)
        emit({ type: 'jobs-changed' })
        return { jobId: job.id, score: analyzed.match?.score ?? null }
      } catch (err) {
        emit({ type: 'toast', level: 'error', message: `Job captured, but the analysis failed: ${(err as Error).message}` })
        return { jobId: job.id, score: null }
      }
    })
  )

  ipcMain.handle(
    'li:captureList',
    guard((list: CapturedJob[]) => {
      let n = 0
      for (const c of list.slice(0, 100)) {
        if (!c.linkedinId) continue
        jobsRepo.upsertCaptured(c, 'lead')
        n++
      }
      emit({ type: 'jobs-changed' })
      return n
    })
  )

  ipcMain.handle(
    'li:jobState',
    guard((linkedinId: string) => {
      const job = jobsRepo.byLinkedinId(linkedinId)
      if (!job) return null
      const app = applicationsRepo.getByJob(job.id)
      return { jobId: job.id, score: job.match?.score ?? null, hasResume: !!app?.resume }
    })
  )

  ipcMain.handle(
    'li:answerFields',
    guard((linkedinId: string | null, fields: FormField[]) => answerFields(jobIdFor(linkedinId), fields.slice(0, 60)))
  )

  ipcMain.handle(
    'li:resumeFile',
    guard(async (linkedinId: string) => {
      const jobId = jobIdFor(linkedinId)
      if (!jobId) return null
      if (!applicationsRepo.getByJob(jobId)?.resume) {
        await generateResume(jobId)
        emit({ type: 'applications-changed' })
      }
      const pdf = await resumePdf(jobId)
      return pdf ? { name: resumeFileName(jobId, 'pdf'), bytes: new Uint8Array(pdf) } : null
    })
  )

  ipcMain.handle(
    'li:remember',
    guard((linkedinId: string | null, fields: FormField[]) => {
      const saved = rememberAnswers(fields.slice(0, 60))
      if (saved) emit({ type: 'facts-changed' })
      return saved
    })
  )

  ipcMain.handle(
    'li:markApplied',
    guard((linkedinId: string) => {
      const jobId = jobIdFor(linkedinId)
      if (!jobId) return false
      const a = applicationsRepo.ensure(jobId)
      applicationsRepo.setStatus(a.id, 'applied')
      jobsRepo.setStatus(jobId, 'applied')
      emit({ type: 'applications-changed' })
      emit({ type: 'jobs-changed' })
      return true
    })
  )
}
