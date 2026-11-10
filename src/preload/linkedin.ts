/**
 * Preload for the LinkedIn window. Runs in an isolated world: it can access the page DOM,
 * but the page cannot access anything here (no API is exposed to LinkedIn).
 *
 * Principle: the app captures, suggests and fills in — but NEVER submits an application.
 * The final "Submit" click is always the user's.
 *
 * LinkedIn selectors change often, so every extraction has several fallbacks.
 * Button/text matching covers both the English and Portuguese LinkedIn UI.
 */
import { ipcRenderer } from 'electron'
import type { CapturedJob, FieldAnswer, FormField } from '@shared/types'

// ---------------- DOM utilities ----------------
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel)
const firstText = (sels: string[], root: ParentNode = document): string => {
  for (const s of sels) {
    const t = $(s, root)?.textContent?.replace(/\s+/g, ' ').trim()
    if (t) return t
  }
  return ''
}
const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

function currentJobId(): string | null {
  const u = new URL(location.href)
  return u.searchParams.get('currentJobId') ?? u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ?? null
}

// ---------------- job extraction ----------------
function extractCurrentJob(): CapturedJob | null {
  const id = currentJobId()
  const title = firstText([
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    '.t-24.t-bold',
    'main h1'
  ])
  const company = firstText([
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name',
    'a[href*="/company/"]'
  ])
  const location_ = firstText([
    '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
    '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text',
    '.jobs-unified-top-card__bullet'
  ])
  const descEl = $('#job-details') ?? $('.jobs-description__content') ?? $('.jobs-box__html-content') ?? $('[class*="jobs-description"]')
  const description = (descEl?.innerText ?? '').trim()
  if (!title || !description) return null
  const easyApply = [...document.querySelectorAll<HTMLButtonElement>('.jobs-apply-button, button')].some((b) =>
    /easy apply|candidatura simplificada/i.test(b.innerText)
  )
  return {
    url: id ? `https://www.linkedin.com/jobs/view/${id}/` : location.href,
    linkedinId: id,
    title,
    company,
    location: location_,
    description,
    easyApply
  }
}

function extractJobList(): CapturedJob[] {
  const cards = document.querySelectorAll<HTMLElement>('[data-job-id], [data-occludable-job-id], li.jobs-search-results__list-item')
  const out: CapturedJob[] = []
  const seen = new Set<string>()
  cards.forEach((card) => {
    const id =
      card.getAttribute('data-job-id') ??
      card.getAttribute('data-occludable-job-id') ??
      $('a[href*="/jobs/view/"]', card)?.getAttribute('href')?.match(/\/jobs\/view\/(\d+)/)?.[1] ??
      null
    if (!id || seen.has(id)) return
    seen.add(id)
    const title = firstText(['.job-card-list__title--link strong', '.job-card-list__title', 'a[href*="/jobs/view/"] strong', 'a[href*="/jobs/view/"]'], card)
    if (!title) return
    out.push({
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      linkedinId: id,
      title,
      company: firstText(['.artdeco-entity-lockup__subtitle', '.job-card-container__primary-description', '.job-card-container__company-name'], card),
      location: firstText(['.job-card-container__metadata-wrapper li', '.job-card-container__metadata-item', '.artdeco-entity-lockup__caption'], card),
      description: '',
      easyApply: /easy apply|candidatura simplificada/i.test(card.innerText)
    })
  })
  return out
}

// ---------------- Easy Apply ----------------
function easyApplyDialog(): HTMLElement | null {
  return $('.jobs-easy-apply-modal') ?? $('[data-test-modal-id="easy-apply-modal"]') ?? $('div[role="dialog"].artdeco-modal')
}

interface FieldRef {
  field: FormField
  els: HTMLElement[]
}

function labelFor(el: HTMLElement, dialog: HTMLElement): string {
  const id = el.getAttribute('id')
  if (id) {
    const l = dialog.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    if (l) return clean(l.innerText)
  }
  const aria = el.getAttribute('aria-label')
  if (aria) return clean(aria)
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const t = labelledBy
      .split(/\s+/)
      .map((x) => document.getElementById(x)?.innerText ?? '')
      .join(' ')
    if (clean(t)) return clean(t)
  }
  const legend = el.closest('fieldset')?.querySelector('legend')
  if (legend) return clean(legend.innerText)
  return clean(el.closest('[class*="form-component"], .fb-dash-form-element, .jobs-easy-apply-form-element')?.querySelector('label, span')?.textContent)
}

