import { join } from 'node:path'
import { app, BrowserWindow, Notification, shell } from 'electron'
import { openDb } from './db/client'
import { registerIpc } from './ipc'
import { setEventSink } from './events'
import { initLogFile, logger } from './log'
import { registerLinkedInIpc } from './linkedin/window'
import { setQuestionNotifier } from './agent/session'
import { stopAgent } from './agent/runner'
import { stopMcpServer } from './agent/mcpServer'
import type { AppEvent } from '@shared/types'

let mainWin: BrowserWindow | null = null

function emit(e: AppEvent): void {
  mainWin?.webContents.send('app:event', e)
}

function createWindow(): void {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    title: 'Job Search RAG',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWin.on('ready-to-show', () => mainWin?.show())
  mainWin.on('closed', () => (mainWin = null))
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) mainWin.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWin.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  initLogFile(join(app.getPath('userData'), 'logs'))
  logger.info('app', `Starting Job Search RAG ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`)
  openDb(join(app.getPath('userData'), 'job-search.db'))
  setEventSink(emit)
  process.on('uncaughtException', (err) => logger.error('app', `Uncaught exception: ${err.message}`, err.stack))
  process.on('unhandledRejection', (err) => logger.error('app', `Unhandled rejection: ${(err as Error)?.message ?? String(err)}`, (err as Error)?.stack))
  registerIpc(() => mainWin, emit)
  registerLinkedInIpc(emit)
  // The agent waits for the candidate: make sure they notice
  setQuestionNotifier((q) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title: q.kind === 'approval' ? 'Agent: approval needed' : 'Agent has a question', body: q.question.slice(0, 200) })
      n.on('click', () => {
        mainWin?.show()
        mainWin?.focus()
      })
      n.show()
    }
    mainWin?.flashFrame(true)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopAgent()
  stopMcpServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
