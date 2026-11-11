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
import type { CaptureDiagnostics, CapturedJob, FieldAnswer, FormField, LogEntry, LogLevel } from '@shared/types'

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
  return u.searchParams.get('currentJobId') ?? u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] ?? null
}

// ---------------- job extraction ----------------
/** First element matching any selector, with the selector that matched (for diagnostics). */
function firstMatch(sels: string[], root: ParentNode = document, minLen = 1): { text: string; from: string } | null {
  for (const sel of sels) {
    for (const node of root.querySelectorAll<HTMLElement>(sel)) {
      const text = clean(node.innerText || node.textContent)
      if (text.length >= minLen) return { text, from: sel }
    }
  }
  return null
}

/** Search-page headings such as "7,000+ Software Engineer Jobs in Brazil" or "Vagas de Engenheiro…" are not job titles. */
const NOT_A_TITLE =
  /^(jobs?|vagas?|empregos?|search|pesquisa|linkedin|feed|notifications|notificações)\b|\bjobs in\b|\bvagas (de|em)\b|^\s*[\d.,]+\+?\s|\(\s*[\d.,]+\+?\s*(open roles|vagas)|job search|busca de vagas|next step|próximo passo|premium|people you can reach|pessoas que você|meet the hiring team|conheça a equipe|about the (job|company)|sobre a (vaga|empresa)|similar jobs|vagas semelhantes/i

/** "(3) Senior Engineer | Acme | LinkedIn" → ["Senior Engineer", "Acme"] — only trusted on a job's own page. */
function titleFromDocument(): { title: string; company: string } | null {
  if (!/\/jobs\/view\//.test(location.pathname)) return null
  // Logged in: "Senior Engineer | Acme | LinkedIn"; public page: "Senior Engineer at Acme — Location | LinkedIn Jobs"
  const parts = document.title
    .replace(/^\(\d+\)\s*/, '')
    .split(/\s+[|·–—-]\s+/)
    .map(clean)
    .filter((p) => p && !/^linkedin( jobs| vagas)?$/i.test(p))
  if (!parts.length) return null
  let [title, company = ''] = parts
  // Public format puts the company after "at" and the location after "—"
  const publicFormat = /\|\s*LinkedIn (Jobs|Vagas)\s*$/i.test(document.title)
  const at = title.match(/^(.+?)\s+(?:at|na|no|em)\s+(.+)$/i)
  if (at && (publicFormat || !company)) [title, company] = [at[1], at[2]]
  if (NOT_A_TITLE.test(title)) return null
  return { title: clean(title), company: clean(company) }
}

/**
 * The pane that shows the open job. Logged-in and public (signed-out) pages use different markup.
 * Returns null when no job detail is identifiable — the generic fallbacks are then NOT applied to the whole page,
 * because that captures wrong data (the search heading as title, the whole page as description).
 */
function detailRoot(): { el: HTMLElement; from: string } | null {
  const sels = [
    // logged in
    '.jobs-search__job-details--container',
    '.jobs-search__job-details--wrapper',
    '.jobs-search__job-details',
    '.job-view-layout',
    '.jobs-details',
    '.scaffold-layout__detail',
    // public / signed out
    '.details-pane__content',
    '.two-pane-serp-page__detail-view',
    '.decorated-job-posting__details',
    'section.top-card-layout'
  ]
  for (const sel of sels) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el && clean(el.innerText).length > 50) return { el: sel === 'section.top-card-layout' ? (el.closest('main') ?? el) : el, from: sel }
  }
  // Job's own page: the whole main area is the job
  if (/\/jobs\/view\//.test(location.pathname)) {
    const main = document.querySelector<HTMLElement>('main')
    if (main) return { el: main, from: 'main (job page)' }
  }
  // Otherwise: the container around an "About the job" heading, if any
  const byHeading = descriptionByHeading(document.body)
  const pane = byHeading?.closest<HTMLElement>('section, article, div[class*="detail"]')
  return pane ? { el: pane, from: 'container of "About the job"' } : null
}

