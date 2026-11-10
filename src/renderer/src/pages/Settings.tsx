import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatProviderId, CliStatus, EmbedProviderId, Settings } from '@shared/types'
import { api, useAction, useLoad, useToast } from '../hooks'

const CHAT: Record<ChatProviderId, string> = {
  'claude-cli': 'Claude subscription (claude -p)',
  claude: 'Claude API (API key, per-token billing)',
  openai: 'OpenAI',
  ollama: 'Ollama (local)'
}
const EMBED: Record<EmbedProviderId, string> = { local: 'Local (transformers.js, free)', openai: 'OpenAI', ollama: 'Ollama (local)' }

type Editable = Omit<Settings, 'hasKey'>

export default function SettingsPage() {
  const [loaded, reload] = useLoad(() => api.settings.get(), [])
  const [s, setS] = useState<Settings | null>(null)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [, run] = useAction()
  const toast = useToast()
  const pending = useRef<Partial<Editable>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setS(loaded), [loaded])

  /** Saves the accumulated changes now (also used before Test/Check so they use what is on screen). */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const patch = pending.current
    pending.current = {}
    if (!Object.keys(patch).length) return
    setStatus('saving')
    try {
      await api.settings.update(patch)
      setStatus('saved')
    } catch (e) {
      setStatus('error')
      toast((e as Error).message, 'error')
    }
  }, [toast])

  // Flush pending changes when leaving the page
  useEffect(() => () => void flush(), [flush])

  if (!s) return null

  /** Applies a change on screen and saves it automatically (immediately for selects, debounced while typing). */
  const change = (patch: Partial<Editable>, immediate = false) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur))
    pending.current = { ...pending.current, ...patch }
    setStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    if (immediate) void flush()
    else timer.current = setTimeout(() => void flush(), 600)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <span className="ml-auto text-xs text-zinc-500" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'error' ? '⚠ Not saved' : '✔ All changes saved'}
        </span>
      </div>

      <section className="card mb-5">
        <h2 className="h2">Text generation</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label>
            <span className="label">Provider</span>
            <select className="input" value={s.chatProvider} onChange={(e) => change({ chatProvider: e.target.value as ChatProviderId }, true)}>
              {Object.entries(CHAT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Model</span>
            <input className="input" value={s.chatModel[s.chatProvider]} onChange={(e) => change({ chatModel: { ...s.chatModel, [s.chatProvider]: e.target.value } })} />
          </label>
        </div>
        {s.chatProvider === 'claude-cli' && (
          <CliPanel path={s.claudeCliPath} onPath={(claudeCliPath) => change({ claudeCliPath })} beforeCheck={flush} />
        )}
        {s.chatProvider === 'claude' && !s.hasKey.claude && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">⚠ No Anthropic API key saved — add one under “API keys” below, or switch to “Claude subscription”.</p>
        )}
        {s.chatProvider === 'openai' && !s.hasKey.openai && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">⚠ No OpenAI API key saved — add one under “API keys” below.</p>
        )}
        <p className="mt-2 text-xs text-zinc-500">Every call is logged with its tokens and cost, and checked against your budget — see Usage.</p>
        <div className="mt-3 flex justify-end">
          <button
            className="btn-sec"
            onClick={() =>
              run(async () => {
                await flush()
                return api.settings.testChat()
              }).then((r) => r && toast(r))
            }
          >
            Test connection
          </button>
        </div>
      </section>

      <section className="card mb-5">
        <h2 className="h2">Embeddings (RAG semantic search)</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label>
            <span className="label">Provider</span>
            <select className="input" value={s.embedProvider} onChange={(e) => change({ embedProvider: e.target.value as EmbedProviderId }, true)}>
              {Object.entries(EMBED).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Model</span>
            <input className="input" value={s.embedModel[s.embedProvider]} onChange={(e) => change({ embedModel: { ...s.embedModel, [s.embedProvider]: e.target.value } })} />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Local mode downloads the model (~120 MB) on first use. Anthropic does not offer embeddings, so with Claude use “Local” or OpenAI/Ollama. After
          changing the embedding model, facts are re-embedded automatically on the next search (or use Reindex in the knowledge base).
        </p>
      </section>

      <section className="card mb-5">
        <h2 className="h2">API keys</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Only needed for the “Claude API” and “OpenAI” providers — the Claude subscription provider uses your Claude Code login instead. Keys are
          encrypted with the operating system keychain and never leave the app’s main process.
        </p>
        <div className="grid grid-cols-1 gap-3">
          {(['claude', 'openai'] as const).map((p) => (
            <KeyField key={p} provider={p} saved={s.hasKey[p]} onChanged={reload} />
          ))}
        </div>
      </section>

      <section className="card mb-5">
        <h2 className="h2">Other</h2>
        <div className="grid grid-cols-1 gap-3">
          <label>
            <span className="label">Ollama URL</span>
            <input className="input" value={s.ollamaUrl} onChange={(e) => change({ ollamaUrl: e.target.value })} />
          </label>
          <label>
            <span className="label">Default language (generated documents and AI output)</span>
            <select className="input" value={s.defaultLang} onChange={(e) => change({ defaultLang: e.target.value as 'pt' | 'en' }, true)}>
              <option value="en">English</option>
              <option value="pt">Portuguese</option>
            </select>
          </label>
        </div>
      </section>

      <DangerZone />
    </div>
  )
}