function collectFields(dialog: HTMLElement): FieldRef[] {
  const refs: FieldRef[] = []
  const radioGroups = new Map<string, HTMLInputElement[]>()

  dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el, i) => {
    if (el instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'search'].includes(el.type)) return
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const name = el.name || `radio-${i}`
      radioGroups.set(name, [...(radioGroups.get(name) ?? []), el])
      return
    }
    const key = el.id || el.getAttribute('name') || `field-${i}`
    const label = labelFor(el, dialog)
    const required = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label)
    let field: FormField
    if (el instanceof HTMLSelectElement) {
      const options = [...el.options].map((o) => clean(o.text)).filter((t) => t && !/^(select|selecione)/i.test(t))
      field = { key, label, type: 'select', options, required, value: el.selectedIndex > 0 ? clean(el.options[el.selectedIndex].text) : '' }
    } else if (el instanceof HTMLTextAreaElement) {
      field = { key, label, type: 'textarea', options: [], required, value: el.value }
    } else if (el.type === 'file') {
      field = { key, label: label || 'Resume', type: 'file', options: [], required, value: '' }
    } else if (el.type === 'checkbox') {
      field = { key, label, type: 'checkbox', options: [], required, value: el.checked ? 'true' : '' }
    } else {
      field = { key, label, type: el.type === 'number' || el.inputMode === 'numeric' ? 'number' : 'text', options: [], required, value: el.value }
    }
    if (field.label || field.type === 'file') refs.push({ field, els: [el] })
  })

  radioGroups.forEach((inputs, name) => {
    const label = clean(inputs[0].closest('fieldset')?.querySelector('legend')?.innerText) || labelFor(inputs[0], dialog)
    const options = inputs.map((r) => labelFor(r, dialog) || r.value)
    const checked = inputs.findIndex((r) => r.checked)
    refs.push({
      field: { key: name, label, type: 'radio', options, required: inputs.some((r) => r.required), value: checked >= 0 ? options[checked] : '' },
      els: inputs
    })
  })
  return refs
}

/** Sets the value in a way LinkedIn's React notices the change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

function mark(el: HTMLElement, origin: FieldAnswer['origin']): void {
  const color = origin === 'memory' ? '#2f9e44' : origin === 'ai' ? '#3b5bdb' : '#f08c00'
  el.style.outline = `2px solid ${color}`
  el.style.outlineOffset = '2px'
  el.title = origin === 'memory' ? 'Filled from a saved answer' : origin === 'ai' ? 'Suggested by AI — please review' : 'No information in your knowledge base — fill this in yourself'
}

function applyAnswer(ref: FieldRef, a: FieldAnswer): void {
  const { field, els } = ref
  if (field.value && a.origin !== 'memory') return // never overwrite what is already filled in
  if (!a.value) {
    mark(els[0], 'unknown')
    return
  }
  if (field.type === 'radio') {
    const idx = field.options.indexOf(a.value)
    const input = els[idx] as HTMLInputElement | undefined
    if (input) {
      input.click()
      mark(input.closest('fieldset') ?? input, a.origin)
    }
    return
  }
  const el = els[0]
  if (el instanceof HTMLSelectElement) {
    const opt = [...el.options].find((o) => clean(o.text) === a.value)
    if (opt) {
      el.value = opt.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    const want = /^(true|sim|yes|1)$/i.test(a.value)
    if (el.checked !== want) el.click()
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, a.value)
  }
  mark(el, a.origin)
}

async function attachResume(refs: FieldRef[]): Promise<boolean> {
  const fileRef = refs.find((r) => r.field.type === 'file')
  const lid = currentJobId()
  if (!fileRef || !lid) return false
  const input = fileRef.els[0] as HTMLInputElement
  if (input.files?.length) return false
  setStatus('Generating/fetching tailored resume…')
  const res = (await ipcRenderer.invoke('li:resumeFile', lid)) as { name: string; bytes: Uint8Array } | null
  if (!res) return false
  const dt = new DataTransfer()
  dt.items.add(new File([res.bytes as BlobPart], res.name, { type: 'application/pdf' }))
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  mark(input.parentElement ?? input, 'ai')
  return true
}

async function fillEasyApply(): Promise<void> {
  const dialog = easyApplyDialog()
  if (!dialog) {
    setStatus('Open the "Easy Apply" dialog first.')
    return
  }
  const refs = collectFields(dialog)
  if (!refs.length) {
    setStatus('No fields found in this step.')
    return
  }
  setStatus(`Analyzing ${refs.length} field(s)…`)
  const answers = (await ipcRenderer.invoke('li:answerFields', currentJobId(), refs.map((r) => r.field))) as FieldAnswer[]
  const byKey = new Map(answers.map((a) => [a.key, a]))
  for (const r of refs) {
    const a = byKey.get(r.field.key)
    if (a) applyAnswer(r, a)
  }
  const attached = await attachResume(refs).catch(() => false)
  const unknown = answers.filter((a) => a.origin === 'unknown').length
  setStatus(
    `Filled ${answers.length - unknown} field(s)${attached ? ' + resume attached' : ''}. ` +
      (unknown ? `${unknown} in orange need your input. ` : '') +
      'Review, then continue/submit yourself.'
  )
}

/** Saves the current step's answers (question memory + fact base). */
async function rememberCurrentStep(silent = false): Promise<void> {
  const dialog = easyApplyDialog()
  if (!dialog) return
  const fields = collectFields(dialog)
    .map((r) => r.field)
    .filter((f) => f.type !== 'file' && f.value)
  if (!fields.length) return
  const n = (await ipcRenderer.invoke('li:remember', currentJobId(), fields)) as number
  if (!silent) setStatus(`${n} answer(s) saved to your knowledge base.`)
}