/** Finds the description by its heading ("About the job" / "Sobre a vaga"), independent of LinkedIn's class names. */
function descriptionByHeading(root: HTMLElement): HTMLElement | null {
  const heading = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, strong, span')].find((h) =>
    /^(about the job|sobre a vaga|job description|descrição da vaga|descrição do trabalho|acerca del empleo)$/i.test(clean(h.textContent))
  )
  let node: HTMLElement | null = heading ?? null
  while (node && node !== root) {
    if (clean(node.innerText).length > 300) return node
    node = node.parentElement
  }
  return null
}

const JOB_LIST = '[data-occludable-job-id], [data-job-id], .jobs-search__results-list, .base-card, .scaffold-layout__list'

/** Last resort inside the detail pane only: the biggest block of prose that is not the job list. */
function largestTextBlock(root: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestLen = 0
  for (const el of root.querySelectorAll<HTMLElement>('article, section, div')) {
    if (el.matches(JOB_LIST) || el.querySelector(JOB_LIST)) continue
    const len = clean(el.innerText).length
    if (len > 300 && len < 30000 && len > bestLen * 1.15) {
      best = el
      bestLen = len
    }
  }
  return best
}

/** LinkedIn job id: from the URL, or from a link to the job inside the detail pane. */
function jobIdFrom(root: HTMLElement | null): { id: string | null; from: string } {
  const fromUrl = currentJobId()
  if (fromUrl) return { id: fromUrl, from: 'url' }
  const link = root?.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"]')
  const m = link?.href.match(/\/jobs\/view\/(?:[^/?]*?-)?(\d{6,})/)
  if (m) return { id: m[1], from: 'job link in detail pane' }
  const urn = root?.querySelector('[data-entity-urn*="jobPosting"]')?.getAttribute('data-entity-urn')?.match(/(\d{6,})/)
  return urn ? { id: urn[1], from: 'data-entity-urn' } : { id: null, from: 'not found' }
}

interface Extraction {
  job: CapturedJob | null
  missing: string[]
  /** Fields read with generic fallbacks (worth double-checking) */
  uncertain: string[]
  diag: CaptureDiagnostics & { detailFrom: string; idFrom: string }
}

