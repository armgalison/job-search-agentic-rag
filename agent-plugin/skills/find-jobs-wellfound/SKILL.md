---
name: find-jobs-wellfound
description: Search Wellfound (formerly AngelList Talent) for startup jobs that match the candidate, read each one, save them to Job Search RAG and pick the ones worth applying to. Also says how to apply on Wellfound. Use when a search run's source is Wellfound.
---

# Find jobs on Wellfound

Wellfound lists startup jobs. Most are applied to on Wellfound itself, with a short note to the founder or hiring team. Some link to the company's own ATS.

## Log in first

Open `https://wellfound.com/jobs`. If it shows a login or sign-up page, or a "verify you are human" check, call `ask_user` (kind `action`): "Please log in to Wellfound in the agent's browser window (or solve the check), then click Done." Never create the account or type a password yourself. The session is kept for future runs.

## Build the search

1. Load `search-strategy` and build the query matrix. Triage every results page with `check_jobs` and open only the `new` ones.
2. Use the run's keywords, or the candidate's `targetRoles` from `get_candidate_profile`.
3. The search lives on `https://wellfound.com/jobs`. Set the role and the location filters in the page's search bar and filter panel, and use "Remote" when the run asks for remote. Role pages like `https://wellfound.com/role/r/software-engineer` (remote) or `https://wellfound.com/role/l/software-engineer/brazil` also work as a starting point.
4. Wellfound lists the startups first, with their open roles underneath. Read each startup's name, size, stage and one-liner, then the role titles, salary or equity ranges, location and remote policy. Many roles say "Remote only in US" or name a time zone. Drop the roles the candidate can't take, judging by their location and preferences.

## Read and save

1. Drop titles that are clearly off target (another function, a level far below or above the profile), roles the app already has as applied, and roles whose card says "Applied".
2. Open each remaining role (`https://wellfound.com/jobs/<id>-<slug>`). Read the full description, the compensation, the visa and location notes, and whether the button says "Apply" (on Wellfound) or links to an external site.
3. Call `save_job` with the role URL, the title, the company, the location, and the full description. Add a last line to the description with the startup facts, for example "Startup: Series A, 11-50 people, salary $90k-$120k, 0.1%-0.3% equity". Pass `applied_on_page: true` if Wellfound shows that the candidate already applied. Then call `analyze_job`.
4. Follow the budget and stop rules in `search-strategy`.

## Pick

Sort by `score` and drop anything below `minScore`. When scores are close, prefer roles that apply on Wellfound and accept the candidate's location. Return the ordered list and continue with the `job-agent` pipeline.

## Applying on Wellfound

When the role's button is "Apply" on Wellfound, do this in place of `easy-apply`:

1. Click "Apply". A panel opens with a text box for a note to the company, sometimes with extra questions.
2. Write the note following `outreach-message` and `human-writing`: three to five sentences, specific to this startup and this role, grounded in `search_knowledge`. Run `check_writing`.
3. Answer any extra questions as `easy-apply` describes (`suggest_form_answers`, then `knowledge-grounding` for unknown required ones). Wellfound sends the resume from the candidate's Wellfound profile. If the panel offers a resume upload, use the PDF from `prepare_resume`.
4. `request_permission(kind: "application", job_id, summary)`. Click "Send application" only if it's allowed.
5. Confirm that the button changed to "Applied", then call `remember_answers` and `record_application(job_id, status: "applied", channel: "external", url: <the role URL>)`.

When the button leads to an external site, follow `external-apply`.

## Pace

Wait a few seconds between page loads. If Wellfound shows a rate limit or a bot check, stop and call `ask_user` (kind `action`).
