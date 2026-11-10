import { safeStorage } from 'electron'
import { kv } from './db/repos'
import { defaultSettings, type Settings } from '@shared/types'

type StoredSettings = Omit<Settings, 'hasKey'>
type KeyProvider = 'claude' | 'openai'

export function getSettings(): Settings {
  const stored = kv.get<Partial<StoredSettings>>('settings') ?? {}
  const merged: StoredSettings = {
    ...defaultSettings,
    ...stored,
    budget: { ...defaultSettings.budget, ...(stored.budget ?? {}) },
    prices: { ...(stored.prices ?? {}) },
    chatModel: { ...defaultSettings.chatModel, ...(stored.chatModel ?? {}) },
    embedModel: { ...defaultSettings.embedModel, ...(stored.embedModel ?? {}) }
  }
  return { ...merged, hasKey: { claude: !!getKey('claude'), openai: !!getKey('openai') } }
}

export function saveSettings(s: StoredSettings): void {
  // Never persist hasKey, even if the renderer sends it
  const { chatProvider, chatModel, embedProvider, embedModel, ollamaUrl, defaultLang, claudeCliPath, budget, prices } = s
  kv.set('settings', { chatProvider, chatModel, embedProvider, embedModel, ollamaUrl, defaultLang, claudeCliPath, budget, prices })
}

/** Merges a partial change into the stored settings (nested records are merged too). */
export function updateSettings(patch: Partial<StoredSettings>): void {
  const { hasKey: _k, ...cur } = getSettings()
  void _k
  saveSettings({
    ...cur,
    ...patch,
    chatModel: { ...cur.chatModel, ...(patch.chatModel ?? {}) },
    embedModel: { ...cur.embedModel, ...(patch.embedModel ?? {}) },
    budget: { ...cur.budget, ...(patch.budget ?? {}) },
    prices: patch.prices ?? cur.prices
  })
}

/** API keys are encrypted with the OS keychain (safeStorage) and never leave the main process. */
export function setKey(provider: KeyProvider, key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    kv.set(`key:${provider}`, null)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable; the key cannot be stored securely.')
  }
  kv.set(`key:${provider}`, safeStorage.encryptString(trimmed).toString('base64'))
}

export function getKey(provider: KeyProvider): string | null {
  const enc = kv.get<string>(`key:${provider}`)
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}