function extractCurrentJob(): Extraction {
  const pane = detailRoot()
  const root = pane?.el ?? null
  const { id, from: idFrom } = jobIdFrom(root)
  const fromDoc = titleFromDocument()
  const okTitle = (t: string) => t.length >= 3 && t.length <= 200 && !NOT_A_TITLE.test(t)

  // Specific selectors first; then the tab title on a job's own page ("Title | Company | LinkedIn", reliable);
  // the generic <h1> only as a last resort (pages also contain promo headings such as "Take the next step…").
  const specificTitleSels = [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    '.top-card-layout__title',
    '.topcard__title',
    '[class*="job-title"] h1',
    '[class*="job-title"]',
    '.t-24.t-bold'
  ]
  // On a job's own page the whole document is about that job, so specific selectors may also look outside the pane
  const scopes: ParentNode[] = [root, /\/jobs\/view\//.test(location.pathname) ? document : null].filter(Boolean) as ParentNode[]
  const pickTitle = (sels: string[]): { text: string; from: string } | null => {
    for (const scope of scopes)
      for (const sel of sels) {
        const node = [...scope.querySelectorAll<HTMLElement>(sel)].find((n) => okTitle(clean(n.innerText || n.textContent)))
        if (node) return { text: clean(node.innerText || node.textContent), from: sel }
      }
    return null
  }
  let titleHit = pickTitle(specificTitleSels)
  if (!titleHit && fromDoc && okTitle(fromDoc.title)) titleHit = { text: fromDoc.title, from: 'document.title' }
  if (!titleHit) titleHit = pickTitle(['h1'])

  const companySels = [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name',
    '.topcard__org-name-link',
    '.top-card-layout__second-subline a',
    '[class*="company-name"]'
  ]
  const companyHit =
    scopes.map((sc) => firstMatch(companySels, sc, 2)).find(Boolean) ??
    (fromDoc?.company ? { text: fromDoc.company, from: 'document.title' } : null) ??
    (root && firstMatch(['a[href*="/company/"]'], root, 2))

  const locationHit =
    root &&
    firstMatch(
      [
        '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
        '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text',
        '.jobs-unified-top-card__bullet',
        '.topcard__flavor--bullet'
      ],
      root
    )

  let descFrom = ''
  let descEl: HTMLElement | null = null
  if (root) {
    for (const sel of [
      '#job-details',
      '.jobs-description__content',
      '.jobs-box__html-content',
      '.jobs-description-content__text',
      '.show-more-less-html__markup',
      '.description__text',
      '[class*="jobs-description"]'
    ]) {
      const el = root.querySelector<HTMLElement>(sel)
      if (el && clean(el.innerText).length > 100) {
        descEl = el
        descFrom = sel
        break
      }
    }
    if (!descEl) {
      descEl = descriptionByHeading(root)
      if (descEl) descFrom = 'heading "About the job"'
    }
    if (!descEl) {
      descEl = largestTextBlock(root)
      if (descEl) descFrom = 'largest text block'
    }
  }
  const description = (descEl?.innerText ?? '').replace(/^(about the job|sobre a vaga)\s*/i, '').replace(/\n?(show more|show less|mostrar mais|exibir mais|ver mais)\s*$/i, '').trim()

  const diag = {
    url: location.href,
    linkedinId: id,
    idFrom,
    detailFrom: pane?.from ?? 'not found',
    titleFrom: titleHit?.from ?? 'not found',
    companyFrom: companyHit?.from ?? 'not found',
    descriptionFrom: descFrom || 'not found',
    descriptionLength: description.length
  }
  const missing = [!root && 'job details pane', !titleHit && 'title', description.length < 100 && 'description'].filter(Boolean) as string[]
  const uncertain = [
    titleHit && titleHit.from === 'h1' && 'title',
    descFrom === 'largest text block' && 'description',
    !companyHit && 'company'
  ].filter(Boolean) as string[]
  if (missing.length) return { job: null, missing, uncertain, diag }

  const easyApply = [...document.querySelectorAll<HTMLButtonElement>('.jobs-apply-button, button')].some((b) =>
    /easy apply|candidatura simplificada/i.test(b.innerText)
  )
  return {
    job: {
      url: id ? `https://www.linkedin.com/jobs/view/${id}/` : location.href.split('#')[0],
      linkedinId: id,
      title: titleHit!.text.slice(0, 300),
      company: companyHit?.text.slice(0, 200) ?? '',
      location: locationHit?.text.slice(0, 200) ?? '',
      description: description.slice(0, 50000),
      easyApply
    },
    missing,
    uncertain,
    diag
  }
}

/** Cards of a search results list: logged in (`data-job-id` / occludable) and public pages (`.base-card`). */
const JOB_CARDS = '[data-job-id], [data-occludable-job-id], li.jobs-search-results__list-item, .base-card[data-entity-urn*="jobPosting"], .job-search-card'
const JOB_ID_IN_HREF = /\/jobs\/view\/(?:[^/?]*?-)?(\d{6,})/

function cardJobId(card: HTMLElement): string | null {
  return (
    card.getAttribute('data-job-id') ??
    card.getAttribute('data-occludable-job-id') ??
    card.getAttribute('data-entity-urn')?.match(/jobPosting:(\d+)/)?.[1] ??
    card.querySelector('[data-entity-urn*="jobPosting"]')?.getAttribute('data-entity-urn')?.match(/jobPosting:(\d+)/)?.[1] ??
    $<HTMLAnchorElement>('a[href*="/jobs/view/"]', card)?.href.match(JOB_ID_IN_HREF)?.[1] ??
    null
  )
}

function extractJobList(): CapturedJob[] {
  const out: CapturedJob[] = []
  const seen = new Set<string>()
  document.querySelectorAll<HTMLElement>(JOB_CARDS).forEach((card) => {
    const id = cardJobId(card)
    if (!id || seen.has(id)) return
    const title = firstText(
      ['.job-card-list__title--link strong', '.job-card-list__title', '.base-search-card__title', 'a[href*="/jobs/view/"] strong', 'a[href*="/jobs/view/"]'],
      card
    )
    if (!title) return // occluded card (not rendered yet): picked up once it scrolls into view
    seen.add(id)
    out.push({
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      linkedinId: id,
      title,
      company: firstText(['.artdeco-entity-lockup__subtitle', '.job-card-container__primary-description', '.job-card-container__company-name', '.base-search-card__subtitle'], card),
      location: firstText(['.job-card-container__metadata-wrapper li', '.job-card-container__metadata-item', '.artdeco-entity-lockup__caption', '.job-search-card__location'], card),
      description: '',
      easyApply: /easy apply|candidatura simplificada/i.test(card.innerText)
    })
  })
  return out
}

// ---------------- capture all search results ----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const onSearchPage = (): boolean => /^\/jobs\/(search|collections)/.test(location.pathname)
const MAX_PAGES = 40
const MAX_JOBS = 1000

let stopAll = false

const visible = (e: HTMLElement | null): e is HTMLElement => !!e && e.offsetParent !== null && !(e as HTMLButtonElement).disabled

/** Logged-in results are virtualized: each card only renders its content near the viewport, so walk them into view. */
async function renderAllCards(skip: Set<string>): Promise<void> {
  const cards = [...document.querySelectorAll<HTMLElement>(JOB_CARDS)].filter((c) => !skip.has(cardJobId(c) ?? ''))
  for (const card of cards) {
    if (stopAll) return
    card.scrollIntoView({ block: 'center' })
    await sleep(120)
  }
  await sleep(400)
}

/** Next results page (logged-in pagination), or more results (public page infinite scroll). False when there are none. */
async function nextPage(): Promise<boolean> {
  const before = [...document.querySelectorAll<HTMLElement>(JOB_CARDS)].map(cardJobId).join(',')
  const active = $('li.active[data-test-pagination-page-btn], .jobs-search-pagination__indicator-button--active, button[aria-current="true"][aria-label*="Page"], button[aria-current="page"]')
  const activeNum = Number(active?.textContent?.trim() || NaN)
  const candidates = [
    $('button.jobs-search-pagination__button--next'),
    $('button[aria-label="View next page"]'),
    $('button[aria-label*="next page" i]'),
    $('button[aria-label*="próxima página" i]'),
    Number.isFinite(activeNum) ? $(`button[aria-label="Page ${activeNum + 1}"], button[aria-label="Página ${activeNum + 1}"]`) : null,
    active?.closest('li')?.nextElementSibling?.querySelector<HTMLElement>('button') ?? null,
    // public (signed-out) search: infinite scroll + "See more jobs"
    $('button.infinite-scroller__show-more-button')
  ]
  const next = candidates.find(visible)
  if (next) next.click()
  else {
    // public page also loads more on scroll
    window.scrollTo(0, document.body.scrollHeight)
    if (!$('.jobs-search__results-list, ul.jobs-search__results-list')) return false
  }
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const now = [...document.querySelectorAll<HTMLElement>(JOB_CARDS)].map(cardJobId).join(',')
    if (now && now !== before) return true
  }
  return false
}

