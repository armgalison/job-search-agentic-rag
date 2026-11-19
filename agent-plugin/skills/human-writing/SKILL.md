---
name: human-writing
description: Rules for writing text that does not read as AI-generated, based on Wikipedia's "Signs of AI writing" guide. Use before writing or revising ANY text a person will read on the candidate's behalf - LinkedIn connection notes and messages, emails, cover letters, resume summaries and bullets, and free-text answers in application forms.
---

# Writing like a person

Recruiters read hundreds of AI-written messages a week and they spot them fast. Text that "sounds like ChatGPT" gets ignored. This skill lists the signs catalogued in Wikipedia's "Signs of AI writing" guide (https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) and what to do instead.

The root cause behind most of the signs: language models drift toward the most common, broadly agreeable wording. They swap specific facts for generic praise. **The fix is specificity.** Name the system you built, the number you moved, the team size, the stack, the company's actual product. A specific sentence is hard to fake and easy to believe.

## Workflow

1. Write the draft from the candidate's facts (see `knowledge-grounding`). Every claim must trace back to a fact.
2. Run it through `mcp__jobsearch__check_writing`. It flags the mechanical signs below: vocabulary, punctuation, placeholders and stock phrases.
3. Fix every flag by rewriting the sentence. Do not swap in a synonym, because that usually just produces the next cliché. Re-check.
4. Read it once more against the parts the checker cannot see: rule of three, negative parallelisms, puffery, vague connections, and a closing that only restates the opening.

## 1. Content signs

**Inflated significance.** Do not tie ordinary facts to a bigger theme.
Avoid: "stands/serves as", "is a testament/reminder", "a crucial/pivotal/vital/significant/key role/moment", "underscores/highlights its importance", "reflects broader", "symbolizing its ongoing/enduring/lasting", "contributing to the", "setting the stage for", "marking/shaping the", "represents/marks a shift", "key turning point", "evolving landscape", "focal point", "indelible mark", "deeply rooted", "this matters because".
- Bad: "Leading the migration was a pivotal moment that underscored my commitment to reliability."
- Good: "I led the move from EC2 to EKS. 40 services, no downtime, and deploys went from 30 minutes to 6."

**"Shaped the conversation."** Do not claim that something "has shaped conversations/discussions/debate about", "prompted broader reflection on" or "contributed to wider discussions about" anything.

**Name-dropping coverage.** Do not prove importance by listing where something was "featured in" or "profiled in", or by mentioning "independent coverage", "media outlets" or "trade publications". Say what happened.

**"Records identify X as".** Do not write "his profile lists", "is listed in" or "the company's website describes it as". State the fact directly.

**Superficial -ing tails.** Do not end a sentence with a participle phrase that comments on it: "..., highlighting/underscoring/emphasizing ...", "..., ensuring ...", "..., reflecting/symbolizing ...", "..., contributing to ...", "..., fostering/cultivating ...", "..., enhancing ...", "..., showcasing ...". The same goes for "valuable insights" and "aligns/resonates with". If the consequence matters, give it its own sentence with a number in it.

**Vague connection.** Do not write "in connection with", "connected to", "in association with" or "associated with" when the real relationship is known. Write "I was the tech lead for X", not "I was associated with X".

**Weasel attribution.** Do not write "industry reports", "observers have cited", "experts argue", "some critics argue", or "several sources" when there are one or two.

**Formulaic "challenges" closing.** Do not use "Despite its ..., faces several challenges ...", "Despite these challenges", "Future outlook", or end on a vague upbeat line about what lies ahead.

**Puffery and ad copy** (2023-2025 tells): "boasts a", "vibrant", "rich", "profound", "exemplifies", "commitment to", "nestled", "in the heart of", "groundbreaking", "renowned", "diverse array", "world-class", "cutting-edge", "state-of-the-art", "seamless", "dynamic". Ad copy about the company ("your groundbreaking platform") reads as flattery. Name the product and say why it interests the candidate.

## 2. Vocabulary signs (do not use these)

These words became far more frequent after 2022 and they cluster together. One alone means little, but three in a message is a giveaway. Read the list literally: avoid these exact words, not all their synonyms.

- 2023-2024: Additionally (especially at the start of a sentence), boasts (meaning "has"), bolstered, crucial, delve, emphasizing, enduring, garner, intricate/intricacies, interplay, key (as an adjective, as in "key role"), landscape (abstract), meticulous/meticulously, pivotal, underscore (verb), tapestry (abstract), testament, valuable, vibrant.
- 2024-2025: align with, enhance, fostering, highlighting, showcasing, deep dive.
- 2025-2026: emphasizing, enhance, highlighting, showcasing.
- Mid-2026 on: challenge (as a framing device), clearer, dependable, echoed, foster, leverage, matters ("this matters"), multifaceted, practical, prioritize, quietly, steady, universally.
- Grok-style "science" words: causal, empirical, correlate. Use them only when literally accurate.
- Job-search clichés with the same effect: "I am writing to express my interest", "I am excited to apply", "I am passionate about", "hit the ground running", "team player", "results-driven", "proven track record", "synergy", "thrive in fast-paced environments", "I came across your profile", "I hope this message finds you well", "I'd love to pick your brain".

