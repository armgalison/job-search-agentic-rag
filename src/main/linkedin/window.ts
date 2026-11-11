import { join } from 'node:path'
import { BrowserWindow, ipcMain, session, shell, WebContentsView, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { applicationsRepo, jobsRepo } from '../db/repos'
import { resumeFileName, resumePdf } from '../docs'
import { answerFields, rememberAnswers } from '../services/easyApply'
import { analyzeJob, generateResume } from '../services/generator'
import type { AppEvent, CaptureDiagnostics, CapturedJob, FormField, JobSearchQuery, LogLevel } from '@shared/types'
import { logger, onLog } from '../log'
import { attachNavigationPolicy, isLinkedIn, resolveAddress } from './navigation'
import { TOOLBAR_HEIGHT, TOOLBAR_URL } from './toolbar'

/** The window shows our toolbar (its own webContents) with LinkedIn in a view below it. */
let liWin: BrowserWindow | null = null
let liView: WebContentsView | null = null
let emit: (e: AppEvent) => void = () => {}

const PARTITION = 'persist:linkedin'
const HOME = 'https://www.linkedin.com/jobs/'
const openExternal = (url: string) => void shell.openExternal(url)

const page = (): WebContents | null => (liView && !liView.webContents.isDestroyed() ? liView.webContents : null)

function layout(): void {
  if (!liWin || !liView) return
  const { width, height } = liWin.getContentBounds()
  liView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) })
}

function sendNavState(): void {
  const wc = page()
  if (!wc || !liWin || liWin.isDestroyed()) return
  liWin.webContents.send('nav:state', {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward()
  })
}

/** Browser shortcuts while the LinkedIn page has focus. */
function handleShortcuts(e: Electron.Event, input: Electron.Input): void {
  const wc = page()
  if (!wc || input.type !== 'keyDown') return
  const ctrl = input.control || input.meta
  const key = input.key
  let handled = true
  if (input.alt && key === 'ArrowLeft') wc.navigationHistory.goBack()
  else if (input.alt && key === 'ArrowRight') wc.navigationHistory.goForward()
  else if (key === 'F5' || (ctrl && key.toLowerCase() === 'r')) wc.reload()
  else if ((ctrl && key.toLowerCase() === 'l') || key === 'F6') {
    liWin?.webContents.focus()
    liWin?.webContents.send('nav:focus-address')
  } else if (key === 'Escape' && wc.isLoading()) wc.stop()
  else handled = false
  if (handled) e.preventDefault()
}