async function captureAllResults(progress: (t: string) => void): Promise<void> {
  if (!onSearchPage()) throw new Error('Open a LinkedIn job search first (the results list), then click this again.')
  stopAll = false
  const seen = new Set<string>()
  let saved = 0
  let page = 1
  plog('info', 'Capture all results: started', { url: location.href })
  while (!stopAll && page <= MAX_PAGES && seen.size < MAX_JOBS) {
    progress(`Page ${page}: reading the results… (${saved} saved so far)`)
    await renderAllCards(seen)
    const fresh = extractJobList().filter((j) => j.linkedinId && !seen.has(j.linkedinId))
    fresh.forEach((j) => seen.add(j.linkedinId!))
    for (let i = 0; i < fresh.length; i += 100) {
      saved += (await ipcRenderer.invoke('li:captureList', fresh.slice(i, i + 100))) as number
    }
    plog('info', `Capture all results: page ${page} — ${fresh.length} new job(s), ${saved} saved in total`)
    if (stopAll) break
    progress(`Page ${page}: ${saved} saved. Loading more results…`)
    if (!(await nextPage())) break
    page++
    await sleep(600 + Math.random() * 600) // don't hammer LinkedIn
  }
  const why = stopAll ? 'stopped' : page > MAX_PAGES || seen.size >= MAX_JOBS ? `reached the limit (${MAX_PAGES} pages / ${MAX_JOBS} jobs)` : 'no more results'
  plog('info', `Capture all results: ${saved} job(s) saved — ${why}`)
  if (!saved) return setStatus('✖ No jobs found in the results list.', 'error')
  setStatus(`✔ ${saved} job(s) saved as leads (${why}). Open each one and capture it to analyze.`, 'ok')
}

