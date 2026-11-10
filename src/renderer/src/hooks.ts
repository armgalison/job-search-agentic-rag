import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AppEvent } from '@shared/types'

export const api = window.api

type Toast = (message: string, level?: 'info' | 'error') => void
export const ToastContext = createContext<Toast>(() => {})
export const useToast = (): Toast => useContext(ToastContext)

/** Loads data and reloads automatically when main signals that something changed. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[], events: AppEvent['type'][] = []): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null)
  const toast = useToast()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    loader()
      .then(setData)
      .catch((e: Error) => toast(e.message, 'error'))
  }, deps)
  useEffect(() => {
    reload()
    if (!events.length) return
    return api.onEvent((e) => {
      if (events.includes(e.type)) reload()
    })
  }, [reload])
  return [data, reload]
}

/** Runs an async action with a loading state and an error toast. */
export function useAction(): [boolean, <R>(fn: () => Promise<R>, ok?: string) => Promise<R | undefined>] {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const run = useCallback(
    async <R,>(fn: () => Promise<R>, ok?: string): Promise<R | undefined> => {
      setBusy(true)
      try {
        const r = await fn()
        if (ok) toast(ok)
        return r
      } catch (e) {
        toast((e as Error).message, 'error')
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [toast]
  )
  return [busy, run]
}
