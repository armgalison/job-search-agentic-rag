# Changelog

## Unreleased

### Features
- **Check email replies**: new agent task (Agent page, or "📬 Check email replies" on Applications) that reads
  companies' answers in your inbox and moves the cards: Awaiting scheduling, Interview, Offer, Rejected, or adds
  applications made outside the app from their confirmation emails. Reads Gmail through the claude.ai Gmail
  connector (only search/read tools are allowed) or a webmail (Outlook/Hotmail…) in the agent's browser (Settings →
  Agent → Inbox). Each email is recorded once; offer/rejected are never reopened by mistake. New `check-email` skill
  and MCP tools `list_tracked_applications` and `update_application_from_email`; the card shows the latest next step.
- **New board column "Awaiting scheduling"** (status `scheduling`) between Applied and Interview.
- **Backup**: Settings → Backup exports all data and settings to one JSON file and imports it (replacing current
  data). API keys are not exported (they are encrypted for this computer); embeddings are rebuilt after import.
- **Back navigation**: Back returns to the page you came from (Applications → documents → job details → back to
  Applications), also with the mouse back button and Alt+←. Cards on Applications have a "Details" link.
- **Agent** (new page): fully automatic job search, application and outreach. Claude Code runs headless in the
  background and drives a visible browser (Playwright MCP with Chrome/Edge and a persistent profile, or Claude in
  Chrome). It saves and scores jobs, tailors the resume, writes and attaches cover letters, applies through Easy Apply
  or the company's ATS, finds the job poster / recruiter / hiring manager and messages them. It only asks you about
  knowledge missing from your profile (answers become facts) or human-only steps (login, CAPTCHA). Live activity log,
  question/approval cards with OS notifications, Stop button, outreach history. "Let the agent apply" on a job.
- **Skills**: one Claude Code skill per flow in the bundled `agent-plugin/` (job-agent, knowledge-grounding, find-jobs,
  tailor-documents, cover-letter, easy-apply, external-apply, find-contacts, outreach-message, send-linkedin-message),
  plus `human-writing`, built from Wikipedia's "Signs of AI writing".
