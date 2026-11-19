---
name: find-funded-startups
description: Find startups that recently raised a funding round (seed, Series A/B/C) in the candidate's field, then find their open roles on their own career pages or ATS boards, save and score them in Job Search RAG. Startups hire right after raising. Use when a search run's source is recently funded startups.
---

# Jobs at recently funded startups

A startup that just raised money is usually hiring. Find the rounds first, then the jobs.

## Before searching

Load `search-strategy`. Triage every list of roles with `check_jobs` and open only the `new` ones.

## 1. Find the funding rounds

Use the run's time window (default 6 months) and the candidate's field: the keywords, `targetRoles` and the industries in their profile. Look in a few of these sources:

- Google News: `https://www.google.com/search?q=<query>&tbm=nws&tbs=qdr:y`, with queries like `startup raises "Series A" <field>`, `"seed round" <field> startup`, or `startup capta "rodada" <field>` for Brazilian news. Narrow it to the location the run asks for, for example `Brazil`, `LATAM` or `Europe`.
- Funding news sites: `https://news.crunchbase.com/`, `https://techcrunch.com/category/venture/`, and for Latin America `https://latamlist.com/` and `https://www.startse.com/` (Portuguese).
- Startup job boards that list funded companies: `https://www.ycombinator.com/jobs` (Y Combinator companies), and `https://wellfound.com/` filtered by funding stage.

For each round, note the startup's name, website, the round (stage, amount, date, lead investor), what it builds, and the source URL. Keep only rounds inside the time window, from startups where the candidate's profile would plausibly fit (its stack and area). Collect 20 to 30 startups. Most won't have a matching role, so a short list finds nothing. Favor startups that already hire remotely across borders: the news says "remote-first", "distributed team" or "hiring in Latin America", or the startup itself is Latin American (LatamList, StartSe, Brazil Journal).

If a site shows a paywall, a CAPTCHA or a login wall, skip it and use another source. Ask the candidate (`ask_user`, kind `action`) only for a CAPTCHA on Google itself.

## 2. Find their open roles

For each startup, in order of fit:

1. Open its careers page: a "Careers" / "Jobs" / "Vagas" / "Trabalhe conosco" link on the website, or try `<site>/careers` and `<site>/jobs`. Many startups use an ATS board: `jobs.ashbyhq.com/<company>`, `jobs.lever.co/<company>`, `boards.greenhouse.io/<company>`, `apply.workable.com/<company>`, `<company>.gupy.io`. A Google search such as `<company> careers` or `<company> (site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:boards.greenhouse.io)` finds them.
2. If there is no careers page, check the company's LinkedIn jobs: `https://www.linkedin.com/company/<slug>/jobs/`.
3. Pick the roles that match the candidate's target roles. Triage them with `check_jobs`. Judge location with the eligibility rules in `search-strategy`: many US startups hire in LATAM as contractors ("Remote - Americas", "LATAM", or through Deel), so read the posting before ruling it out.
4. Open each matching role and call `save_job` with the role's URL and the full description. Add a last line to the description with the funding facts, for example "Funding: Series A, $15M, Sep 2026, led by Kaszek (source: <url>)". Then call `analyze_job`.

Follow the budget and stop rules in `search-strategy`. A startup with no matching role is fine. Mention it in the final report ("raised a Series A, no backend roles open yet"), because the candidate may want to reach out anyway.

## Pick

Sort by `score` and drop anything below `minScore`. When scores are close, prefer the more recent rounds. Return the ordered list and continue with the `job-agent` pipeline: `external-apply` for career sites and ATS boards, `easy-apply` for LinkedIn Easy Apply. In the outreach step, the founders and the CTO are good contacts at small startups (under 50 people). Mention the round in the note only when it's natural ("congrats on the Series A").