function KeyField({ provider, saved, onChanged }: { provider: 'claude' | 'openai'; saved: boolean; onChanged: () => void }) {
  const [value, setValue] = useState('')
  const [busy, run] = useAction()
  const name = provider === 'claude' ? 'Anthropic' : 'OpenAI'
  const save = (key: string, msg: string) =>
    run(() => api.settings.setKey(provider, key), msg).then(() => {
      setValue('')
      onChanged()
    })
  return (
    <div>
      <span className="label">
        {name} API key {saved ? '✅ saved' : '— not set'}
      </span>
      <div className="flex gap-2">
        <input
          className="input"
          type="password"
          placeholder={saved ? '•••••••• (type a new key to replace it)' : provider === 'claude' ? 'sk-ant-…' : 'sk-…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && save(value, `${name} key saved`)}
        />
        <button className="btn shrink-0" disabled={busy || !value.trim()} onClick={() => save(value, `${name} key saved`)}>
          Save key
        </button>
        {saved && (
          <button className="btn-danger shrink-0" disabled={busy} onClick={() => confirm(`Remove the saved ${name} key?`) && save('', `${name} key removed`)}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function DangerZone() {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, run] = useAction()

  const reset = async () => {
    const ok = await run(async () => {
      await api.settings.resetAll(confirmText)
      return true
    })
    // Reload so every screen starts from the empty state
    if (ok) location.reload()
  }

  return (
    <section className="mt-10 rounded-lg border border-red-300 p-4 dark:border-red-900">
      <h2 className="h2 text-red-700 dark:text-red-400">Danger zone</h2>
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400">Delete all data and return the app to its initial state.</p>
          <button className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500" onClick={() => setOpen(true)}>
            Reset system…
          </button>
        </div>
      ) : (
        <div className="text-sm">
          <p className="mb-2">This permanently deletes:</p>
          <ul className="mb-3 list-disc pl-5 text-zinc-600 dark:text-zinc-400">
            <li>your profile, experience, education, skills and every knowledge-base fact</li>
            <li>all jobs, generated resumes and cover letters, and applications</li>
            <li>saved Easy Apply answers</li>
            <li>settings and stored API keys</li>
            <li>the LinkedIn login session (you will need to log in again)</li>
          </ul>
          <p className="mb-3 text-zinc-600 dark:text-zinc-400">
            Files you exported (PDF/DOCX) are not touched. The downloaded local embedding model is kept so it does not have to be downloaded again.
            <b> This cannot be undone.</b>
          </p>
          <label className="mb-3 block">
            <span className="label">
              Type <b>RESET</b> to confirm
            </span>
            <input className="input max-w-60" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
          </label>
          <div className="flex gap-2">
            <button
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={confirmText !== 'RESET' || busy}
              onClick={reset}
            >
              {busy ? 'Deleting…' : 'Delete all data'}
            </button>
            <button
              className="btn-sec"
              onClick={() => {
                setOpen(false)
                setConfirmText('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function CliPanel({ path, onPath, beforeCheck }: { path: string; onPath: (p: string) => void; beforeCheck: () => Promise<void> }) {
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [busy, run] = useAction()
  const check = () =>
    run(async () => {
      await beforeCheck()
      return api.settings.cliStatus()
    }).then((st) => st && setStatus(st))
  useEffect(() => {
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mt-3 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="mb-2 text-zinc-600 dark:text-zinc-400">
        Uses your Claude Pro/Max plan through the Claude Code CLI (<code>claude -p</code>) instead of an API key: calls count against your plan’s usage
        limits, not per-token billing. The CLI runs with no tools, no MCP servers and none of your settings or CLAUDE.md files. Model accepts a full id
        (e.g. <code>claude-sonnet-5-5</code>) or an alias (<code>opus</code>, <code>sonnet</code>, <code>haiku</code>).
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-60 flex-1">
          <span className="label">CLI command or path</span>
          <input className="input" value={path} onChange={(e) => onPath(e.target.value)} placeholder="claude (auto-detected)" />
        </label>
        <button className="btn-sec" disabled={busy} onClick={check}>
          {busy ? 'Checking…' : 'Check CLI'}
        </button>
      </div>
      {status && (
        <div className="mt-2 text-xs">
          {status.found && status.loggedIn && !status.error ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              ✔ {status.version} — logged in via {status.authMethod}
              {status.subscriptionType && ` (${status.subscriptionType} plan)`}
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">
              ⚠ {status.error || (status.found ? 'The CLI is not logged in. Run "claude" in a terminal and log in with your Claude account.' : 'CLI not found.')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
