import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/jsr-test' }, safeStorage: { isEncryptionAvailable: () => false } }))

import { openDb } from '../src/main/db/client'
import { getSettings, updateSettings } from '../src/main/settings'
import { resolveCliPath } from '../src/main/ai/claudeCli'

beforeEach(() => openDb(':memory:'))

describe('settings', () => {
  it('defaults to the Claude subscription provider when nothing was saved', () => {
    expect(getSettings().chatProvider).toBe('claude-cli')
  })

  it('update() merges only the given fields, including nested ones', () => {
    updateSettings({ chatProvider: 'ollama', budget: { ...getSettings().budget, monthlyUsd: 5 } })
    updateSettings({ chatModel: { ...getSettings().chatModel, 'claude-cli': 'sonnet' } })
    updateSettings({ budget: { ...getSettings().budget, warnPct: 50 } })
    const s = getSettings()
    expect(s.chatProvider).toBe('ollama')
    expect(s.chatModel['claude-cli']).toBe('sonnet')
    expect(s.chatModel.openai).toBe('gpt-4.1')
    expect(s.budget).toMatchObject({ monthlyUsd: 5, warnPct: 50 })
  })
})

describe('resolveCliPath', () => {
  const home = mkdtempSync(join(tmpdir(), 'jsr-home-'))
  const bin = join(home, '.local', 'bin')
  mkdirSync(bin, { recursive: true })

  it('finds claude.exe in ~/.local/bin on Windows even when PATH does not include it', () => {
    writeFileSync(join(bin, 'claude.exe'), '')
    expect(resolveCliPath('claude', { PATH: 'C:\\Windows\\System32' }, 'win32', home)).toBe(join(bin, 'claude.exe'))
  })

  it('prefers a match on PATH, and keeps explicit paths as-is', () => {
    const other = mkdtempSync(join(tmpdir(), 'jsr-path-'))
    writeFileSync(join(other, 'claude'), '')
    expect(resolveCliPath('claude', { PATH: other }, 'linux', home)).toBe(join(other, 'claude'))
    expect(resolveCliPath('"C:\\Tools\\claude.exe"', {}, 'win32', home)).toBe('C:\\Tools\\claude.exe')
  })

  it('falls back to the bare command when nothing is found', () => {
    expect(resolveCliPath('', { PATH: '' }, 'linux', mkdtempSync(join(tmpdir(), 'jsr-empty-')))).toBe('claude')
  })
})
