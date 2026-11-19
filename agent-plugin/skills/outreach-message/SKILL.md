---
name: outreach-message
description: Write a short LinkedIn connection note or direct message to a recruiter or hiring manager about a specific job, grounded in the candidate's facts and free of AI-writing tells. Use after find-contacts, before send-linkedin-message.
---

# Outreach message

Load `human-writing` first. Then pick the format from what the profile allows.

## Formats and limits

- **Connection note** (the "Connect" → "Add a note" path): at most **200 characters**. LinkedIn allows 300 for Premium, but stay under 200 so it works on any account. It needs a reason to connect and one fact. No greeting padding.
- **Direct message / InMail** (1st-degree, Open Profile, or Premium InMail): 350-700 characters. InMail also has a subject line of at most 8 words.
- **Follow-up** (an earlier note was accepted and there was no reply after 5 or more days): two sentences, once. Never chase twice.

## Content

1. Use their first name and mention the specific role. Link the job only in direct messages; notes have no room.
2. One concrete fact about the candidate that matches the role's main requirement, with a number or a named system/stack from `search_knowledge`.
3. Say whether the candidate already applied ("I applied through Easy Apply today").
4. A small ask: a quick call, whether the role is still open, or who the right person is.
5. Same language as the job posting. Natural LinkedIn register: contractions are fine, flattery is not.

## Examples (shape only; always use the candidate's real facts)

Connection note (EN, 168 chars):
> Hi Ana, I applied today for the Senior Backend role. I built the Go payments API at Acme that handles 3k req/s, which looks close to what your team does. Open to a quick chat?

Connection note (PT, 176 chars):
> Oi Ana, me candidatei hoje à vaga de Backend Sênior. Na Acme construí a API de pagamentos em Go (3 mil req/s), bem parecida com o que o time faz. Topa uma conversa rápida?

Direct message (EN):
> Hi Marcos, I saw you're hiring a Data Engineer for the risk team and applied this morning. For the last two years I've run the Airflow + dbt pipelines behind Acme's credit scoring (about 2 TB a day, on-call included). The posting mentions moving batch jobs to streaming, and I did that for our fraud features with Kafka and Flink. Would a 15-minute call next week make sense? Job link: <url>

## Check

Run `check_writing`. Also check the length against the format's limit, the name's spelling, and the company's name. Remove any em dash, emoji, "I hope this finds you well", "I came across your profile", or "I'd love to connect". Then load `send-linkedin-message`.
