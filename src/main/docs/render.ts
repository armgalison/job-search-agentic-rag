import { BrowserWindow } from 'electron'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
  type ISectionOptions
} from 'docx'
import type { CoverLetterDoc, Lang, ResumeDoc } from '@shared/types'

/** Renders HTML to PDF with Electron's own Chromium (hidden window, JS disabled). */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, offscreen: true }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
    return Buffer.from(pdf)
  } finally {
    win.destroy()
  }
}

const ACCENT = '3B5BDB'
const heading = (text: string) =>
  new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: ACCENT, size: 20 })]
  })

const rightTab = [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }]

export async function resumeDocx(r: ResumeDoc, lang: Lang = r.lang ?? 'en'): Promise<Buffer> {
  const L =
    lang === 'pt'
      ? { summary: 'Resumo', skills: 'Competências', exp: 'Experiência', edu: 'Formação', proj: 'Projetos', certs: 'Certificações', langs: 'Idiomas' }
      : { summary: 'Summary', skills: 'Skills', exp: 'Experience', edu: 'Education', proj: 'Projects', certs: 'Certifications', langs: 'Languages' }

  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: r.name, bold: true, size: 40 })] }),
    new Paragraph({ children: [new TextRun({ text: r.headline, color: ACCENT, size: 23 })] }),
    new Paragraph({ children: [new TextRun({ text: r.contact.join(' · '), color: '57606A', size: 18 })] })
  ]
  if (r.summary) children.push(heading(L.summary), new Paragraph({ children: [new TextRun(r.summary)] }))
  if (r.skills.length) children.push(heading(L.skills), new Paragraph({ children: [new TextRun(r.skills.join(' · '))] }))
  if (r.experiences.length) {
    children.push(heading(L.exp))
    for (const e of r.experiences) {
      children.push(
        new Paragraph({
          tabStops: rightTab,
          spacing: { before: 120 },
          children: [
            new TextRun({ text: `${e.title} — ${e.company}`, bold: true }),
            new TextRun({ text: `\t${e.period}`, color: '57606A', size: 19 })
          ]
        })
      )
      if (e.location) children.push(new Paragraph({ children: [new TextRun({ text: e.location, color: '57606A', size: 19 })] }))
      for (const b of e.bullets) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] }))
    }
  }
  if (r.projects.length) {
    children.push(heading(L.proj))
    for (const p of r.projects)
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: p.name, bold: true }), new TextRun(` — ${p.description}`)] }))
  }
  if (r.education.length) {
    children.push(heading(L.edu))
    for (const e of r.education)
      children.push(
        new Paragraph({
          tabStops: rightTab,
          children: [
            new TextRun({ text: e.degree, bold: true }),
            new TextRun(` — ${e.institution}`),
            new TextRun({ text: `\t${e.period}`, color: '57606A', size: 19 })
          ]
        })
      )
  }
  if (r.certifications.length) {
    children.push(heading(L.certs))
    for (const c of r.certifications) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(c)] }))
  }
  if (r.languages.length) children.push(heading(L.langs), new Paragraph({ children: [new TextRun(r.languages.join(' · '))] }))

  return pack([{ children }])
}

export async function coverLetterDocx(c: CoverLetterDoc, header: { name: string; contact: string[]; company: string; date: string }): Promise<Buffer> {
  const p = (text: string, opts: { bold?: boolean } = {}) =>
    new Paragraph({ spacing: { after: 200 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text, bold: opts.bold })] })
  const children = [
    new Paragraph({ children: [new TextRun({ text: header.name, bold: true, size: 36 })] }),
    new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: header.contact.join(' · '), color: '57606A', size: 18 })] }),
    new Paragraph({
      spacing: { after: 300 },
      children: [new TextRun({ text: `${header.date}${header.company ? ` — ${header.company}` : ''}`, color: '57606A' })]
    }),
    p(c.greeting),
    ...c.paragraphs.map((x) => p(x)),
    p(c.closing),
    p(c.signature, { bold: true })
  ]
  return pack([{ children }])
}

function pack(sections: ISectionOptions[]): Promise<Buffer> {
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: sections.map((s) => ({ properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, ...s }))
  })
  return Packer.toBuffer(doc)
}