/** Like button(), but while running it turns into a Stop button. */
function captureAllButton(): HTMLButtonElement {
  const label = '📚 Capture all search results'
  let running = false
  const b = button(label, async (progress) => {
    running = true
    b.disabled = false // stays clickable, to stop
    b.textContent = '⏹ Stop capturing'
    try {
      await captureAllResults(progress)
    } finally {
      running = false
      b.textContent = label
    }
  })
  b.addEventListener(
    'click',
    (e) => {
      if (!running) return
      e.stopImmediatePropagation()
      stopAll = true
      b.textContent = 'Stopping…'
      b.disabled = true
    },
    true
  )
  return b
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
    if (!ON_LINKEDIN) return
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
type StatusKind = 'info' | 'busy' | 'ok' | 'error'
let statusEl: HTMLElement | null = null
let statusText: HTMLElement | null = null
let scoreEl: HTMLElement | null = null
let noticeEl: HTMLElement | null = null
let cardEl: HTMLElement | null = null
let consoleEl: HTMLElement | null = null
let consoleCount: HTMLElement | null = null
let errorCount = 0
let noticeDismissed = false
const consoleLines: LogEntry[] = []

/** Status line: colored by kind, with a spinner while busy. Accepts the old setStatus(text) calls too. */
function setStatus(text: string, kind: StatusKind = 'info'): void {
  if (!statusEl || !statusText) return
  statusEl.className = `st ${kind}`
  statusText.textContent = text
}

/** Sends a line to the app log; the app echoes linkedin/ai/embeddings/cli lines back into the mini console. */
function plog(level: LogLevel, message: string, detail?: unknown): void {
  ipcRenderer.invoke('li:log', level, message, detail).catch(() =>
    addConsoleLine({ id: -Date.now(), ts: new Date().toISOString(), level, source: 'linkedin', message, detail: detail ? JSON.stringify(detail) : '' })
  )
}

function addConsoleLine(e: LogEntry): void {
  consoleLines.push(e)
  if (consoleLines.length > 200) consoleLines.shift()
  if (e.level === 'error') errorCount++
  renderConsole()
}

function renderConsole(): void {
  if (!consoleEl) return
  consoleEl.replaceChildren(
    ...consoleLines.slice(-80).map((e) => {
      const line = el('div', `l ${e.level}`)
      const t = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      line.append(el('span', 't', t), el('span', 'src', e.source), e.message)
      if (e.detail) line.title = e.detail
      return line
    })
  )
  consoleEl.scrollTop = consoleEl.scrollHeight
  if (consoleCount) consoleCount.textContent = errorCount ? ` (${errorCount} error${errorCount > 1 ? 's' : ''})` : ''
}

ipcRenderer.on('li:logline', (_e, entry: LogEntry) => addConsoleLine(entry))

function showCard(title: string, sub: string, score?: number | null, note?: string): void {
  if (!cardEl) return
  const top = el('div', 'ct', el('b', '', title))
  if (score != null) top.append(el('span', `badge ${score >= 75 ? 'good' : score >= 50 ? 'mid' : 'low'}`, `${score}%`))
  cardEl.replaceChildren(top, el('div', 'cs', sub))
  if (note) cardEl.append(el('div', 'cn', note))
  cardEl.classList.add('show')
}

/** Button that shows a working state (spinner label + elapsed seconds) and turns errors into a red status. */
function button(label: string, onClick: (progress: (text: string) => void) => Promise<void> | void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', async () => {
    if (b.disabled) return
    b.disabled = true
    b.classList.add('working')
    const started = Date.now()
    let current = ''
    const tick = setInterval(() => {
      if (current) setStatus(`${current} ${Math.round((Date.now() - started) / 1000)}s`, 'busy')
    }, 1000)
    const progress = (text: string) => {
      current = text
      setStatus(text, 'busy')
    }
    try {
      await onClick(progress)
    } catch (err) {
      const msg = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setStatus(`✖ ${msg}`, 'error')
      plog('error', `${label.replace(/^\S+\s/, '')} failed: ${msg}`)
    } finally {
      clearInterval(tick)
      b.disabled = false
      b.classList.remove('working')
    }
  })
  return b
}