// Before any step forward in the dialog (Next/Review/Submit), store the answers the user gave.
// If the click is on the submit button, confirm success afterwards and mark the application as applied.
document.addEventListener(
  'click',
  (e) => {
    const btn = (e.target as HTMLElement | null)?.closest('button')
    const dialog = easyApplyDialog()
    if (!btn || !dialog || !dialog.contains(btn)) return
    const text = clean(btn.innerText)
    if (/avan[cç]ar|next|revisar|review|enviar|submit/i.test(text)) void rememberCurrentStep(true)
    if (/enviar candidatura|submit application/i.test(text)) {
      const lid = currentJobId()
      setTimeout(() => {
        const body = document.body.innerText
        if (lid && /candidatura (foi )?enviada|application (was )?sent|your application was sent/i.test(body)) {
          void ipcRenderer.invoke('li:markApplied', lid).then(() => setStatus('Application recorded as applied ✔'))
        }
      }, 2500)
    }
  },
  true
)

// ---------------- floating panel ----------------
let statusEl: HTMLElement | null = null
let scoreEl: HTMLElement | null = null
const setStatus = (t: string): void => {
  if (statusEl) statusEl.textContent = t
}

function button(label: string, onClick: () => Promise<void> | void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', async () => {
    b.disabled = true
    try {
      await onClick()
    } catch (err) {
      setStatus(`Error: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    } finally {
      b.disabled = false
    }
  })
  return b
}

function mountPanel(): void {
  if (document.getElementById('jsr-panel-host')) return
  const host = document.createElement('div')
  host.id = 'jsr-panel-host'
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `<style>
    .p{font:13px system-ui,sans-serif;background:#111827;color:#f9fafb;border-radius:12px;padding:12px;width:260px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
    .h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600}
    .s{font-size:22px;font-weight:700;color:#74c0fc}
    button{display:block;width:100%;margin:4px 0;padding:7px 8px;border:0;border-radius:8px;background:#3b5bdb;color:#fff;font:inherit;cursor:pointer;text-align:left}
    button.sec{background:#374151} button:disabled{opacity:.5;cursor:wait}
    .st{margin-top:8px;font-size:12px;color:#d1d5db;min-height:16px;line-height:1.35}
    .min{background:none;width:auto;padding:0 4px;margin:0;color:#9ca3af}
    .body.hidden{display:none}
  </style>
  <div class="p"><div class="h"><span>Job Search RAG</span><span class="s" id="score"></span></div><div class="body" id="body"></div><div class="st" id="st">Ready.</div></div>`
  const body = root.getElementById('body')!
  statusEl = root.getElementById('st')
  scoreEl = root.getElementById('score')

  body.append(
    button('📥 Capture & analyze job', async () => {
      const job = extractCurrentJob()
      if (!job) return setStatus('Open a job’s details to capture it.')
      setStatus('Capturing and analyzing fit…')
      const r = (await ipcRenderer.invoke('li:capture', job)) as { score: number | null }
      if (scoreEl) scoreEl.textContent = r.score != null ? `${r.score}%` : ''
      setStatus(r.score != null ? `Job saved. Fit: ${r.score}%.` : 'Job saved.')
    }),
    button('📋 Capture visible job list', async () => {
      const list = extractJobList()
      if (!list.length) return setStatus('No jobs found in this page’s list.')
      const n = (await ipcRenderer.invoke('li:captureList', list)) as number
      setStatus(`${n} job(s) saved as leads. Open each one and capture it to analyze.`)
    }),
    button('✍️ Fill Easy Apply (current step)', fillEasyApply),
    button('💾 Save this step’s answers', () => rememberCurrentStep(false))
  )
  const sec = button('✔ Mark as applied', async () => {
    const lid = currentJobId()
    if (!lid) return setStatus('No job open.')
    const ok = (await ipcRenderer.invoke('li:markApplied', lid)) as boolean
    setStatus(ok ? 'Marked as applied.' : 'Capture the job first.')
  })
  sec.className = 'sec'
  body.append(sec)
  document.body.appendChild(host)
}

// Refresh the displayed score when the user switches jobs (LinkedIn is a SPA)
let lastId: string | null = null
async function refreshState(): Promise<void> {
  const id = currentJobId()
  if (id === lastId) return
  lastId = id
  if (!scoreEl) return
  scoreEl.textContent = ''
  if (!id) return
  const st = (await ipcRenderer.invoke('li:jobState', id).catch(() => null)) as { score: number | null } | null
  if (st?.score != null && lastId === id) scoreEl.textContent = `${st.score}%`
}

window.addEventListener('DOMContentLoaded', () => {
  mountPanel()
  setInterval(() => {
    if (!document.getElementById('jsr-panel-host')) mountPanel()
    void refreshState()
  }, 1500)
})
