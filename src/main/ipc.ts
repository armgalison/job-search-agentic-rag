import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { cliOptions, getChat } from './ai'
import { cliStatus } from './ai/claudeCli'
import { clearUsage, recentUsage, usageSummary } from './usage'
import { clearLogs, listLogs, logFilePath, logger } from './log'
import { applicationsRepo, factsRepo, jobsRepo, profileRepo, qaRepo } from './db/repos'
import * as docs from './docs'
import { resetAllData } from './db/client'
import { clearLinkedInSession, jobUrl, openLinkedIn, searchUrl } from './linkedin/window'
import { indexPending, rebuildIndex, syncItemFacts } from './rag'
import { analyzeJob, answerGap, generateCoverLetter, generateResume, learnFromEdits } from './services/generator'
import { importResume } from './services/importResume'
import { getSettings, saveSettings, setKey, updateSettings } from './settings'
import type { AppEvent } from '@shared/types'

/**
 * Each "group.method" channel maps to window.api.group.method in the renderer.
 * Errors are re-thrown to the renderer with the message only (no stack).
 */
export function registerIpc(getWin: () => BrowserWindow | null, emit: (e: AppEvent) => void): void {
  const handle = (channel: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(channel, async (e, ...args) => {
      if (e.sender !== getWin()?.webContents) throw new Error('Unauthorized sender')
      try {
        return await fn(...(args as never[]))
      } catch (err) {
        logger.error('ipc', `${channel} failed: ${(err as Error).message}`, (err as Error).stack)
        throw new Error((err as Error).message)
      }
    })

  /** Reindexes in the background after knowledge-base changes, without blocking the UI. */
  const reindexSoon = () => {
    indexPending().catch((err) => emit({ type: 'toast', level: 'error', message: `Indexing failed: ${(err as Error).message}` }))
  }

  // profile
  handle('profile.get', () => profileRepo.get())
  handle('profile.save', (p: Parameters<typeof profileRepo.save>[0]) => profileRepo.save(p))
  handle('profile.listItems', (kind: Parameters<typeof profileRepo.listItems>[0]) => profileRepo.listItems(kind))
  handle('profile.saveItem', (kind: never, data: never, id?: number) => {
    const item = profileRepo.saveItem(kind, data, id)
    syncItemFacts(item)
    emit({ type: 'facts-changed' })
    reindexSoon()
    return item
  })
  handle('profile.deleteItem', (id: number) => {
    profileRepo.deleteItem(id)
    emit({ type: 'facts-changed' })
  })
  handle('profile.importResume', async () => {
    const win = getWin()
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Resume', extensions: ['pdf', 'docx', 'txt', 'md'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const out = await importResume(res.filePaths[0])
    emit({ type: 'facts-changed' })
    return out
  })

  // facts
  handle('facts.list', () => factsRepo.list())
  handle('facts.add', (text: string, source?: never) => {
    const f = factsRepo.add(text.trim(), source ?? 'manual')
    emit({ type: 'facts-changed' })
    reindexSoon()
    return f
  })
  handle('facts.update', (id: number, text: string) => {
    factsRepo.update(id, text.trim())
    reindexSoon()
  })
  handle('facts.delete', (id: number) => {
    factsRepo.delete(id)
    emit({ type: 'facts-changed' })
  })
  handle('facts.deleteMany', (ids: number[]) => {
    const deleted = factsRepo.deleteMany(Array.isArray(ids) ? ids.slice(0, 10000) : [])
    emit({ type: 'facts-changed' })
    return { deleted }
  })
  handle('facts.reindex', async () => ({ indexed: await rebuildIndex() }))

  // jobs
  handle('jobs.list', () => jobsRepo.list())
  handle('jobs.get', (id: number) => jobsRepo.get(id))
  handle('jobs.addManual', (input: { url: string; title: string; company: string; description: string }) => {
    const lid = input.url.match(/\/jobs\/view\/(\d+)/)?.[1] ?? null
    const job = jobsRepo.upsertCaptured({ ...input, linkedinId: lid, location: '', easyApply: false })
    emit({ type: 'jobs-changed' })
    return job
  })
  handle('jobs.setStatus', (id: number, status: never) => jobsRepo.setStatus(id, status))
  handle('jobs.delete', (id: number) => jobsRepo.delete(id))
  handle('jobs.analyze', async (id: number) => {
    const j = await analyzeJob(id)
    emit({ type: 'jobs-changed' })
    return j
  })
  handle('jobs.answerGap', async (jobId: number, gap: string, answer: string) => {
    const f = await answerGap(jobId, gap, answer)
    emit({ type: 'facts-changed' })
    reindexSoon()
    return f
  })

  // documents
  handle('docs.generateResume', async (jobId: number, lang?: never) => {
    const a = await generateResume(jobId, lang)
    emit({ type: 'applications-changed' })
    return a
  })
  handle('docs.generateCoverLetter', async (jobId: number, lang?: never, tone?: string) => {
    const a = await generateCoverLetter(jobId, lang, tone)
    emit({ type: 'applications-changed' })
    return a
  })
  handle('docs.saveApplication', (a: never) => applicationsRepo.save(a))
  handle('docs.exportResume', (appId: number, format: 'pdf' | 'docx') => docs.exportResume(getWin(), appId, format))
  handle('docs.exportCoverLetter', (appId: number, format: 'pdf' | 'docx') => docs.exportCoverLetter(getWin(), appId, format))
  handle('docs.previewResumeHtml', (r: never) => docs.previewResumeHtml(r))
  handle('docs.previewCoverLetterHtml', (c: never, jobId: number) => docs.previewCoverLetterHtml(c, jobId))
  handle('docs.learnFromEdits', async (appId: number) => {
    const r = await learnFromEdits(appId)
    emit({ type: 'facts-changed' })
    return r
  })

  // applications
  handle('applications.list', () => applicationsRepo.list())
  handle('applications.getByJob', (jobId: number) => applicationsRepo.getByJob(jobId))
  handle('applications.setStatus', (id: number, status: never) => {
    applicationsRepo.setStatus(id, status)
    const a = applicationsRepo.get(id)
    if (a && status === 'applied') jobsRepo.setStatus(a.jobId, 'applied')
  })

  // question memory
  handle('qa.list', () => qaRepo.list())
  handle('qa.save', (q: string, a: string) => qaRepo.save(q, a))
  handle('qa.delete', (id: number) => qaRepo.delete(id))

  // LinkedIn
  handle('linkedin.open', (url?: string) => openLinkedIn(url))
  handle('linkedin.search', (q: never) => openLinkedIn(searchUrl(q)))
  handle('linkedin.openJob', (jobId: number) => {
    const j = jobsRepo.get(jobId)
    if (!j) throw new Error('Job not found')
    openLinkedIn(j.linkedinId ? jobUrl(j.linkedinId) : j.url)
  })
  // Same job, in the system browser (where the user may already be signed in to LinkedIn)
  handle('linkedin.openJobExternal', async (jobId: number) => {
    const j = jobsRepo.get(jobId)
    if (!j) throw new Error('Job not found')
    const url = j.linkedinId ? jobUrl(j.linkedinId) : j.url
    if (!/^https?:\/\//i.test(url ?? '')) throw new Error('This job has no web address')
    await shell.openExternal(url)
  })

  // settings
  handle('settings.get', () => getSettings())
  handle('settings.save', (s: never) => saveSettings(s))
  handle('settings.update', (patch: never) => updateSettings(patch))
  handle('settings.setKey', (provider: 'claude' | 'openai', key: string) => setKey(provider, key))
  handle('settings.cliStatus', () => cliStatus(cliOptions()))

  // logs (Console page)
  handle('logs.list', () => listLogs())
  handle('logs.clear', () => clearLogs())
  handle('logs.filePath', () => logFilePath())

  // usage & budget
  handle('usage.summary', () => {
    const s = getSettings()
    return usageSummary(s.budget, s.prices)
  })
  handle('usage.recent', (limit?: number) => recentUsage(typeof limit === 'number' ? limit : 50))
  handle('usage.clear', () => clearUsage())

  handle('settings.resetAll', async (confirmation: string) => {
    // Second safety check besides the UI: the renderer must send the exact confirmation word
    if (confirmation !== 'RESET') throw new Error('Reset not confirmed.')
    resetAllData()
    await clearLinkedInSession()
  })
  handle('settings.testChat', () =>
    getChat('test').complete({ system: 'Reply in one short sentence.', prompt: 'Say "connection OK" and the name of the model you are.', maxTokens: 200 })
  )
}
