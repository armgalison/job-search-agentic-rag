# Job Search RAG

Desktop app (Electron + Node.js + React) that automates most of a job application:
it captures LinkedIn jobs, scores your fit, generates a tailored resume and cover letter, and fills in Easy Apply.
Everything is grounded in a local knowledge base about you (RAG) that grows as you use it.

The UI and all generated content default to **English**. Resumes and cover letters can also be generated in
Portuguese (per document in the editor, or as the default under Settings → Default language).

## Running

```bash
npm install
npm run dev        # Electron app with hot reload
npm run dev:web    # UI only, in the browser (http://localhost:5174), no Electron; mock API and mock AI
npm test           # unit tests (Vitest)
npm run typecheck
npm run build:win  # Windows build → dist/Job Search RAG-<version>-win-x64.zip
```

### Getting started in the app

1. **Settings → Text generation.** The default provider is **Claude subscription (claude -p)**: it uses your Claude
   Pro/Max plan through the Claude Code CLI, no API key needed. Install Claude Code, run `claude` once and log in,
   then click **Check CLI**. Alternatives: Claude API (API key), OpenAI, or Ollama (local). Settings save automatically.
2. **My profile** → import your current resume (PDF/DOCX) and/or fill in experience, education, skills…
3. **Jobs** → *Open search on LinkedIn*. Log in once in the LinkedIn window with your **LinkedIn email and password**
   (the session is kept). *Continue with Google* does not work inside apps — Google blocks embedded browsers; if your
   account only uses Google, create a LinkedIn password once via *Forgot password* (the panel explains it).
4. On LinkedIn, use the floating panel: **Capture & analyze job** → the fit score (%) shows in the panel and in the app.
5. In the app, answer the job's **gaps** (each answer becomes a new fact) and click **Generate resume + cover letter**.
6. Review in the **Editor** and export to PDF/DOCX.
7. In Easy Apply, click **Fill Easy Apply** on each step. Green = saved answer, blue = AI suggestion, orange = fill it in
   yourself. The tailored resume is attached automatically. **You review and click Submit** — the panel never submits.
   Or let the **Agent** do the whole thing (see below).
8. **Usage** shows what every AI call cost and enforces your budget. **Console** shows what the app is doing (and why
   something failed); the LinkedIn panel has a mini console with *Copy log* too.

## Agent (fully automatic mode)

The **Agent** page runs Claude Code in the background (`claude -p` on your Claude subscription) and lets it drive a
**visible browser**, so you can watch every step. One run can:

1. search LinkedIn (or open a given job / company career page), save and score each job against your knowledge base;
2. close important gaps by **asking you** — the only thing it asks about is knowledge it can't find about you (and
   human-only steps: logging in, CAPTCHAs, verification codes). Every answer is saved to the knowledge base;
3. tailor your resume to the job and export PDF/DOCX; write a cover letter when the form has a field for it (or always,
   if you choose) and attach or paste it;
4. apply through **Easy Apply** or the company's own site/ATS (Greenhouse, Lever, Ashby, Workday, Gupy…), filling every
   question from saved answers and grounded facts;
5. find the job poster / recruiter / hiring manager and **send them a short message** or connection note.

Each step is a skill in the bundled Claude Code plugin [`agent-plugin/`](agent-plugin/skills): `job-agent`
(orchestrator), `knowledge-grounding`, `find-jobs`, `tailor-documents`, `cover-letter`, `easy-apply`, `external-apply`,
`find-contacts`, `outreach-message`, `send-linkedin-message` and `human-writing`. `human-writing` turns Wikipedia's
[Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) into writing rules; the agent runs
every message, cover letter and free-text answer through the `check_writing` tool
([`src/shared/writingCheck.ts`](src/shared/writingCheck.ts)), and the app's own resume/cover-letter/Easy Apply
generation uses the same rules (cover letters get one automatic revision pass when the checker flags something).