const PANEL_CSS = `
  .p{font:13px system-ui,sans-serif;background:#111827;color:#f9fafb;border-radius:12px;padding:12px;width:300px;box-shadow:0 8px 24px rgba(0,0,0,.35);max-height:calc(100vh - 40px);overflow:auto}
  .h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600}
  .s{font-size:22px;font-weight:700;color:#74c0fc}
  button{display:block;width:100%;margin:4px 0;padding:7px 8px;border:0;border-radius:8px;background:#3b5bdb;color:#fff;font:inherit;cursor:pointer;text-align:left}
  button:hover{background:#4c6ef5} button.sec{background:#374151} button.sec:hover{background:#4b5563}
  button:disabled{opacity:.6;cursor:progress} button.working{outline:2px solid #74c0fc;outline-offset:1px}
  .st{display:flex;gap:6px;align-items:flex-start;margin-top:8px;padding:6px 8px;border-radius:8px;font-size:12px;line-height:1.35;background:#1f2937;color:#d1d5db}
  .st.busy{background:#1c2b4a;color:#dbe4ff} .st.ok{background:#12301f;color:#b2f2bb} .st.error{background:#3b1219;color:#ffc9c9}
  .sp{display:none;width:12px;height:12px;flex:none;margin-top:1px;border:2px solid #74c0fc;border-top-color:transparent;border-radius:50%;animation:r .8s linear infinite}
  .st.busy .sp{display:block} @keyframes r{to{transform:rotate(360deg)}}
  .n{display:none;margin-bottom:8px;padding:8px;border-radius:8px;background:#1f2937;border:1px solid #f59f00;font-size:12px;line-height:1.4;color:#f3f4f6}
  .n.show{display:block} .n b{color:#ffd43b} .n a{color:#74c0fc}
  .card{display:none;margin:4px 0 8px;padding:8px;border-radius:8px;background:#1f2937;border:1px solid #374151}
  .card.show{display:block} .ct{display:flex;justify-content:space-between;gap:8px;align-items:flex-start} .cs{color:#9ca3af;font-size:12px;margin-top:2px}
  .cn{font-size:12px;margin-top:6px;color:#e5e7eb;line-height:1.35}
  .badge{flex:none;padding:1px 7px;border-radius:999px;font-weight:700;font-size:12px;color:#fff} .good{background:#2f9e44} .mid{background:#e67700} .low{background:#6b7280}
  details{margin-top:8px} summary{cursor:pointer;color:#9ca3af;font-size:12px;user-select:none}
  .con{margin-top:6px;max-height:170px;overflow:auto;background:#030712;border-radius:6px;padding:6px;font:11px ui-monospace,Consolas,monospace;line-height:1.4}
  .l{white-space:pre-wrap;word-break:break-word;color:#d1d5db} .l.warn{color:#ffd43b} .l.error{color:#ff8787} .l.debug{color:#6b7280}
  .l .t{color:#6b7280;margin-right:6px} .l .src{color:#74c0fc;margin-right:6px}
  .row{display:flex;gap:6px} .row button{font-size:11px;padding:4px 6px;text-align:center}
`

