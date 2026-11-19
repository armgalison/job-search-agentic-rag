import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppEvent } from '@shared/types'

// Explicit list of exposed methods: the renderer can only reach these channels.
const groups = {
  profile: ['get', 'save', 'listItems', 'saveItem', 'deleteItem', 'importResume'],
  facts: ['list', 'add', 'update', 'delete', 'deleteMany', 'reindex'],
  jobs: ['list', 'get', 'addManual', 'setStatus', 'delete', 'analyze', 'answerGap'],
  docs: [
    'generateResume',
    'generateCoverLetter',
    'saveApplication',
    'exportResume',
    'exportCoverLetter',
    'previewResumeHtml',
    'previewCoverLetterHtml',
    'learnFromEdits'
  ],
  applications: ['list', 'getByJob', 'setStatus', 'setArchived'],
  blacklist: ['list', 'add', 'delete'],
  qa: ['list', 'save', 'delete'],
  linkedin: ['open', 'search', 'openJob', 'openJobExternal'],
  settings: ['get', 'save', 'update', 'setKey', 'testChat', 'cliStatus', 'resetAll', 'exportData', 'importData'],
  usage: ['summary', 'recent', 'clear'],
  logs: ['list', 'clear', 'filePath'],
  agent: ['start', 'stop', 'state', 'answer', 'checkBrowser'],
  outreach: ['list', 'delete']
} as const

const api: Record<string, unknown> = {}
for (const [group, methods] of Object.entries(groups)) {
  const g: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const m of methods) {
    g[m] = (...args) =>
      ipcRenderer.invoke(`${group}.${m}`, ...args).catch((err: Error) => {
        // Strip the technical prefix Electron adds to error messages
        throw new Error(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      })
  }
  api[group] = g
}
api.onEvent = (cb: (e: AppEvent) => void) => {
  const listener = (_: unknown, e: AppEvent) => cb(e)
  ipcRenderer.on('app:event', listener)
  return () => ipcRenderer.removeListener('app:event', listener)
}

contextBridge.exposeInMainWorld('api', api as unknown as Api)
