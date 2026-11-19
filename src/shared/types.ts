// Types shared between main, preload and renderer.

export type Lang = 'pt' | 'en'

export interface Profile {
  fullName: string
  headline: string
  email: string
  phone: string
  location: string
  linkedin: string
  github: string
  website: string
  summary: string
  /** Target roles, used to build LinkedIn searches */
  targetRoles: string
  /** Free-form preferences: remote, salary, industries... */
  preferences: string
}

export const emptyProfile: Profile = {
  fullName: '',
  headline: '',
  email: '',
  phone: '',
  location: '',
  linkedin: '',
  github: '',
  website: '',
  summary: '',
  targetRoles: '',
  preferences: ''
}

export type ItemKind = 'experience' | 'education' | 'skill' | 'project' | 'certification' | 'language'

export interface ExperienceData {
  company: string
  title: string
  location: string
  start: string
  end: string
  description: string
  achievements: string
}
export interface EducationData {
  institution: string
  degree: string
  field: string
  start: string
  end: string
}
export interface SkillData {
  name: string
  level: string
  years: string
}
export interface ProjectData {
  name: string
  url: string
  description: string
  tech: string
}
export interface CertificationData {
  name: string
  issuer: string
  date: string
}
export interface LanguageData {
  name: string
  level: string
}

export interface ItemDataMap {
  experience: ExperienceData
  education: EducationData
  skill: SkillData
  project: ProjectData
  certification: CertificationData
  language: LanguageData
}

export interface ProfileItem<K extends ItemKind = ItemKind> {
  id: number
  kind: K
  data: ItemDataMap[K]
  sort: number
}

export type FactSource = 'profile' | 'manual' | 'gap-answer' | 'easy-apply' | 'editor' | 'import'

export interface Fact {
  id: number
  text: string
  source: FactSource
  itemId: number | null
  createdAt: string
}

export type JobStatus = 'lead' | 'captured' | 'analyzed' | 'applied' | 'discarded'

export interface JobRequirements {
  title: string
  company: string
  seniority: string
  location: string
  workModel: string
  language: Lang
  mustHave: string[]
  niceToHave: string[]
  keywords: string[]
  responsibilities: string[]
}

export interface MatchResult {
  score: number
  summary: string
  matched: string[]
  gaps: string[]
}

export interface Job {
  id: number
  url: string
  linkedinId: string | null
  title: string
  company: string
  location: string
  description: string
  easyApply: boolean
  status: JobStatus
  requirements: JobRequirements | null
  match: MatchResult | null
  createdAt: string
}

export interface ResumeDoc {
  /** Language the document was generated in (section headings follow it). Defaults to English. */
  lang?: Lang
  name: string
  headline: string
  contact: string[]
  summary: string
  skills: string[]
  experiences: {
    company: string
    title: string
    location: string
    period: string
    bullets: string[]
  }[]
  education: { institution: string; degree: string; period: string }[]
  projects: { name: string; description: string }[]
  certifications: string[]
  languages: string[]
}

export interface CoverLetterDoc {
  lang?: Lang
  greeting: string
  paragraphs: string[]
  closing: string
  signature: string
}

/** 'scheduling' = the company replied and an interview is being scheduled (waiting on a date/time) */
export type ApplicationStatus = 'draft' | 'applied' | 'scheduling' | 'interview' | 'offer' | 'rejected'

export const APPLICATION_STATUSES: { id: ApplicationStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'applied', label: 'Applied' },
  { id: 'scheduling', label: 'Awaiting scheduling' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' }
]

export interface Application {
  id: number
  jobId: number
  resume: ResumeDoc | null
  coverLetter: CoverLetterDoc | null
  status: ApplicationStatus
  notes: string
  appliedAt: string | null
  updatedAt: string
  /** Hidden from the board (still counts as applied for the agent) */
  archivedAt: string | null
}

export interface QaEntry {
  id: number
  question: string
  answer: string
  updatedAt: string
}

export type ChatProviderId = 'claude' | 'claude-cli' | 'openai' | 'ollama'
export type EmbedProviderId = 'local' | 'openai' | 'ollama'