Prefer plain words: "use" instead of "utilize", "help" instead of "facilitate", "start" instead of "commence", "try" instead of "attempt", "wrote" instead of "authored", "moved" instead of "relocated".

## 3. Grammar and structure signs

**Avoid the copula dodge.** Write "is" and "has". Do not write "serves as", "stands as", "functions as", "operates as", "represents a", "marks a", "boasts", "features" or "offers" when "is" or "has" works. "X is the payments team's main service", not "X serves as the cornerstone of payments".

**Negative parallelisms.** Do not write "Not only ... but also ...", "It's not just X, it's Y", "It's not X, it's Y", "no X, no Y, just Z", or "Y rather than X" used to correct a claim nobody made. Say the positive claim directly.

**Rule of three.** Do not stack three adjectives or three short phrases for rhythm ("scalable, reliable, and maintainable"). Use one, or two with a fact. Allow at most one list of three per message, and only when there really are three things.

**Elegant variation.** Do not rename the same thing with synonyms to avoid repetition ("the platform... the solution... the system"). Repeat the noun.

**Restating summaries.** Do not end with "In summary", "In conclusion", "Overall", or with a sentence that repeats the opening. Stop when the content stops.

**Sentence rhythm.** Do not write every sentence at 8-20 words with a comma or period every few words, which is the mid-2026 cadence. Mix in a short sentence. Let one run longer when it carries a real detail.

**Human-typical forms are fine and help:** "there is", "it has", "I was the first", "one of the only", "very", "probably", "tends to", "in order to", "the fact that". Contractions (I'm, I've, didn't) are normal in messages.

## 4. Formatting and punctuation signs

- **No em dashes (—)**, and no spaced en or em dashes used as dashes (" – ", " — "). Use a period, a comma, a colon or parentheses. This is the strongest single tell in short messages. Do not over-correct into a comma every three words either.
- Straight quotes and apostrophes (' and "), not curly ones (‘ ’ “ ”).
- No Markdown in plain-text fields: no **bold**, # headings, `---` dividers, [text](url) links or code blocks. LinkedIn messages and form fields are plain text.
- No emoji. Use no bold labels ("**Experience:** ..."), no title case in sentences, and no bullet lists in a connection note or short message.
- No placeholders left in: [Your Name], [Company], [Hiring Manager], (if available), 2026-XX-XX, example.com, INSERT_..._HERE. If you are missing the information, look it up or call `ask_user`. Never ship a bracket.
- No tracking parameters in links (utm_source=chatgpt.com, utm_source=openai, referrer=grok.com).

## 5. Signs of talking to a chatbot

None of these may appear in anything sent: "I hope this helps", "Of course!", "Certainly!", "Great question", "You're absolutely right", "Would you like...", "Let me know if there's anything else", "Here is a draft...", "Feel free to...", "As an AI...", "as of my last update", "Based on the available information", "While specific details are limited", "It's important to note that", "it does not by itself establish", "should not be confused with". The text is the message itself, with no framing around it.

**Hedging disclaimers.** Do not write "not widely documented", "not publicly available", "based on available information", "[X] should be treated as ... rather than ...". If you don't know something, leave it out or ask.

**Customer-service tone.** No "I apologize for any inconvenience", "I have carefully reviewed", "I am here to collaborate". A job seeker writing to a recruiter is one professional writing to another.

## 6. What good outreach and cover-letter text looks like

- It opens with the reason for writing, in the first sentence: the role, the person's connection to it, and the single most relevant fact about the candidate.
- One or two concrete facts with numbers or named technologies, taken from the knowledge base.
- One sentence about the company or team that shows the posting was actually read. Mention a product, a requirement in the posting, or a problem the role solves.
- A small, specific ask ("Would you be open to a 15-minute call next week?" or "Happy to send more detail on the Kafka work if useful."), not "I'd love to connect and explore synergies".
- Same language as the job posting (Portuguese posting → Portuguese message), in the register a person uses on LinkedIn. Portuguese has its own clichés too: avoid "venho por meio desta", "gostaria de manifestar meu interesse", "sou apaixonado por", "agregar valor", "vestir a camisa", "sinergia", "proatividade" as a self-description.

## 7. These are not signs, so don't "fix" them

Perfect grammar, formal register, plain transitions ("Also", "So", "But"), and short or simple text are all fine. The goal is specific, plain text that a busy person can believe. It is not a performance of casualness: no fake typos, and no forced slang.
