---
name: knowledge-grounding
description: How to answer anything about the candidate (experience, skills, years, salary, availability, authorization, form questions) strictly from the Job Search RAG knowledge base, and exactly when to ask the candidate instead. Use before filling any application field, writing resume or cover-letter content, or making any claim about the candidate.
---

# Knowledge grounding

The candidate's knowledge base has their profile (experience, education, skills, projects, certifications, languages, preferences) plus atomic "facts" collected from their resume, earlier answers, and past application forms.

## Lookup order

1. `get_candidate_profile` once per run. It returns name, contact, headline, summary, every job with dates, education, skills, languages, preferences, and the saved application answers (question → answer). Keep it in mind for the rest of the run.
2. `search_knowledge` with several short queries per question. Rephrase in both English and Portuguese ("Kubernetes production", "Kubernetes em produção", "container orchestration"). It returns facts with ids and relevance scores.
3. For application forms, use `suggest_form_answers` with the fields. It combines saved answers with grounded AI suggestions and marks anything unknown as `origin: "unknown"`.
4. Only if all of that has nothing: `ask_user`.

## Deriving answers (allowed)

- **Years of experience with X**: add up the periods of the jobs where X appears in the facts. Round down to a whole number. When a field asks for a number, answer with the number only.
- **Yes/No about a skill**: "Yes" only with evidence in the facts. If there is no evidence, it is a gap: ask, do not answer "No" on your own. The candidate may have the experience and just not have recorded it.
- **Location, contact, LinkedIn URL, languages and levels**: copy from the profile.
- **Education**: copy degree, institution and dates exactly.
- **Rewording**: you may rephrase and condense facts to fit a field. You may not add numbers, technologies, titles or dates that are not there.

## When to ask (and when not to)

Ask (kind `knowledge`) when an answer needs a fact that is missing, for example:
- salary expectation, notice period or start date, willingness to relocate, work authorization or visa sponsorship, or a security clearance, unless saved answers or preferences already cover it;
- a must-have requirement with no evidence;
- a free-text question about a specific experience ("Describe a time you scaled a system...") when the facts don't have a usable story.

Do not ask about:
- things you can derive (the years calculation above);
- optional fields you can leave blank (leave them blank);
- EEO/diversity questions (gender, race, veteran, disability). Pick "Decline to answer" / "Prefer not to say" if offered, otherwise use a saved answer, and only ask if the field is required and has no decline option;
- wording, tone, or which contact to message. Decide those yourself.

## How to ask well

- One fact per question, self-contained, with the job context: "For the Senior Backend role at Nubank, the form asks for your expected monthly salary in BRL. What figure should I use?"
- Offer `options` when the answer is a choice (["Yes", "No"], or the exact select options from the form).
- Set `save_as_fact: true` for durable facts about the candidate (experience, skills, preferences). Set it to false for one-off answers (a job-specific "why us").
- The answer comes back as text. If the candidate says they don't have the experience, the answer is "No" (or the gap stays open). Never round it up to a yes.
