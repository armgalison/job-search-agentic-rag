---
name: find-jobs-remote-boards
description: Find remote jobs open to the candidate's country on remote-first job boards (Himalayas, Get on Board, Remotive, We Work Remotely, Working Nomads, RemoteOK, Work at a Startup) and Brazilian boards (Gupy, Programathor), then save and score them in Job Search RAG. Use when a search run's source is remote job boards.
---

# Remote job boards

These boards mostly list remote roles, and several say which countries a role is open to. That makes them good for candidates outside the US. Load `search-strategy` and build the query matrix first.

## Boards, best first for a LATAM candidate

| Board | How to search | Notes |
|---|---|---|
| Himalayas | `https://himalayas.app/jobs?q=<role>`, then the country filter set to the candidate's country | Each role lists the countries it accepts. Trust that list. |
| Get on Board | `https://www.getonbrd.com/jobs?q=<role>` | Latin American tech jobs. Many say "Remote (LATAM)". |
| Remotive | `https://remotive.com/remote-jobs/software-dev?search=<role>` | Read the "Location" line, for example "Americas", "LATAM" or "Worldwide". |
| We Work Remotely | `https://weworkremotely.com/remote-jobs/search?term=<role>` | Read the region badge ("Anywhere in the World", "Latin America only"). |
| Working Nomads | `https://www.workingnomads.com/jobs?category=development` with the keyword filter | Read the location tags. |
| RemoteOK | `https://remoteok.com/remote-<keyword>-jobs` (for example `remote-node-jobs`) | Many roles are US-only. Check each one. |
| Work at a Startup (YC) | `https://www.workatastartup.com/jobs` | Needs a login. Use `ask_user` (kind `action`) the first time. Filter by remote and role. |
| Gupy (Brazil) | `https://portal.gupy.io/job-search/term=<role>`, filtered to remote | Brazilian companies (CLT or PJ). Portuguese queries work best here. |
| Programathor (Brazil) | `https://programathor.com.br/jobs?search=<role>` | Brazilian tech jobs. Filter to remote. |

Use 3 to 5 boards per run, starting with the first rows. A board that gives nothing new for two queries in a row can be dropped for the rest of the run.

## For each board

1. Run the queries from the matrix. On each results page, extract all the cards in one go (title, company, location or region, posting URL, date) and triage them with `check_jobs`.
2. Open only the `new` ones that pass the eligibility rules in `search-strategy`. Many boards link to the company's ATS ("Apply" goes to Greenhouse, Lever and the like). Follow that link, and save the job under **the ATS posting URL** when there is one, so it matches the same job found elsewhere. Keep the board URL only when the application happens on the board.
3. Call `save_job` with the full description. Add a last line with the board's eligibility info, for example "Board: Himalayas, open to Brazil, Argentina, Mexico; salary $80k-$110k". Then call `analyze_job`.

## Pace and access

Wait a few seconds between pages. If a board shows a Cloudflare check or a login wall, skip that board, unless it's Work at a Startup (ask once). Don't create accounts.

Apply with `external-apply`.