/** Price per 1M tokens, in USD. */
export interface ModelPrice {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface Budget {
  /** Hard monthly limit in USD (null = no limit) */
  monthlyUsd: number | null
  /** Hard daily limit in USD (null = no limit) */
  dailyUsd: number | null
  /** Show a warning when spend reaches this % of a limit */
  warnPct: number
  /** Also count Claude-subscription usage (list-price equivalent) against the limits */
  includeSubscription: boolean
}

export interface Settings {
  chatProvider: ChatProviderId
  chatModel: Record<ChatProviderId, string>
  embedProvider: EmbedProviderId
  embedModel: Record<EmbedProviderId, string>
  ollamaUrl: string
  defaultLang: Lang
  /** Path/command of the Claude Code CLI used by the 'claude-cli' provider */
  claudeCliPath: string
  budget: Budget
  /** User overrides of the built-in price table, keyed by model id */
  prices: Record<string, ModelPrice>
  /** Background agent (Claude Code driving a browser) */
  agent: AgentSettings
  /** Whether a key is stored (the keys themselves never reach the renderer) */
  hasKey: { claude: boolean; openai: boolean }
}

/** Which browser the agent drives: Playwright MCP with an installed Chrome/Edge, or the Claude in Chrome extension. */
export type AgentBrowser = 'chrome' | 'msedge' | 'claude-in-chrome'

/**
 * Where "Check email replies" reads the inbox: the claude.ai Gmail connector of the Claude account the CLI is logged in
 * with (read-only tools), or the webmail (Gmail, Outlook.com / Hotmail…) opened in the agent's browser.
 */
export type EmailSource = 'gmail-connector' | 'webmail'

export interface AgentSettings {
  browser: AgentBrowser
  /** Model passed to `claude --model` for agent runs */
  model: string
  /** Ask in the app before every final Submit/Send click (off = fully automatic) */
  confirmBeforeSubmit: boolean
  /** Fill everything but never click Submit/Send (for testing) */
  dryRun: boolean
  maxApplicationsPerRun: number
  maxMessagesPerRun: number
  /** Jobs below this fit score are skipped */
  minScore: number
  /** After applying, find the recruiter/hiring manager and message them */
  outreach: boolean
  /** Also write a cover letter even when the form has no field for it */
  alwaysCoverLetter: boolean
  /** Extra standing instructions for every run (free text) */
  instructions: string
  /** Inbox used by the "check-email" task */
  emailSource: EmailSource
  /** Webmail address opened by the agent when emailSource is 'webmail' */
  webmailUrl: string
}

export const defaultSettings: Settings = {
  chatProvider: 'claude-cli',
  chatModel: { claude: 'claude-opus-5-5', 'claude-cli': 'claude-opus-5-5', openai: 'gpt-4.1', ollama: 'llama3.1' },
  embedProvider: 'local',
  embedModel: {
    local: 'Xenova/multilingual-e5-small',
    openai: 'text-embedding-3-small',
    ollama: 'nomic-embed-text'
  },
  ollamaUrl: 'http://localhost:11434',
  defaultLang: 'en',
  claudeCliPath: 'claude',
  budget: { monthlyUsd: 20, dailyUsd: null, warnPct: 80, includeSubscription: false },
  prices: {},
  agent: {
    browser: 'chrome',
    model: 'claude-sonnet-5-5',
    confirmBeforeSubmit: false,
    dryRun: false,
    maxApplicationsPerRun: 10,
    maxMessagesPerRun: 10,
    minScore: 60,
    outreach: true,
    alwaysCoverLetter: false,
    instructions: '',
    emailSource: 'gmail-connector',
    webmailUrl: 'https://outlook.live.com/mail/'
  },
  hasKey: { claude: false, openai: false }
}

export type AiOperation = 'analyze-job' | 'resume' | 'cover-letter' | 'gap-answer' | 'import-resume' | 'easy-apply' | 'embeddings' | 'agent' | 'test'

/** How a call is paid: per-token API billing, the Claude subscription (no extra charge), or local (free). */
export type Billing = 'api' | 'subscription' | 'local'

export interface UsageRecord {
  id: number
  createdAt: string
  provider: string
  model: string
  operation: AiOperation
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** USD. For 'subscription' this is the list-price equivalent, not an actual charge. null = unknown price. */
  costUsd: number | null
  billing: Billing
  ok: boolean
  error: string
}

export interface UsageTotals {
  calls: number
  apiUsd: number
  subscriptionUsd: number
  inputTokens: number
  outputTokens: number
}

export interface UsageSummary {
  today: UsageTotals
  month: UsageTotals
  byOperation: (UsageTotals & { key: string })[]
  byModel: (UsageTotals & { key: string; billing: Billing })[]
  /** Spend counted against the budget (API, plus subscription if enabled) */
  budget: Budget & { monthSpent: number; todaySpent: number; blocked: string | null }
  unknownPriceModels: string[]
  /** Effective price table (built-in + overrides) */
  prices: Record<string, ModelPrice>
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'app' | 'linkedin' | 'ai' | 'cli' | 'embeddings' | 'import' | 'ipc' | 'docs' | 'agent'

export interface LogEntry {
  id: number
  ts: string
  level: LogLevel
  source: LogSource
  message: string
  detail: string
}

/** Result of reading the job currently open on LinkedIn, with diagnostics of what was found where. */
export interface CaptureDiagnostics {
  url: string
  linkedinId: string | null
  titleFrom: string
  companyFrom: string
  descriptionFrom: string
  descriptionLength: number
}

export interface CliStatus {
  found: boolean
  loggedIn: boolean
  authMethod: string
  subscriptionType: string
  version: string
  error: string
}

/** Form field detected in the Easy Apply modal */
export interface FormField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'file'
  options: string[]
  required: boolean
  value: string
}

export interface FieldAnswer {
  key: string
  value: string
  /** 'memory' = previously saved answer; 'ai' = suggested by AI; 'unknown' = left for the user */
  origin: 'memory' | 'ai' | 'unknown'
}

export interface CapturedJob {
  url: string
  linkedinId: string | null
  title: string
  company: string
  location: string
  description: string
  easyApply: boolean
}

export interface JobSearchQuery {
  keywords: string
  location: string
  remote: boolean
  easyApplyOnly: boolean
}

/** API exposed to the renderer via contextBridge (window.api) */
export interface Api {
  profile: {
    get(): Promise<Profile>
    save(p: Profile): Promise<void>
    listItems(kind: ItemKind): Promise<ProfileItem[]>
    saveItem(kind: ItemKind, data: ItemDataMap[ItemKind], id?: number): Promise<ProfileItem>
    deleteItem(id: number): Promise<void>
    importResume(): Promise<{ imported: number } | null>
  }
  facts: {
    list(): Promise<Fact[]>
    add(text: string, source?: FactSource): Promise<Fact>
    update(id: number, text: string): Promise<void>
    delete(id: number): Promise<void>
    deleteMany(ids: number[]): Promise<{ deleted: number }>
    reindex(): Promise<{ indexed: number }>
  }
  jobs: {
    list(): Promise<Job[]>
    get(id: number): Promise<Job | null>
    addManual(input: { url: string; title: string; company: string; description: string }): Promise<Job>
    setStatus(id: number, status: JobStatus): Promise<void>
    delete(id: number): Promise<void>
    analyze(id: number): Promise<Job>
    answerGap(jobId: number, gap: string, answer: string): Promise<Fact>
  }
  docs: {
    generateResume(jobId: number, lang?: Lang): Promise<Application>
    generateCoverLetter(jobId: number, lang?: Lang, tone?: string): Promise<Application>
    saveApplication(app: Application): Promise<void>
    exportResume(appId: number, format: 'pdf' | 'docx'): Promise<string | null>
    exportCoverLetter(appId: number, format: 'pdf' | 'docx'): Promise<string | null>
    previewResumeHtml(resume: ResumeDoc): Promise<string>
    previewCoverLetterHtml(letter: CoverLetterDoc, jobId: number): Promise<string>
    learnFromEdits(appId: number): Promise<{ added: number }>
  }
  applications: {
    list(): Promise<(Application & { job: Pick<Job, 'id' | 'title' | 'company' | 'url'> })[]>
    getByJob(jobId: number): Promise<Application | null>
    setStatus(id: number, status: ApplicationStatus): Promise<void>
    setArchived(id: number, archived: boolean): Promise<void>
  }
  blacklist: {
    list(): Promise<BlacklistEntry[]>
    add(entry: BlacklistInput): Promise<BlacklistEntry>
    delete(id: number): Promise<void>
  }
  qa: {
    list(): Promise<QaEntry[]>
    save(question: string, answer: string): Promise<void>
    delete(id: number): Promise<void>
  }
  linkedin: {
    open(url?: string): Promise<void>
    search(q: JobSearchQuery): Promise<void>
    openJob(jobId: number): Promise<void>
    openJobExternal(jobId: number): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    save(s: Omit<Settings, 'hasKey'>): Promise<void>
    /** Saves only the given fields (merged into the stored settings) */
    update(patch: Partial<Omit<Settings, 'hasKey'>>): Promise<void>
    setKey(provider: 'claude' | 'openai', key: string): Promise<void>
    testChat(): Promise<string>
    /** Checks that the Claude Code CLI is installed and logged in with a subscription */
    cliStatus(): Promise<CliStatus>
    /** Deletes ALL data (database, settings, API keys, LinkedIn session). Requires confirmation === 'RESET'. */
    resetAll(confirmation: string): Promise<void>
    /** Saves every table (not the API keys) to a JSON file chosen by the user. Returns the path, or null if cancelled. */
    exportData(): Promise<string | null>
    /** Replaces ALL data with a backup file chosen by the user (API keys stored here are kept). Null if cancelled. */
    importData(): Promise<Record<string, number> | null>
  }
  usage: {
    summary(): Promise<UsageSummary>
    recent(limit?: number): Promise<UsageRecord[]>
    clear(): Promise<void>
  }
  agent: {
    start(task: AgentTask): Promise<AgentRunInfo>
    stop(): Promise<void>
    state(): Promise<AgentState>
    /** Answer a pending question (or approval) from the agent */
    answer(questionId: string, answer: string): Promise<void>
    /** Opens the agent's browser profile folder / checks Playwright */
    checkBrowser(): Promise<{ ok: boolean; detail: string }>
  }
  outreach: {
    list(jobId?: number): Promise<Outreach[]>
    delete(id: number): Promise<void>
  }
  logs: {
    list(): Promise<LogEntry[]>
    clear(): Promise<void>
    /** Path of the log file on disk (null in browser mode) */
    filePath(): Promise<string | null>
  }
  onEvent(cb: (e: AppEvent) => void): () => void
}

export type AppEvent =
  | { type: 'jobs-changed' }
  | { type: 'blacklist-changed' }
  | { type: 'applications-changed' }
  | { type: 'facts-changed' }
  | { type: 'usage-changed' }
  | { type: 'log'; entry: LogEntry }
  | { type: 'toast'; level: 'info' | 'error'; message: string }
  | { type: 'agent'; event: AgentEvent }
  | { type: 'agent-state'; state: AgentState }
  | { type: 'outreach-changed' }

// ---------- blacklist ----------

/** company: never apply there · job: this posting · keyword: titles containing it · person: never contact */
export type BlacklistKind = 'company' | 'job' | 'keyword' | 'person'

export const BLACKLIST_KINDS: { id: BlacklistKind; label: string; placeholder: string }[] = [
  { id: 'company', label: 'Company', placeholder: 'Proxify' },
  { id: 'job', label: 'Job (URL)', placeholder: 'https://www.linkedin.com/jobs/view/4304136993/' },
  { id: 'keyword', label: 'Title keyword', placeholder: 'PHP, Java, estágio, crypto' },
  { id: 'person', label: 'Person (LinkedIn URL)', placeholder: 'https://www.linkedin.com/in/someone/' }
]

export interface BlacklistInput {
  kind: BlacklistKind
  /** What the candidate typed: company name, job URL, keyword, profile URL */
  label: string
  reason?: string
  /** Optional job the entry came from (to show its title) */
  jobId?: number | null
}

export interface BlacklistEntry {
  id: number
  kind: BlacklistKind
  /** Normalized value used for matching */
  value: string
  label: string
  reason: string
  jobId: number | null
  /** 'candidate' (added by hand) or 'agent' (from an answer during a run) */
  source: string
  createdAt: string
}

// ---------- background agent ----------

/** Where a search run looks for jobs. */
export type JobSource = 'linkedin' | 'remote-boards' | 'wellfound' | 'google' | 'funded-startups'

export const JOB_SOURCES: { id: JobSource; label: string; hint: string }[] = [
  { id: 'linkedin', label: 'LinkedIn Jobs', hint: 'LinkedIn job search, with Easy Apply when available.' },
  {
    id: 'remote-boards',
    label: 'Remote job boards (LATAM-friendly)',
    hint: 'Himalayas, Get on Board, Remotive, We Work Remotely, Working Nomads, RemoteOK, Work at a Startup, plus Gupy and Programathor (Brazil), filtered to roles open to your country.'
  },
  { id: 'wellfound', label: 'Wellfound (AngelList)', hint: 'Startup jobs on Wellfound. Needs a Wellfound account logged in the agent browser.' },
  { id: 'google', label: 'Google (career sites / ATS)', hint: 'Google search over Greenhouse, Lever, Ashby, Workable and other ATS boards, plus Google Jobs.' },
  { id: 'funded-startups', label: 'Recently funded startups', hint: 'Finds startups that just raised money (funding news), then their open roles on their career pages.' }
]

export type AgentTask =
  | { mode: 'apply-job'; jobId?: number; url?: string }
  | {
      mode: 'search'
      /** Defaults to 'linkedin' (older runs have no source) */
      source?: JobSource
      keywords: string
      location: string
      remote: boolean
      easyApplyOnly: boolean
      maxJobs: number
      /** funded-startups only: how recent the funding round must be */
      fundedWithinMonths?: number
    }
  | { mode: 'outreach'; jobId: number }
  | { mode: 'custom'; instructions: string }
  /** Reads recruiters' replies in the inbox and moves applications on the board (scheduling, interview, offer, rejected) */
  | { mode: 'check-email'; days: number }

export type AgentEventKind = 'status' | 'text' | 'tool' | 'tool-result' | 'skill' | 'question' | 'answer' | 'error' | 'result'

export interface AgentEvent {
  runId: string
  seq: number
  ts: string
  kind: AgentEventKind
  /** Short human-readable line */
  text: string
  /** Tool name for tool / tool-result events */
  tool?: string
  /** Full input/output (truncated) for expanding in the UI */
  detail?: string
  isError?: boolean
}

export type AgentQuestionKind = 'knowledge' | 'action' | 'approval'

export interface AgentQuestion {
  id: string
  runId: string
  kind: AgentQuestionKind
  question: string
  reason: string
  options: string[]
  jobId: number | null
  createdAt: string
}

export interface AgentRunInfo {
  runId: string
  task: AgentTask
  startedAt: string
  endedAt: string | null
  status: 'running' | 'done' | 'failed' | 'stopped'
  applications: number
  messages: number
  costUsd: number | null
  summary: string
}

export interface AgentState {
  run: AgentRunInfo | null
  questions: AgentQuestion[]
  events: AgentEvent[]
}

export type OutreachChannel = 'connection' | 'message' | 'inmail' | 'email'
export type OutreachStatus = 'sent' | 'failed' | 'skipped'

export interface Outreach {
  id: number
  jobId: number | null
  name: string
  profileUrl: string
  role: string
  channel: OutreachChannel
  message: string
  status: OutreachStatus
  notes: string
  createdAt: string
  job?: Pick<Job, 'id' | 'title' | 'company'> | null
}
