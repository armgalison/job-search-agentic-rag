---
name: find-jobs
description: Search LinkedIn Jobs for roles that match the candidate, read each result, save them to Job Search RAG and pick the ones worth applying to. Use when a run starts from search keywords instead of a specific job URL.
---

# Find jobs on LinkedIn

## Build the search

Load `search-strategy` first and build the query matrix from it: several role titles and locations, not one search. Search URL for each combination:

```
https://www.linkedin.com/jobs/search/?keywords=<urlencoded>&location=<urlencoded>&sortBy=DD
```

Optional filters: `&f_WT=2` (remote), `&f_AL=true` (Easy Apply only), `&f_TPR=r604800` (past week; `r2592000` is the past month), `&f_E=4` (mid-senior). Use the filters the run asks for.

- Locations: pass one location per search, never "A OR B". `location=Brazil`, `location=Latin America` and `location=Worldwide` all work. After the first search, LinkedIn adds a `geoId=<n>` to the URL. Keep it for the next queries in the same location (Brazil is `106057199`, Worldwide is `92000000`).
- Keywords: LinkedIn handles quoted titles and `OR` inside `keywords`. Prefer separate searches per title over one long `OR` chain, because they rank better.
- Pagination: add `&start=25`, `&start=50` and `&start=75` for pages 2 to 4, or use the page buttons.

## Read results

1. Navigate and wait for the result list. The list loads lazily, so scroll its container to the bottom once and all 25 cards render.
2. Extract every card in one script. The job id is in `data-occludable-job-id` / `data-job-id` on the card, or in a `/jobs/view/<id>/` or `currentJobId=<id>` link. Read the title, the company, the location, and the "Easy Apply", "Applied" / "Candidatou-se", "Promoted" and "Viewed" markers. If the cards expose no ids, click each card and read `currentJobId` from the URL.
3. Call `check_jobs` with all the cards (the bare job id works as `url`). Continue only with the `new` ones, as `search-strategy` says. Skip cards marked "Applied".
4. Pre-filter on the title alone. Drop roles that are clearly off target, such as a different function, a much more junior or senior level than the profile, or a location the preferences exclude.
5. For each job that is left, click the card (or open `https://www.linkedin.com/jobs/view/<id>/`), read the full description from the detail pane (expand "See more" if needed), and call `save_job` with the full description text. Then call `analyze_job`.
6. Go to the next page, then the next query, following the budget and stop rules in `search-strategy`.

## Pick

Sort the saved jobs by `score` and drop anything below `minScore`. Prefer Easy Apply jobs when the scores are close, because they finish more reliably. Return the ordered list (job id, title, company, score, easy apply yes/no) and continue with the `job-agent` pipeline for each one.

## Pace

Wait a few seconds between opening jobs. Stay within the page budget in `search-strategy`. If LinkedIn shows "You've reached the limit" or a security check, stop and tell the candidate with `ask_user` (kind `action`).
