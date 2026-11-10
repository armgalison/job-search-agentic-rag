# Changelog

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
