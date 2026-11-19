---
name: tailor-documents
description: Produce a resume tailored to one job from the candidate's knowledge base (prepare_resume) and get attachable PDF/DOCX files. Use before applying to any job, and again after the candidate answers gap questions so the new facts make it into the resume.
---

# Tailor the resume

`prepare_resume(job_id, lang?, regenerate?)` does the heavy lifting inside the app. It retrieves the facts most relevant to each job requirement, writes a resume using only those facts and the profile, saves it as the application's resume, and exports `resume.pdf` and `resume.docx`. It returns their absolute paths and a short outline of the resume.

## Steps

1. Make sure `analyze_job` ran for the job, so the requirements and keywords are known.
2. If you asked the candidate about gaps earlier in this job, pass `regenerate: true`. Otherwise an existing resume for the job is reused.
3. Language: pass `lang: "pt"` when the posting is in Portuguese and `"en"` otherwise. `analyze_job` returns the posting's language.
4. Read the returned outline. Check that:
   - the summary mentions the job's main requirement, if the candidate has it;
   - every experience is present with its real dates;
   - the skills section includes the job's keywords that the candidate actually has.
   If something important is missing but exists in the knowledge base, regenerate once.
5. Upload the PDF path, or the DOCX if the site only accepts Word files. Name nothing yourself: the files already have a proper name (Candidate-Name-Company.pdf).

Never edit the resume text to add claims. If the candidate lacks a requirement, the resume simply doesn't claim it.