/** Small DOM builder (text only — never HTML strings, see Trusted Types note in mountPanel). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  e.append(...children)
  return e
}

async function captureJob(progress: (t: string) => void): Promise<void> {
  progress('Reading the job page…')
  const { job, missing, uncertain, diag } = extractCurrentJob()
  plog(
    job ? (uncertain.length ? 'warn' : 'info') : 'warn',
    job
      ? `Read job: “${job.title}” — ${job.company || '?'} (${job.description.length} chars of description)${uncertain.length ? `; read with fallbacks: ${uncertain.join(', ')}` : ''}`
      : `Could not read the job page (missing ${missing.join(', ')})`,
    diag
  )
  if (!job) {
    setStatus(
      `✖ Couldn't read this job (no ${missing.join(' / ')} found). Click a job in the list so its details are open, then try again. What was found is in the console below.`,
      'error'
    )
    return
  }
  showCard(job.title, [job.company || 'Company not found', job.location].filter(Boolean).join(' · '), null, `Read ${job.description.length.toLocaleString()} characters of description. Saving…`)
  progress('Saving the job…')
  const saved = (await ipcRenderer.invoke('li:capture', job, diag)) as { jobId: number; title: string; company: string; analyzed: boolean; score: number | null; summary: string }
  showCard(saved.title, saved.company || 'Company not found', saved.score, saved.analyzed ? saved.summary : 'Saved ✓ — analyzing fit…')
  if (saved.analyzed) {
    if (scoreEl) scoreEl.textContent = saved.score != null ? `${saved.score}%` : ''
    setStatus(`✔ Already captured and analyzed (fit ${saved.score ?? '?'}%). Open it in the app → Jobs.`, 'ok')
    return
  }
  const check = uncertain.length ? ` ⚠ Check the ${uncertain.join(' and ')} in the app — read with generic fallbacks.` : ''
  progress(`Saved ✓ Analyzing fit with AI (usually 20–90 s; the first run also downloads a ~120 MB model)…${check}`)
  const r = (await ipcRenderer.invoke('li:analyze', saved.jobId)) as { score: number | null; summary: string; gaps: number }
  showCard(saved.title, saved.company || 'Company not found', r.score, r.summary)
  if (scoreEl) scoreEl.textContent = r.score != null ? `${r.score}%` : ''
  setStatus(`✔ Fit ${r.score ?? '?'}%${r.gaps ? ` — ${r.gaps} gap(s) to answer in the app (Jobs)` : ''}. Generate the resume in the app.${check}`, 'ok')
}

function mountPanel(): void {
  if (document.getElementById('jsr-panel-host')) return
  const host = document.createElement('div')
  host.id = 'jsr-panel-host'
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;'
  const root = host.attachShadow({ mode: 'closed' })
  // LinkedIn enforces Trusted Types (CSP), which forbids innerHTML: build the panel with DOM APIs only
  const style = document.createElement('style')
  style.textContent = PANEL_CSS
  const panel = el('div', 'p')
  const header = el('div', 'h', el('span', '', 'Job Search RAG'))
  scoreEl = el('span', 's')
  header.append(scoreEl)
  noticeEl = el('div', 'n')
  noticeEl.setAttribute('role', 'note')
  const reset = el('a', '', 'Forgot password')
  reset.setAttribute('href', 'https://www.linkedin.com/checkpoint/rp/request-password-reset')
  noticeEl.append(
    el('b', '', '⚠ Sign in with your LinkedIn email and password.'),
    document.createElement('br'),
    '“Continue with Google” does not work inside apps — Google blocks sign-in from embedded browsers. ' +
      'If your account only uses Google, create a LinkedIn password once: click ',
    reset,
    ' and enter your Google email, or in your normal browser go to LinkedIn → Settings → Sign in & security → Change password. ' +
      'Google sign-in keeps working in your regular browser. '
  )
  const gotIt = el('a', '', 'Got it')
  gotIt.setAttribute('href', '#')
  gotIt.addEventListener('click', (e) => {
    e.preventDefault()
    noticeDismissed = true
    noticeEl?.classList.remove('show')
  })
  noticeEl.append(gotIt)
  cardEl = el('div', 'card')
  const body = el('div', 'body')
  statusText = el('span', '', 'Ready. Open a job and click “Capture & analyze job”.')
  statusEl = el('div', 'st info', el('span', 'sp'), statusText)
  statusEl.setAttribute('aria-live', 'polite')

  consoleEl = el('div', 'con')
  consoleCount = el('span', '')
  const copyBtn = button('Copy log', () => {
    const text = consoleLines.map((e) => `${e.ts} ${e.level.toUpperCase()} [${e.source}] ${e.message}${e.detail ? ` | ${e.detail}` : ''}`).join('\n')
    void navigator.clipboard.writeText(text).then(() => setStatus('✔ Log copied to the clipboard.', 'ok'))
  })
  const clearBtn = button('Clear', () => {
    consoleLines.length = 0
    errorCount = 0
    renderConsole()
  })
  copyBtn.className = clearBtn.className = 'sec'
  const consoleBox = el('details', '', el('summary', '', 'Console', consoleCount), consoleEl, el('div', 'row', copyBtn, clearBtn))
  panel.append(header, noticeEl, cardEl, body, statusEl, consoleBox)
  root.append(style, panel)

  body.append(
    button('📥 Capture & analyze job', captureJob),
    button('📋 Capture visible job list', async (progress) => {
      progress('Reading the job list…')
      const list = extractJobList()
      plog(list.length ? 'info' : 'warn', `Job list: found ${list.length} job card(s) on this page`, { url: location.href })
      if (!list.length) return setStatus('✖ No jobs found in this page’s list. Open a LinkedIn job search first.', 'error')
      const n = (await ipcRenderer.invoke('li:captureList', list)) as number
      setStatus(`✔ ${n} job(s) saved as leads. Open each one and capture it to analyze.`, 'ok')
    }),
    captureAllButton(),
    button('✍️ Fill Easy Apply (current step)', () => fillEasyApply()),
    button('💾 Save this step’s answers', () => rememberCurrentStep(false))
  )
  const sec = button('✔ Mark as applied', async () => {
    const lid = currentJobId()
    if (!lid) return setStatus('✖ No job open.', 'error')
    const ok = (await ipcRenderer.invoke('li:markApplied', lid)) as boolean
    setStatus(ok ? '✔ Marked as applied.' : '✖ Capture the job first.', ok ? 'ok' : 'error')
  })
  sec.className = 'sec'
  body.append(sec)
  document.body.appendChild(host)
  renderConsole()
}

// Refresh the displayed score when the user switches jobs (LinkedIn is a SPA)
let lastId: string | null = null

/** LinkedIn sign-in/sign-up pages (where the "Continue with Google" button appears). */
function onSignInPage(): boolean {
  return /^\/(login|uas\/login|checkpoint\/(lg|rp)|signup|authwall)/i.test(location.pathname) || !!document.querySelector('iframe[src*="accounts.google.com/gsi"]')
}

async function refreshState(): Promise<void> {
  noticeEl?.classList.toggle('show', !noticeDismissed && onSignInPage())
  const id = currentJobId()
  if (id === lastId) return
  lastId = id
  if (!scoreEl) return
  scoreEl.textContent = ''
  cardEl?.classList.remove('show')
  if (!id) return
  const st = (await ipcRenderer.invoke('li:jobState', id).catch(() => null)) as { score: number | null } | null
  if (st?.score != null && lastId === id) scoreEl.textContent = `${st.score}%`
}

// The preload also runs in sign-in popups (Google etc.), which inherit the window's settings: stay out of those
const ON_LINKEDIN = /(^|\.)linkedin\.com$/i.test(location.hostname)

window.addEventListener('DOMContentLoaded', () => {
  if (!ON_LINKEDIN) return
  mountPanel()
  plog('debug', `Panel ready on ${location.pathname}`)
  setInterval(() => {
    if (!document.getElementById('jsr-panel-host')) mountPanel()
    void refreshState()
  }, 1500)
})
