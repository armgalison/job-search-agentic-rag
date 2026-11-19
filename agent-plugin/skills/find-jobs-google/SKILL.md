---
name: find-jobs-google
description: Use Google to find jobs on company career sites and ATS job boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Gupy and others), plus Google's own job listings, then save and score them in Job Search RAG. Use when a search run's source is Google.
---

# Find jobs with Google

Many companies, startups especially, post jobs only on their ATS board and never on LinkedIn. Google indexes those boards.

## Before searching

Load `search-strategy` and build the query matrix. Triage every results page with `check_jobs` and open only the `new` ones.

## Queries

Use the run's keywords, or the candidate's `targetRoles`. Build two to four queries and open them as `https://www.google.com/search?q=<urlencoded>&tbs=qdr:m`. The `qdr:m` filter limits results to the past month. Use `qdr:w` for the past week.

- ATS boards: `("Senior Backend Engineer" OR "Senior Node.js Engineer") (site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:apply.workable.com)`, adding `remote` and the location (for example `"Brazil" OR "LATAM"`) when the run asks for them.
- More boards: `site:jobs.smartrecruiters.com`, `site:*.gupy.io`, `site:*.teamtailor.com`, `site:*.recruitee.com`, `site:*.breezy.hr`, `site:*.bamboohr.com/careers`. Gupy and Inhire are common in Brazil.
- Google's job listings: `https://www.google.com/search?q=<role> <location> jobs&ibp=htl;jobs`. Each listing names the site that hosts it. Prefer the company's own site over aggregators.

If Google shows a CAPTCHA or "unusual traffic" page, call `ask_user` (kind `action`) and let the candidate solve it. Never retry in a loop.

## Read and save

1. From each results page, take the job postings themselves. Skip search pages, closed postings ("This job is no longer available"), aggregators that only repost (when the original is available), then triage the rest with `check_jobs`. Google shows about 10 results per page, so read 3 to 5 pages per query (`&start=10`, `&start=20`, and so on).
2. Drop titles that are clearly off target, and roles whose location rules out the candidate.
3. Open each remaining posting. Read the title, the company (usually in the URL, for example `jobs.lever.co/<company>/...`), the location, the remote policy and the full description. Check the posting date when there is one, and skip anything older than about 60 days.
4. Call `save_job` with the posting's own URL (not the Google link) and the full description, then call `analyze_job`.
5. Follow the budget and stop rules in `search-strategy`.

## Pick

Sort by `score` and drop anything below `minScore`. Return the ordered list and continue with the `job-agent` pipeline. These jobs are applied to through `external-apply`.
