---
name: check-email
description: Reads the candidate's inbox (Gmail connector or webmail in the browser) for replies from companies and recruiters about job applications, matches each one to an application on the board and moves it - awaiting interview scheduling, interview, offer, rejected. Read-only on the mailbox. Load it in "check email" runs.
---

# Check email replies and update the board

The candidate applies to many jobs, both through the app and by hand. Companies answer by email. Your job is to read those answers and keep the app's applications board accurate. **You only read the mailbox.** Never send, reply, draft, forward, label, archive, move or delete an email. Never click links inside emails (scheduling links, "confirm", "unsubscribe"). Copy them into next_step instead, so the candidate can act.

## 1. Know what is on the board

Call `list_tracked_applications` once. Keep the companies, titles, the people contacted and emails_seen (ids already processed) at hand.

## 2. Find the candidate emails

The task gives the time window (N days).

**Gmail connector.** Load the read-only Gmail tools with ToolSearch (`mcp__claude_ai_Gmail__search_threads`, `mcp__claude_ai_Gmail__get_thread`, `mcp__claude_ai_Gmail__get_message`). Run a few searches, each limited to the window (`newer_than:14d` for 14 days), and merge the results:

- Replies to applications: `newer_than:14d (application OR candidatura OR "your application" OR "sua candidatura" OR interview OR entrevista OR "next steps" OR "próximos passos" OR processo seletivo)`
- Scheduling: `newer_than:14d (schedule OR agendar OR availability OR disponibilidade OR calendly OR "goodtime" OR "calendar invite" OR convite)`
- Results: `newer_than:14d (unfortunately OR "not moving forward" OR "infelizmente" OR "não seguiremos" OR offer OR proposta)`
- ATS senders: `newer_than:14d from:(greenhouse.io OR lever.co OR ashbyhq.com OR workable.com OR gupy.io OR smartrecruiters.com OR myworkday.com OR linkedin.com)`
- One search per company on the board that is still `applied`, `scheduling` or `interview`: `newer_than:14d "<company>"`

Read the search results first (sender, subject, snippet). Open the full message with get_thread or get_message only when the snippet doesn't say enough to classify it.

**Webmail in the browser.** Open the webmail address from the task. If it shows a login page, `ask_user` with kind `action` ("Please sign in to your email in the agent's browser window, then click Done."). Use the mailbox's search box with the same kinds of terms (company names, "application", "candidatura", "interview", "entrevista"), and stay inside the window. Open a message only to read it. Use sender + date + subject as the email id, and pass the address of the open message (from the address bar) as email_url so the candidate can open it from the board.

Ignore job alerts and newsletters ("new jobs for you", "vagas recomendadas"), LinkedIn notifications that are not a message from a person, marketing, and emails the candidate sent.

## 3. Classify each reply

| What the email says | status |
|---|---|
| Wants to talk or interview, sends a scheduling link, asks for availability, "let's find a time", a take-home with a call to set up, but **no confirmed date yet** | `scheduling` |
| A confirmed date/time (calendar invite accepted, "see you Tuesday at 2pm"), or the interview already happened and they talk about the next round without a new date | `interview` |
| Offer, proposal, offer letter, compensation discussion for an offer | `offer` |
| Not moving forward, position filled or closed, "infelizmente", "decidimos seguir com outros candidatos" | `rejected` |
| Automatic "we received your application" for a job **not** on the board | `applied` |
| Relevant but changes nothing ("still reviewing", "received your application" for a job already on the board) | `no-change` |

A new round after an interview ("we'd like to schedule the technical interview") is `scheduling` again. When unsure between `scheduling` and `interview`, choose `scheduling`: the candidate still has something to confirm.

## 4. Match and record

- Match by company (sender domain, signature, the ATS's company name) and then by role title. Recruiters from a staffing agency write on behalf of a client: match on the role and the client name if they give it.
- Skip emails whose id is already in emails_seen.
- Call `update_application_from_email` once per email that matters, with job_id, the email id (for Gmail, the message id the tool returned), from, subject, date, the status, a one or two sentence `summary`, and next_step with what the candidate must do, including any link, deadline, date and time zone.
- If the company has several applications on the board and the email doesn't say which role, pick the one with the latest activity, and say in the summary that the role was not named.
- An application the candidate made outside the app (no match on the board): call it with `company` and `title` (as written in the email) and no job_id. If the tool answers with jobs_at_company, decide whether it is one of those and call again.
- Only one thread about the same application: use its latest message to decide the status, and record it once.

## 5. Report

End with a short plain-text report: how many emails you read, each application you moved (company — title: from → to, and why in a few words), the next steps the candidate must take (scheduling links, deadlines), and replies you could not match. No Markdown tables, no emoji.
