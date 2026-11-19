---
name: cover-letter
description: Write a short, specific cover letter for one job from the candidate's facts, check it against the signs of AI writing, save it as PDF/DOCX and attach or paste it. Use when an application form has a cover letter upload or text field, or the run asks for a cover letter.
---

# Cover letter

Load `human-writing` first. A cover letter that reads as generated hurts more than it helps.

## Gather

- The job: title, company, the two or three must-have requirements, and one specific thing from the posting (a product, a problem the team is solving, the stack).
- The candidate: `search_knowledge` for each of those requirements and pick the two or three strongest facts, with numbers if possible. Use `get_candidate_profile` for the name and contact.

## Write

- Same language as the posting. 180-280 words, or less if the field has a limit. Three or four short paragraphs.
- **Paragraph 1**: the role and the one strongest reason the candidate fits, as a concrete fact. Don't open with "I am writing to apply" or "I am excited".
- **Paragraphs 2-3**: two or three achievements mapped to the posting's requirements. Name the systems, numbers, team size and stack. One sentence on why this company or team in particular, about something real in the posting.
- **Closing**: one sentence offering a conversation. No summary of what you just said.
- Greeting: "Hi <Name>," / "Olá, <Nome>," when you know the recruiter or hiring manager (from `find-contacts`). Otherwise "Hello <Company> team," / "Olá, time <Empresa>,". Never use "To whom it may concern", "Dear Hiring Manager", or a bracket placeholder.

## Check and save

1. `check_writing` on the full text. Fix every flag by rewriting, then check again until it is clean or only has deliberate, justified exceptions.
2. `save_cover_letter(job_id, greeting, paragraphs[], closing, lang)` stores it and returns the PDF/DOCX paths and the plain text.
3. For an upload field, attach the PDF path with `browser_file_upload`. For a text field, paste the plain text (greeting, paragraphs and closing, with the candidate's name at the end).
