/**
 * Preload for the LinkedIn window's toolbar (back/forward/reload + address bar).
 * The toolbar is the app's own page, separate from LinkedIn: LinkedIn cannot see or change it.
 */
import { contextBridge, ipcRenderer } from 'electron'

export interface NavState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

contextBridge.exposeInMainWorld('nav', {
  back: () => ipcRenderer.invoke('nav:back'),
  forward: () => ipcRenderer.invoke('nav:forward'),
  reload: () => ipcRenderer.invoke('nav:reload'),
  stop: () => ipcRenderer.invoke('nav:stop'),
  home: () => ipcRenderer.invoke('nav:home'),
  external: () => ipcRenderer.invoke('nav:external'),
  go: (text: string) => ipcRenderer.invoke('nav:go', String(text)),
  onState: (cb: (s: NavState) => void) => ipcRenderer.on('nav:state', (_e, s: NavState) => cb(s)),
  onFocusAddress: (cb: () => void) => ipcRenderer.on('nav:focus-address', () => cb())
})
