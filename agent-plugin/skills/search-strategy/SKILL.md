---
name: search-strategy
description: How to search for jobs well, for every source (LinkedIn, remote boards, Wellfound, Google, funded startups) - expand the candidate's roles into many queries and locations, paginate, triage every results page with check_jobs so known, applied and blacklisted jobs are never reopened, check location eligibility, and keep going until the run's target is met. Load it with the source's find-jobs skill in every search run.
---

# Search strategy

Runs used to stop after one query and about ten jobs. One query finds a small slice of what exists. Search wide, triage cheaply, and open only what is new.

## 1. Build the query matrix (before the first search)

From `get_candidate_profile`, take `targetRoles`, the headline, the titles of the last two or three jobs and the strongest skills. If the run gave keywords, they come first, but still add variants.

- **Role titles, 4 to 8 of them**: the exact target titles plus common synonyms and seniority variants. For a senior Node.js backend profile, for example: "Senior Backend Engineer", "Senior Node.js Developer", "Senior Software Engineer Node", "Backend Developer TypeScript", "Full Stack Engineer Node React", "Staff Backend Engineer", and the Portuguese ones, "Desenvolvedor Back End Sênior", "Engenheiro de Software Sênior" and "Desenvolvedor Node.js". Use Spanish ones only if the candidate speaks Spanish.
- **Stack keywords** as a second axis, when the source supports them: "Node.js", "NestJS", "TypeScript", plus the candidate's main database or cloud.
- **Locations**: split the run's location on "OR", commas and "/" ("latin america OR worldwide" becomes two searches). Fix obvious typos ("wideworld" means "Worldwide"). With no location, use the candidate's country, then "Latin America", then "Worldwide" with the remote filter.
- **Recency**: start with the past week. If a query gives fewer than 10 new results, widen it to the past month.

Write the matrix down with TodoWrite, one item per query and location. Run the most specific combinations first.

## 2. Triage every results page with `check_jobs`

On every results page, before you click any card:

1. Extract all the cards at once with one script, reading the title, the company, the location, the job URL or id, and the Easy Apply, Applied and Promoted markers. Don't take a snapshot per card.
2. Call `check_jobs` with all of them.
3. Open only the cards with verdict `new`. Skip `applied` and `blacklisted` without comment. Skip `known` too: it was already evaluated, and its `recorded` field says what happened. Reopen a known job only when its status is `captured` (saved but never analyzed).
4. Drop new cards whose title is clearly off target, or whose location rules the candidate out, before opening them.

## 3. Location eligibility

Read the location and remote policy of every job. "Remote" alone often means "remote within the US". For a candidate outside the US, accept jobs that say Worldwide, Anywhere, LATAM, Latin America, the Americas, their country, or a time zone they can work in (for Brazil: UTC-3, and often "US Eastern overlap"). Accept contractor setups as well ("contractor", "PJ", "B2B", Deel or Remote.com). Skip jobs that require US or EU work authorization, or residence in a country the candidate doesn't live in, unless their profile says they have it.

## 4. Budget and when to stop

- Page budget: up to 4 results pages per query, and up to max(40, 4 × the run's job target) job pages opened in the whole run.
- Keep a running count of new results, jobs saved, jobs at or above `minScore`, and applications.
- Stop searching only when one of these happens:
  - you have enough jobs at or above `minScore` for the run's application target (plus about 30% spare for failures);
  - the whole query matrix is used up, with recency widened where it was thin;
  - the page budget is spent;
  - a rate limit, security check or "unusual activity" warning appears.
- If a query returns mostly `known` jobs, that's good news, because the triage was cheap. Go to the next query. Don't end the run because of it.
- Interleave: once you have 3 to 5 good jobs, apply to them, then go back to searching. Don't search for an hour before the first application.

## 5. Report

In the final report, list each query and location with its counts (results, new, saved, at or above minScore). Then say which source or query to try next time. If `targetRoles` is empty, suggest that the candidate fill it in.
