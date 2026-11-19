---
name: find-contacts
description: Find the right people to contact about a job on LinkedIn - the job poster ("Meet the hiring team"), recruiters / talent acquisition at the company, and the likely hiring manager - and pick the best one to three. Use after applying (or instead of applying, in outreach runs).
---

# Find who to contact

Fewer, better contacts beat many. One well-chosen person is usually enough; message at most three per job.

## Where to look, in order

1. **The job page**: the "Meet the hiring team" / "Conheça a equipe de contratação" section shows the person who posted the job. This is the best contact: they own the role. Note their name, headline and profile URL (`/in/<slug>/`).
2. **The company's people search**: open `https://www.linkedin.com/company/<company-slug>/people/?keywords=recruiter` (also try `talent`, `tech recruiter`, `recrutador`, `talent acquisition`). Prefer people whose headline mentions tech or engineering recruiting, or the role's area, in the job's country.
3. **The hiring manager**: on the same people page, search for the team's lead title, such as "engineering manager <team keyword>", "head of data", "tech lead <stack>". Choose someone whose headline matches the job's team. Don't pick the CEO of a large company.
4. Global people search as a fallback: `https://www.linkedin.com/search/results/people/?keywords=<company> recruiter`. Check that the current company is really the employer.

## For each candidate contact, collect

- name, headline, profile URL;
- connection degree (1st / 2nd / 3rd) and which actions the profile offers: "Message" (1st-degree, Open Profile or InMail), "Connect" (sometimes under "More"), or "Follow";
- one specific hook if there is one: the job post itself, a recent post about hiring for this team, a shared school or past employer, or a talk they gave.

## Filter

- Skip anyone already in `list_outreach` (same profile URL), and anyone whose profile shows "Pending" / "Pendente". `send-linkedin-message` also checks the conversation history before sending.
- Skip people who left the company: check that the current position is at the employer.
- Prefer, in order: job poster, then a recruiter for this area, then the hiring manager.

Return the chosen contacts with this information and continue with `outreach-message`.
