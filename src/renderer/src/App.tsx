import { useCallback, useEffect, useState } from 'react'
import { api, ToastContext } from './hooks'
import Applications from './pages/Applications'
import DashboardPage from './pages/Dashboard'
import Editor from './pages/Editor'
import Jobs from './pages/Jobs'
import ProfilePage from './pages/Profile'
import SettingsPage from './pages/Settings'
import UsagePage from './pages/Usage'
import ConsolePage from './pages/Console'
import AgentPage from './pages/Agent'
import BlacklistPage from './pages/Blacklist'

export type Route = { page: 'dashboard' } | { page: 'profile' } | { page: 'jobs'; jobId?: number } | { page: 'editor'; jobId: number } | { page: 'applications' } | { page: 'blacklist' } | { page: 'agent'; jobId?: number } | { page: 'usage' } | { page: 'console' } | { page: 'settings' }

const PAGE_LABEL: Record<Route['page'], string> = {
  dashboard: 'Dashboard',
  profile: 'My profile',
  jobs: 'Jobs',
  editor: 'Documents',
  applications: 'Applications',
  blacklist: 'Blacklist',
  agent: 'Agent',
  usage: 'Usage',
  console: 'Console',
  settings: 'Settings'
}

const NAV: { page: Route['page']; label: string; icon: string }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: '📊' },
  { page: 'profile', label: 'My profile', icon: '👤' },
  { page: 'jobs', label: 'Jobs', icon: '💼' },
  { page: 'agent', label: 'Agent', icon: '🤖' },
  { page: 'applications', label: 'Applications', icon: '📨' },
  { page: 'blacklist', label: 'Blacklist', icon: '🚫' },
  { page: 'usage', label: 'Usage', icon: '💲' },
  { page: 'console', label: 'Console', icon: '🖥️' },
  { page: 'settings', label: 'Settings', icon: '⚙️' }
]

interface ToastItem {
  id: number
  message: string
  level: 'info' | 'error'
}

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' })
  /** Pages visited through links (not the sidebar), so "Back" returns where the user came from */
  const [history, setHistory] = useState<Route[]>([])
  const go = useCallback(
    /** `here` overrides the entry saved for the current page (e.g. the job selected on the Jobs page) */
    (to: Route, here: Route = route) => {
      setHistory((h) => [...h.slice(-30), here])
      setRoute(to)
    },
    [route]
  )
  const back = useCallback(
    (fallback?: Route) => {
      const prev = history[history.length - 1]
      if (prev) {
        setHistory((h) => h.slice(0, -1))
        setRoute(prev)
      } else if (fallback) setRoute(fallback)
    },
    [history]
  )
  const prev = history[history.length - 1]
  const backLabel = prev ? PAGE_LABEL[prev.page] : undefined

  // Mouse "back" button and Alt+← behave like the in-app Back button
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3 && history.length) {
        e.preventDefault()
        back()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft' && history.length) {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [back, history.length])
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, level: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, level }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), level === 'error' ? 8000 : 3500)
  }, [])

  useEffect(
    () =>
      api.onEvent((e) => {
        if (e.type === 'toast') toast(e.message, e.level)
      }),
    [toast]
  )

  return (
    <ToastContext.Provider value={toast}>
      <div className="flex h-full">
        <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 px-2 pt-1 text-sm font-bold tracking-tight">Job Search RAG</div>
          {NAV.map((n) => (
            <button
              key={n.page}
              onClick={() => {
                setHistory([])
                setRoute({ page: n.page } as Route)
              }}
              className={`mb-1 rounded-md px-2 py-1.5 text-left text-sm ${
                route.page === n.page || (route.page === 'editor' && n.page === 'jobs')
                  ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="mr-2">{n.icon}</span>
              {n.label}
            </button>
          ))}
          <button className="btn-sec mt-auto justify-center" onClick={() => api.linkedin.open()}>
            Open LinkedIn
          </button>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          {route.page === 'dashboard' && <DashboardPage onApplications={() => go({ page: 'applications' })} onJobs={() => go({ page: 'jobs' })} />}
          {route.page === 'profile' && <ProfilePage />}
          {route.page === 'jobs' && (
            <Jobs
              key={route.jobId ?? 'list'}
              initialJobId={route.jobId}
              backLabel={backLabel}
              onBack={() => back()}
              onEdit={(jobId) => go({ page: 'editor', jobId }, { page: 'jobs', jobId })}
              onAgent={(jobId) => go({ page: 'agent', jobId }, { page: 'jobs', jobId })}
            />
          )}
          {route.page === 'agent' && <AgentPage initialJobId={route.jobId} />}
          {route.page === 'editor' && (
            <Editor
              jobId={route.jobId}
              backLabel={backLabel ?? 'Job'}
              onBack={() => back({ page: 'jobs', jobId: route.jobId })}
              onJob={prev?.page === 'jobs' && prev.jobId === route.jobId ? undefined : () => go({ page: 'jobs', jobId: route.jobId })}
            />
          )}
          {route.page === 'applications' && (
            <Applications onOpen={(jobId) => go({ page: 'editor', jobId })} onJob={(jobId) => go({ page: 'jobs', jobId })} onAgent={() => go({ page: 'agent' })} />
          )}
          {route.page === 'blacklist' && <BlacklistPage />}
          {route.page === 'usage' && <UsagePage />}
          {route.page === 'console' && <ConsolePage />}
          {route.page === 'settings' && <SettingsPage />}
        </main>
      </div>
      <div className="fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md px-3 py-2 text-sm shadow-lg ${t.level === 'error' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
