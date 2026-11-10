import { useCallback, useEffect, useState } from 'react'
import { api, ToastContext } from './hooks'
import Applications from './pages/Applications'
import Editor from './pages/Editor'
import Jobs from './pages/Jobs'
import ProfilePage from './pages/Profile'
import SettingsPage from './pages/Settings'
import UsagePage from './pages/Usage'

export type Route = { page: 'profile' } | { page: 'jobs'; jobId?: number } | { page: 'editor'; jobId: number } | { page: 'applications' } | { page: 'usage' } | { page: 'settings' }

const NAV: { page: Route['page']; label: string; icon: string }[] = [
  { page: 'profile', label: 'My profile', icon: '👤' },
  { page: 'jobs', label: 'Jobs', icon: '💼' },
  { page: 'applications', label: 'Applications', icon: '📨' },
  { page: 'usage', label: 'Usage', icon: '💲' },
  { page: 'settings', label: 'Settings', icon: '⚙️' }
]

interface ToastItem {
  id: number
  message: string
  level: 'info' | 'error'
}

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'profile' })
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
              onClick={() => setRoute({ page: n.page } as Route)}
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
          {route.page === 'profile' && <ProfilePage />}
          {route.page === 'jobs' && <Jobs initialJobId={route.jobId} onEdit={(jobId) => setRoute({ page: 'editor', jobId })} />}
          {route.page === 'editor' && <Editor jobId={route.jobId} onBack={() => setRoute({ page: 'jobs', jobId: route.jobId })} />}
          {route.page === 'applications' && <Applications onOpen={(jobId) => setRoute({ page: 'editor', jobId })} />}
          {route.page === 'usage' && <UsagePage />}
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
