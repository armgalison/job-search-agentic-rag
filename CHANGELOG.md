# Changelog

## Unreleased

### Features
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