export function openLinkedIn(url = HOME): void {
  if (!isLinkedIn(url)) throw new Error('URL is outside LinkedIn')
  if (liWin && !liWin.isDestroyed() && page()) {
    void page()!.loadURL(url)
    liWin.show()
    liWin.focus()
    return
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'LinkedIn — Job Search RAG',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/toolbar.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION, // persistent partition: keeps the login across app restarts
      preload: join(__dirname, '../preload/linkedin.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  liWin = win
  liView = view
  win.contentView.addChildView(view)
  layout()
  win.on('resize', layout)
  win.on('maximize', layout)
  win.on('unmaximize', layout)
  win.on('enter-full-screen', layout)
  win.on('leave-full-screen', layout)

  const wc = view.webContents
  // LinkedIn stays here, sign-in popups (Google/Apple/Microsoft) open as child windows, everything else externally
  attachNavigationPolicy(wc, win, { openExternal })
  for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) {
    wc.on(ev as 'did-stop-loading', sendNavState)
  }
  wc.on('page-title-updated', (_e, title) => win.setTitle(`${title} — Job Search RAG`))
  wc.on('before-input-event', handleShortcuts)
  win.webContents.on('before-input-event', (e, input) => {
    // Shortcuts that should also work while the address bar has focus (except text editing keys)
    if (input.type === 'keyDown' && ((input.alt && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) || input.key === 'F5')) {
      handleShortcuts(e, input)
    }
  })
  win.webContents.on('did-finish-load', sendNavState)
  // The toolbar never navigates away from itself
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.on('closed', () => {
    if (!wc.isDestroyed()) wc.close()
    if (liWin === win) {
      liWin = null
      liView = null
    }
  })
  void win.loadURL(TOOLBAR_URL)
  void wc.loadURL(url)
}

/** Closes the LinkedIn window and wipes its session (login cookies, cache, storage). */
export async function clearLinkedInSession(): Promise<void> {
  if (liWin && !liWin.isDestroyed()) liWin.destroy()
  liWin = null
  liView = null
  const s = session.fromPartition(PARTITION)
  await s.clearStorageData()
  await s.clearCache()
}

/** Toolbar buttons and address bar (only accepted from the toolbar page). */
function registerToolbarIpc(): void {
  const fromToolbar = <A extends unknown[]>(fn: (wc: WebContents, ...args: A) => unknown) =>
    (e: IpcMainInvokeEvent, ...args: A): void => {
      const wc = page()
      if (!liWin || liWin.isDestroyed() || e.sender !== liWin.webContents || !wc) return
      fn(wc, ...args)
      wc.focus()
    }
  ipcMain.handle('nav:back', fromToolbar((wc) => wc.navigationHistory.goBack()))
  ipcMain.handle('nav:forward', fromToolbar((wc) => wc.navigationHistory.goForward()))
  ipcMain.handle('nav:reload', fromToolbar((wc) => wc.reload()))
  ipcMain.handle('nav:stop', fromToolbar((wc) => wc.stop()))
  ipcMain.handle('nav:home', fromToolbar((wc) => void wc.loadURL(HOME)))
  ipcMain.handle('nav:external', fromToolbar((wc) => /^https:\/\//i.test(wc.getURL()) && openExternal(wc.getURL())))
  ipcMain.handle(
    'nav:go',
    fromToolbar((wc, text: string) => {
      const a = resolveAddress(String(text).slice(0, 2000))
      if (a.kind === 'load') void wc.loadURL(a.url)
      else if (a.kind === 'external') openExternal(a.url)
      else sendNavState()
    })
  )
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
    if (!page() || e.sender !== page()) throw new Error('Unauthorized sender')
    return fn(...args)
  }
}

function jobIdFor(linkedinId: string | null): number | null {
  return linkedinId ? (jobsRepo.byLinkedinId(linkedinId)?.id ?? null) : null
}

const PANEL_SOURCES = new Set(['linkedin', 'ai', 'embeddings', 'cli'])

export function registerLinkedInIpc(emitter: (e: AppEvent) => void): void {
  emit = emitter
  registerToolbarIpc()
  // Mirror relevant log lines into the panel's mini console
  onLog((entry) => {
    if (!PANEL_SOURCES.has(entry.source) || entry.level === 'debug') return
    page()?.send('li:logline', entry)
  })

  // Step 1: save the job immediately (fast), so the panel can confirm it before the slower AI analysis
  ipcMain.handle(
    'li:capture',
    guard((c: CapturedJob, diag?: CaptureDiagnostics) => {
      if (!c?.title || !c?.description) throw new Error('The job page could not be read (no title or description found).')
      const job = jobsRepo.upsertCaptured(c)
      logger.info('linkedin', `Saved job #${job.id}: ${job.title} — ${job.company || 'unknown company'}`, diag)
      emit({ type: 'jobs-changed' })
      return { jobId: job.id, title: job.title, company: job.company, analyzed: !!job.requirements, score: job.match?.score ?? null, summary: job.match?.summary ?? '' }
    })
  )

  // Step 2: AI analysis (requirements + fit). Can take a while (first run also downloads the embedding model).
  ipcMain.handle(
    'li:analyze',
    guard(async (jobId: number) => {
      const job = await analyzeJob(jobId)
      emit({ type: 'jobs-changed' })
      logger.info('linkedin', `Job #${jobId} analyzed: fit ${job.match?.score ?? '?'}%`)
      return { score: job.match?.score ?? null, summary: job.match?.summary ?? '', gaps: job.match?.gaps.length ?? 0 }
    })
  )

  // Log lines from the LinkedIn panel (shown in its mini console and in the app's Console page)
  ipcMain.handle(
    'li:log',
    guard((level: LogLevel, message: string, detail?: unknown) => {
      const lvl: LogLevel = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info'
      logger[lvl]('linkedin', String(message).slice(0, 1000), detail)
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
