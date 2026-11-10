import { readFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getChat } from '../ai'
import { profileRepo } from '../db/repos'
import { indexPending, syncItemFacts } from '../rag'
import type { ItemDataMap, ItemKind, Profile } from '@shared/types'
import { pdfToText, type PdfJsLike } from '@shared/pdfText'
import { ImportedProfileSchema } from './schemas'

/**
 * Loads pdf.js's Node ("legacy") build, which recovers broken xref tables.
 * It is an ES module, so it is loaded by absolute file URL from outside the asar archive
 * (packaged builds unpack pdfjs-dist — see electron-builder.yml asarUnpack) instead of relying on
 * ESM resolution inside app.asar.
 */
let pdfjsPromise: Promise<PdfJsLike> | null = null
function loadPdfJs(): Promise<PdfJsLike> {
  pdfjsPromise ??= (async () => {
    const pkgDir = dirname(require.resolve('pdfjs-dist/package.json')).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    const url = pathToFileURL(join(pkgDir, 'legacy', 'build', 'pdf.mjs')).href
    return (await import(/* @vite-ignore */ url)) as PdfJsLike
  })()
  pdfjsPromise.catch(() => (pdfjsPromise = null))
  return pdfjsPromise
}

export async function extractText(file: string): Promise<string> {
  const ext = extname(file).toLowerCase()
  const buf = await readFile(file)
  if (ext === '.pdf') {
    return pdfToText(await loadPdfJs(), new Uint8Array(buf), { useSystemFonts: false, disableFontFace: true })
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ buffer: buf })).value
  }
  return buf.toString('utf8')
}

/** Reads an existing resume, extracts its data with AI and fills the profile (merging with what already exists). */
export async function importResume(file: string): Promise<{ imported: number }> {
  const text = (await extractText(file)).trim()
  if (!text) throw new Error('Could not extract text from the file.')

  const data = await getChat('import-resume').json({
    name: 'imported_profile',
    schema: ImportedProfileSchema,
    system:
      'Extract the resume data faithfully, without inventing anything. Missing fields are empty strings. ' +
      'Keep the text in the language it is written in. Use "MM/YYYY" dates when possible; a current job has an empty end.',
    prompt: text.slice(0, 60000)
  })

  // Merge the profile: only fill empty fields
  const current = profileRepo.get()
  const merged: Profile = { ...current }
  for (const [k, v] of Object.entries(data.profile) as [keyof Profile, string][]) {
    if (!merged[k] && v) merged[k] = v
  }
  profileRepo.save(merged)

  let imported = 0
  const add = <K extends ItemKind>(kind: K, list: ItemDataMap[K][], keyOf: (d: ItemDataMap[K]) => string) => {
    const existing = new Set(profileRepo.listItems(kind).map((i) => keyOf(i.data as ItemDataMap[K]).toLowerCase()))
    for (const d of list) {
      const key = keyOf(d).toLowerCase()
      if (!key.trim() || existing.has(key)) continue
      syncItemFacts(profileRepo.saveItem(kind, d))
      existing.add(key)
      imported++
    }
  }
  add('experience', data.experiences, (d) => `${d.company}|${d.title}|${d.start}`)
  add('education', data.education, (d) => `${d.institution}|${d.degree}`)
  add('skill', data.skills, (d) => d.name)
  add('project', data.projects, (d) => d.name)
  add('certification', data.certifications, (d) => d.name)
  add('language', data.languages, (d) => d.name)

  await indexPending()
  return { imported }
}
