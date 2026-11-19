import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { applicationsRepo, jobsRepo, profileRepo } from '../db/repos'
import type { CoverLetterDoc, Lang, ResumeDoc } from '@shared/types'
import { coverLetterDocx, htmlToPdf, resumeDocx } from './render'
import { coverLetterHtml, resumeHtml } from './templates'

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

function letterHeader(jobId: number, lang: Lang) {
  const p = profileRepo.get()
  const job = jobsRepo.get(jobId)
  return {
    name: p.fullName,
    contact: [p.email, p.phone, p.location, p.linkedin].filter(Boolean),
    company: job?.company ?? '',
    date: new Date().toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  }
}

export const previewResumeHtml = (r: ResumeDoc): string => resumeHtml(r)
export const previewCoverLetterHtml = (c: CoverLetterDoc, jobId: number): string => coverLetterHtml(c, letterHeader(jobId, c.lang ?? 'en'))

export function resumeFileName(jobId: number, ext: string): string {
  const p = profileRepo.get()
  const job = jobsRepo.get(jobId)
  return `${slug(p.fullName || 'Resume')}-${slug(job?.company || 'job')}.${ext}`
}

/** PDF of the resume generated for the job (also used to attach in Easy Apply). */
export async function resumePdf(jobId: number): Promise<Buffer | null> {
  const a = applicationsRepo.getByJob(jobId)
  if (!a?.resume) return null
  return htmlToPdf(resumeHtml(a.resume))
}

async function saveAs(win: BrowserWindow | null, defaultPath: string, data: Buffer): Promise<string | null> {
  const ext = defaultPath.split('.').pop()!
  const opts = { defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, data)
  return res.filePath
}

export async function exportResume(win: BrowserWindow | null, appId: number, format: 'pdf' | 'docx'): Promise<string | null> {
  const a = applicationsRepo.get(appId)
  if (!a?.resume) throw new Error('Generate the resume before exporting.')
  const data = format === 'pdf' ? await htmlToPdf(resumeHtml(a.resume)) : await resumeDocx(a.resume)
  return saveAs(win, resumeFileName(a.jobId, format), data)
}

export async function exportCoverLetter(win: BrowserWindow | null, appId: number, format: 'pdf' | 'docx'): Promise<string | null> {
  const a = applicationsRepo.get(appId)
  if (!a?.coverLetter) throw new Error('Generate the cover letter before exporting.')
  const header = letterHeader(a.jobId, a.coverLetter.lang ?? 'en')
  const data = format === 'pdf' ? await htmlToPdf(coverLetterHtml(a.coverLetter, header)) : await coverLetterDocx(a.coverLetter, header)
  return saveAs(win, resumeFileName(a.jobId, format).replace(/\.(pdf|docx)$/, `-cover-letter.${format}`), data)
}

/**
 * Writes the job's resume or cover letter as PDF + DOCX into `dir` (so the agent's browser can upload them)
 * and returns the absolute paths. File names follow resumeFileName (Candidate-Name-Company.pdf).
 */
export async function writeApplicationFiles(jobId: number, dir: string, which: 'resume' | 'cover-letter'): Promise<{ pdf: string; docx: string }> {
  const a = applicationsRepo.getByJob(jobId)
  await mkdir(dir, { recursive: true })
  if (which === 'resume') {
    if (!a?.resume) throw new Error('No resume for this job yet.')
    const pdf = join(dir, resumeFileName(jobId, 'pdf'))
    const docx = join(dir, resumeFileName(jobId, 'docx'))
    await writeFile(pdf, await htmlToPdf(resumeHtml(a.resume)))
    await writeFile(docx, await resumeDocx(a.resume))
    return { pdf, docx }
  }
  if (!a?.coverLetter) throw new Error('No cover letter for this job yet.')
  const header = letterHeader(jobId, a.coverLetter.lang ?? 'en')
  const base = resumeFileName(jobId, 'pdf').replace(/\.pdf$/, '-cover-letter')
  const pdf = join(dir, `${base}.pdf`)
  const docx = join(dir, `${base}.docx`)
  await writeFile(pdf, await htmlToPdf(coverLetterHtml(a.coverLetter, header)))
  await writeFile(docx, await coverLetterDocx(a.coverLetter, header))
  return { pdf, docx }
}

/** Plain-text version of a cover letter, for pasting into a form's text area. */
export function coverLetterText(c: CoverLetterDoc): string {
  return [c.greeting, ...c.paragraphs, c.closing, c.signature].filter((s) => s?.trim()).join('\n\n')
}
