---
name: external-apply
description: Apply on a company's own career site or ATS (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS, Gupy, Kenoby/Inhire, Teamtailor, BambooHR, generic forms) after clicking LinkedIn's external "Apply" button. Use when the job has no Easy Apply.
---

# External application (company site / ATS)

1. On LinkedIn, click "Apply" / "Candidatar-se". It opens a new tab. Switch to it (`browser_tabs`) and take a snapshot.
2. Identify the ATS from the URL and page: `boards.greenhouse.io` / `job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `*.myworkdayjobs.com`, `jobs.smartrecruiters.com`, `*.icims.com`, `*.gupy.io`, `*.inhire.app`, `*.teamtailor.com`, `*.bamboohr.com`, or a custom form.
3. **Accounts and logins**:
   - Greenhouse, Lever, Ashby, SmartRecruiters and Teamtailor usually need no account. Fill and submit.
   - Workday, iCIMS and Gupy often need an account. If there's a "Sign in" wall, call `ask_user` (kind `action`): "<Company> uses Workday and needs an account. Please sign in or create the account in the agent's browser window, then click Done." Never invent a password. Never use "Sign in with Google/LinkedIn" on the candidate's behalf without asking.
   - CAPTCHAs, email or SMS codes: `ask_user` (kind `action`) and let the human solve them in the visible window.
   - **Already applied?** As soon as you are signed in (or the site recognizes the email), look for "You have already applied", "Você já se candidatou", an application list in the account, or "your previous application was unsuccessful, you can reapply on <date>". If you see one, stop filling the form: `record_application(job_id, status: "applied", applied_before: true, notes: <what it said>)`, or status `skipped` with the reapply date. When the site asks for the email first, enter it before filling anything else, so this shows up early.
4. **Autofill from resume**: many ATSs offer "Autofill with resume" / "Apply with LinkedIn". Upload the tailored resume PDF there first (`browser_file_upload`), then correct whatever it parsed wrongly. Copy dates, titles and companies exactly from `get_candidate_profile`.
5. **Fields**: same method as Easy Apply. List the fields, `suggest_form_answers`, fill, then `knowledge-grounding` for unknown required fields. A cover letter field means using `cover-letter`. "How did you hear about us?" gets "LinkedIn".
6. Multi-page forms (Workday): go page by page and check for validation errors after each "Next".
7. Before the final "Submit" / "Enviar": `request_permission(kind: "application", job_id, summary)`. Only click if it's allowed.
8. Confirm the thank-you page, then `remember_answers` (all answered questions), then `record_application(job_id, status: "applied", channel: "external", url: <the ATS URL>)`. Close the tab and return to LinkedIn.

If the site is broken, demands something only the candidate can provide (a portfolio password, a take-home test), or the form would take more than 15 minutes, record status `failed` (with the URL and reason) and move on.