**How it is wired** (`src/main/agent/`): the app serves its own MCP server (`jobsearch`, Streamable HTTP on
127.0.0.1 with a random token) with the knowledge base, document export, form-answer memory, outreach records,
`ask_user` and `request_permission`. The browser is [Playwright MCP](https://github.com/microsoft/playwright-mcp) with
your installed Chrome or Edge and its own persistent profile (log in to LinkedIn there once, when the agent asks), or
the Claude in Chrome extension. The CLI runs isolated: only the plugin's skills, `--setting-sources ""`,
`--strict-mcp-config`, built-in tools limited to Skill/TodoWrite (no shell, no file edits), `--permission-mode dontAsk`
with an allowlist of the two MCP servers.

**Controls** (Settings → Agent): browser, model, minimum fit score, max applications and messages per run, outreach
on/off, always write a cover letter, **ask me before each final Submit/Send** (off by default = fully automatic) and
**dry run** (fills everything, never submits). Every final Submit/Send click goes through `request_permission`, which
enforces those limits. Questions show up on the Agent page with an OS notification. The Jobs page has
**Let the agent apply** for a single job.

## Features

**Knowledge base (RAG).** Profile items become atomic "facts", embedded locally (transformers.js, free) or via
OpenAI/Ollama, and retrieved per job requirement. It updates itself from profile edits, answers to job gaps, Easy Apply
answers (stored when you click Next/Review/Submit) and new bullets written in the editor. In *My profile → Knowledge
base* you can delete facts one by one, in bulk, or everything matching a filter; deleted profile-derived facts stay
excluded even after re-saving the item or reindexing.

**No fabrication.** Every prompt restricts the AI to the profile and the retrieved facts; requirements without
evidence become gaps (questions to you), not bullets.

**Claude subscription instead of API tokens.** The *Claude subscription (claude -p)* provider runs the Claude Code CLI
headless, so calls count against your plan's limits instead of per-token billing. Each call runs with no tools, no MCP
servers, none of your settings/CLAUDE.md files, no saved session, and without `ANTHROPIC_API_KEY` in its environment.
If `claude` is not on the app's PATH (common right after installing, for apps started from Explorer/Finder), the app
also looks in the installer's default location (`~/.local/bin`, i.e. `%USERPROFILE%\.local\bin\claude.exe` on Windows).
Meant for personal use of your own subscription.

**Spend control (Usage page).** Every AI call is logged with provider, model, operation, tokens, cost and billing type
(API / subscription / local). Monthly and daily limits in USD plus a warning threshold: when a limit is reached, new
API-billed calls are refused before reaching the provider. Subscription usage is shown at its list-price equivalent
(reported by the CLI; not an actual charge) and can optionally count toward the limits, to keep the app from draining
your plan. Prices are editable (built-in Claude list prices; OpenAI values are estimates).

**Resume import.** PDF (pdf.js — also reads PDFs with broken cross-reference tables), DOCX (mammoth) or text; the AI
maps it into your profile, only filling empty fields and never duplicating items. In browser mode a heuristic parser
is used instead of AI.

**Reset.** Settings → Danger zone → *Reset system…* deletes all data (database, settings, API keys and the LinkedIn
session) after you type `RESET`. Exported files and the downloaded embedding model are kept.

## Architecture

| Layer | Files |
|---|---|
| Database (SQLite, `better-sqlite3`) | `src/main/db/` — profile, facts, embeddings, jobs, applications, question memory, AI usage log |
| AI providers | `src/main/ai/` — `RawChatProvider` implementations (Claude API, Claude CLI, OpenAI, Ollama), wrapped by `MeteredChat` (budget check + usage log); embeddings |
| Pricing & usage | `src/main/ai/pricing.ts`, `src/main/usage.ts` |
| RAG | `src/main/rag/` — profile → facts → embeddings → similarity search (one query per job requirement) |
| Generation | `src/main/services/` — job analysis, fit score, resume, cover letter, gaps, resume import, Easy Apply answers |
| Documents | `src/main/docs/` — HTML template → PDF (`printToPDF`) and DOCX (`docx`) |
| Agent | `src/main/agent/` — runner (`claude -p` stream-json), app MCP server, questions/limits; skills in `agent-plugin/` |
| LinkedIn | `src/main/linkedin/window.ts` + `src/preload/linkedin.ts` — persistent-session window and injected panel |
| IPC | `src/main/ipc.ts`, `src/preload/index.ts`, typed API in `src/shared/types.ts` |
| Logging | `src/main/log.ts` — in-memory + `<userData>/logs/app.log`, streamed to the Console page and the LinkedIn panel |
| UI | `src/renderer/src/pages/` (browser mode: `src/renderer/src/mockApi.ts`) |

Data lives in `app.getPath('userData')/job-search.db` (Windows: `%APPDATA%\job-search-rag`). API keys are encrypted
with `safeStorage` (OS keychain) and never reach the renderer.

## Windows build

`npm run build:win` produces a zip (unzip and run `Job Search RAG.exe`). It is built from Linux/WSL as a zip because
an NSIS installer needs Wine on Linux — run the same command on Windows to get one. The build is unsigned, so
SmartScreen may warn on first launch (*More info → Run anyway*). Native modules ship Windows prebuilds; a
`beforePack` hook (`scripts/before-pack.cjs`) installs and verifies the target platform's native binaries (sharp,
SQLite, onnxruntime) on every build. pdf.js is unpacked from the asar archive because it is loaded as an ES module.

## Tests

`npm test` runs the unit tests. A live check of the Claude CLI integration is opt-in (it makes two tiny calls on your
subscription): `RUN_CLI_TEST=1 npx vitest run tests/claudeCli.live.test.ts`. An end-to-end agent run (real `claude -p`,
skills, MCP server, Playwright + Chrome, against a local fake job page and form) is opt-in too, and uses noticeably
more of your subscription: `RUN_AGENT_TEST=1 npx vitest run tests/agent.live.test.ts`.

## Notes

- **LinkedIn Terms:** automating applications, messages and scraping violates LinkedIn's User Agreement and can get the
  account restricted. The LinkedIn panel is semi-automatic (you navigate and click Submit). The Agent is fully automatic
  when you allow it: keep the per-run limits low, and turn on "ask me before each Submit/Send" if you want a final say.
  The agent stops when LinkedIn shows a limit or security warning, and never bypasses CAPTCHAs.
- **LinkedIn selectors change** often. If capturing or filling stops working, adjust the selectors in
  `src/preload/linkedin.ts` (it matches both the English and Portuguese LinkedIn UI).

See [CHANGELOG.md](CHANGELOG.md) for the history of changes.