- **Agent search type**: a "Search type" select in "Search and apply": LinkedIn Jobs, Wellfound (startup jobs, also
  applies on Wellfound with a note to the founders), Google (company career sites and ATS boards: Greenhouse, Lever,
  Ashby, Workable, Gupy… plus Google Jobs) and recently funded startups (funding news from the last 3–18 months, then
  each startup's open roles). New skills `find-jobs-wellfound`, `find-jobs-google`, `find-funded-startups`. Jobs
  from outside LinkedIn are deduplicated by URL (tracking parameters ignored).
- **Blacklist** (new page): companies, specific jobs, title keywords and people the agent must never apply to or
  contact. Answering "Skip this job", "Never apply to this job/company" or "Never contact this person" during a run
  adds an entry; so does telling the agent in an answer or in the standing instructions (`add_to_blacklist`). Every
  run's prompt lists it and `check_jobs`, `save_job` and `request_permission` enforce it. "🚫 Blacklist…" on a job.
- **Better searches**: new `search-strategy` skill used by every source (query matrix from the profile's roles,
  synonyms and Portuguese titles; one location per search; pagination; widen recency when thin; page budget scaled
  to the run; stop rules that don't give up after one weak query; per-query counts in the report). New
  `check_jobs` tool triages a whole results page at once (new / known / applied / blacklisted), so known jobs are
  not reopened. New "Remote job boards (LATAM-friendly)" source (Himalayas, Get on Board, Remotive, We Work
  Remotely, Working Nomads, RemoteOK, Work at a Startup, Gupy, Programathor).
- **Applications board**: drag and drop between columns, archive (drag onto the archive zone or 🗄 on a card),
  "Show archived", filter by title/company.
- **Never twice**: the agent reads the LinkedIn conversation and "Pending" invitations before messaging, and the
  job page's "Applied" marker or the ATS account before applying, so things done by hand outside the app are
  respected and remembered. `request_permission` refuses a Submit/Send for a job already applied to or a person
  already contacted; any application past draft (interview, offer, rejected) counts as applied; earlier applications
  at the same company are reported.
- **App MCP server** for the agent (knowledge search, profile, save/analyze job, resume and cover letter files,
  form-answer memory, `check_writing`, `ask_user`, `request_permission`, application and outreach records).
- **Agent settings**: browser, model, minimum fit, per-run limits for applications and messages, outreach on/off,
  always write a cover letter, ask before each Submit/Send, dry run, standing instructions.
- **AI-writing checker** (`src/shared/writingCheck.ts`): the app's resume, cover-letter and form-answer generation now
  follow the same writing rules; cover letters get one automatic revision when the checker flags something.
- **LinkedIn window toolbar**: back, forward, reload/stop, LinkedIn Jobs (home), an address bar and "open in your
  browser". The address bar loads LinkedIn addresses, opens other sites in the system browser, and turns plain words
  into a LinkedIn job search. Shortcuts: Alt+←/→, F5/Ctrl+R, Ctrl+L/F6 (address bar), Esc (stop). The toolbar is
  the app's own page above the LinkedIn view, so LinkedIn cannot read or change it.
- **Capture all search results** (LinkedIn panel): walks the whole results list (rendering each card, then the
  next page, or "See more jobs" on the public page) and saves every job as a lead, page by page. The button turns
  into *Stop capturing* while it runs; limit 40 pages / 1000 jobs, with a short pause between pages. The job list
  reader now also understands the public (signed-out) results page and job links with a slug in the URL.
- **Open in browser** on a job in the Jobs page: opens the job in the system browser.
- **Console**: a new Console page in the app shows the live log (LinkedIn panel, AI calls with duration/tokens/cost,
  Claude CLI, embedding model download progress, resume import, IPC errors), filterable by level/source and
  searchable; the log is also written to `<userData>/logs/app.log`. The LinkedIn panel has a mini console
  (with *Copy log*) that mirrors the relevant lines.
- LinkedIn panel feedback: buttons show a working state, the status line is colored (busy with spinner and elapsed
  time / success / error), and a card shows the captured job and then its fit score and summary.

### Fixes
- Windows builds made after the PDF fix were missing sharp's Windows binary, so the local embedding model failed
  ("Could not load the sharp module using the win32-x64 runtime") and job analysis stopped. A `beforePack` hook
  (`scripts/before-pack.cjs`) now installs and verifies the target platform's native binaries (sharp, SQLite,
  onnxruntime) on every build, and fails the build if one is missing.
- If embeddings are unavailable for any reason, search falls back to keyword matching (logged as a warning) instead
  of failing the analysis or generation.
- The captured title could be a LinkedIn promo heading ("Take the next step in your job search"): on a job's own
  page the tab title (both the logged-in "Title | Company | LinkedIn" and public "Title at Company — Location"
  formats) is now preferred over generic headings, `<h2>` is no longer used, and promo headings are rejected.
- "Capture & analyze job" did nothing visible and saved nothing when the job page could not be read. Capture is now
  two steps (save immediately, then analyze), and reading the page is more robust: logged-in and public page
  selectors, the "About the job" heading, the job id from the detail pane's own link, and sanity checks so a search
  heading or the whole page is never saved as the job. What was read from where is logged, and fields read with
  generic fallbacks are flagged for review.
- The LinkedIn panel never appeared on LinkedIn pages: LinkedIn enforces Trusted Types (CSP), which rejects
  `innerHTML`, so mounting the panel threw. The panel is now built with DOM APIs only.
- "Sign in with Google" in the LinkedIn window opened a blank page in the system browser: sign-in popups
  (Google, Apple, Microsoft) now open as child windows of the LinkedIn window, in the same session, so they can hand
  the login back to LinkedIn. Other sites still open in the system browser (`src/main/linkedin/navigation.ts`).
- Google deliberately refuses sign-in from embedded browsers ("This browser or app may not be secure"). That
  security policy is not worked around: on LinkedIn sign-in pages the panel now explains how to sign in with a
  LinkedIn email and password instead (including how to create a password for a Google-only account).
- The LinkedIn panel is no longer injected into sign-in popups.

## 0.1.0 — 2026-11-10

### Features
- Electron + React + TypeScript desktop app with a local SQLite knowledge base (RAG) about the candidate.
- LinkedIn integration (semi-automatic): persistent-login window, injected panel to capture jobs and job lists,
  fit analysis, and Easy Apply form filling that never submits on its own; answers are remembered for next time.
- Tailored resume and cover letter generation grounded only in the candidate's facts; PDF and DOCX export; editor
  with live preview; new bullets can be sent back to the knowledge base.
- Resume import from PDF/DOCX/text into the profile.
- Knowledge base management: per-fact, bulk and filtered deletion; deleted profile facts stay excluded.
- Configurable AI providers: Claude subscription via `claude -p` (default), Claude API, OpenAI, Ollama; local embeddings.
- Usage log and budget control: per-call tokens/cost/billing, monthly/daily limits, warning threshold, editable prices.
- English UI and output by default; Portuguese available for generated documents.
- Browser-only dev mode (`npm run dev:web`) with a mock API, mock AI and heuristic resume parsing.
- System reset (deletes all data, settings, keys and the LinkedIn session).
- Windows build (`npm run build:win`).

### Fixes
- Resume import failed with "bad XRef entry" on many PDFs: replaced `pdf-parse` (2017 pdf.js) with current `pdfjs-dist`,
  which rebuilds broken cross-reference tables; pdf.js is loaded by file URL outside the asar archive in packaged builds.
- "Set your Anthropic API key" while using the subscription: the provider choice only took effect after clicking
  "Save settings". Settings now save automatically, the default provider is the Claude subscription, and errors name
  the active provider.
- Claude CLI not found on Windows when `%USERPROFILE%\.local\bin` is missing from the app's PATH: the default install
  location is now checked as a fallback.
- `claude -p --json-schema` rejected Zod's draft 2020-12 `$schema` key; it is stripped before sending.
