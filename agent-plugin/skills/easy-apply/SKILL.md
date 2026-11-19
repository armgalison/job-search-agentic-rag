---
name: easy-apply
description: Complete a LinkedIn Easy Apply application end to end in the browser - contact info, resume upload, every question step, review and submit - using grounded answers from Job Search RAG. Use when a job page shows an "Easy Apply" / "Candidatura simplificada" button.
---

# LinkedIn Easy Apply

## Before you start

- `prepare_resume` has returned the resume PDF path (see `tailor-documents`).
- `get_candidate_profile` is loaded (contact info and saved answers).

## Walk the modal

1. Click "Easy Apply" / "Candidatura simplificada" and wait for the dialog. Take a snapshot.
2. On every step:
   1. List the fields: label, type (text, textarea, number, select, radio, checkbox, file), options, and whether they are required (marked with *).
   2. Leave fields that already hold a correct value alone (LinkedIn prefills email, phone and the last resume).
   3. For the rest, call `suggest_form_answers(job_id, fields)` with the exact labels and options. Use `origin: memory` and `origin: ai` answers. For `origin: unknown` on a **required** field, follow `knowledge-grounding` (derive, or `ask_user`). Leave optional unknowns blank.
   4. Fill with `browser_fill_form` / `browser_type` / `browser_select_option` / `browser_click` (radio and checkbox). Numeric fields take digits only. LinkedIn rejects "5 years" where it wants "5".
   5. **Resume step**: if the tailored resume isn't the selected one, use "Upload resume" with `browser_file_upload` and the PDF path, then make sure the uploaded file is selected (its radio is checked). Don't delete the candidate's other resumes.
   6. **Cover letter**: if there's a cover letter upload or text area, use `cover-letter`.
   7. Free-text questions ("Why do you want to work here?"): write two to four sentences from the facts, following `human-writing`, and run `check_writing`.
   8. Click "Next" / "Avançar" or "Review" / "Revisar". If an inline error appears ("Please enter a valid answer"), read it, fix the field and try again. Never click "Next" more than twice on the same step without changing something.
3. After the step's fields are filled, call `remember_answers` with every question you answered (label, final value, type), so the next application reuses them.
4. **Review page**: scroll through and check that the contact info and resume are right. Untick "Follow <company>" only if the run says so (default: leave it as is).
5. Call `request_permission(kind: "application", job_id, summary)`. Only if `allowed` is true, click "Submit application" / "Enviar candidatura".
6. Confirm success ("Your application was sent" / "Candidatura enviada"). Close the dialog, then call `record_application(job_id, status: "applied", channel: "easy-apply")`.

## When it goes wrong

- If the dialog asks for something you can't answer and the candidate didn't know either, close it with "Discard" / "Descartar" and record status `failed` with the reason.
- If a required field has no usable answer after you asked, record status `failed` with the question text so the candidate can answer it later.
- If LinkedIn says "You've reached the Easy Apply limit for today", record `failed`, then stop applying for this run (outreach can continue).
