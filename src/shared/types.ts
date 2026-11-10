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

export type ApplicationStatus = 'draft' | 'applied' | 'interview' | 'offer' | 'rejected'

export interface Application {
  id: number
  jobId: number
  resume: ResumeDoc | null
  coverLetter: CoverLetterDoc | null
  status: ApplicationStatus
  notes: string
  appliedAt: string | null
  updatedAt: string
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
  /** Whether a key is stored (the keys themselves never reach the renderer) */
  hasKey: { claude: boolean; openai: boolean }
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
  hasKey: { claude: false, openai: false }
}

export type AiOperation = 'analyze-job' | 'resume' | 'cover-letter' | 'gap-answer' | 'import-resume' | 'easy-apply' | 'embeddings' | 'test'

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
  }
  usage: {
    summary(): Promise<UsageSummary>
    recent(limit?: number): Promise<UsageRecord[]>
    clear(): Promise<void>
  }
  onEvent(cb: (e: AppEvent) => void): () => void
}

export type AppEvent =
  | { type: 'jobs-changed' }
  | { type: 'applications-changed' }
  | { type: 'facts-changed' }
  | { type: 'usage-changed' }
  | { type: 'toast'; level: 'info' | 'error'; message: string }
