import type { CoverLetterDoc, Lang, ResumeDoc } from '@shared/types'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const labels = {
  pt: { summary: 'Resumo', skills: 'Competências', experience: 'Experiência', education: 'Formação', projects: 'Projetos', certs: 'Certificações', langs: 'Idiomas' },
  en: { summary: 'Summary', skills: 'Skills', experience: 'Experience', education: 'Education', projects: 'Projects', certs: 'Certifications', langs: 'Languages' }
}

const BASE_CSS = `
  @page { size: A4; margin: 16mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2328; font-size: 10.5pt; line-height: 1.4; margin: 0; background: #fff; }
  h1 { font-size: 20pt; margin: 0; letter-spacing: -0.3px; }
  .headline { color: #3b5bdb; font-size: 11.5pt; margin-top: 2px; }
  .contact { color: #57606a; font-size: 9pt; margin-top: 4px; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 1px; color: #3b5bdb; border-bottom: 1px solid #d0d7de; padding-bottom: 2px; margin: 14px 0 6px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .role { font-weight: 600; }
  .muted { color: #57606a; font-size: 9.5pt; }
  ul { margin: 3px 0 8px; padding-left: 16px; }
  li { margin: 1px 0; }
  .skills { margin: 0; }
  p { margin: 0 0 10px; }
`

export function resumeHtml(r: ResumeDoc, lang: Lang = r.lang ?? 'en'): string {
  const L = labels[lang]
  const section = (title: string, body: string, show: boolean) => (show ? `<h2>${title}</h2>${body}` : '')
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(r.name)}</title><style>${BASE_CSS}</style></head><body>
  <h1>${esc(r.name)}</h1>
  <div class="headline">${esc(r.headline)}</div>
  <div class="contact">${r.contact.map(esc).join(' · ')}</div>
  ${section(L.summary, `<p>${esc(r.summary)}</p>`, !!r.summary)}
  ${section(L.skills, `<p class="skills">${r.skills.map(esc).join(' · ')}</p>`, r.skills.length > 0)}
  ${section(
    L.experience,
    r.experiences
      .map(
        (e) => `<div class="row"><span class="role">${esc(e.title)} — ${esc(e.company)}</span><span class="muted">${esc(e.period)}</span></div>
      ${e.location ? `<div class="muted">${esc(e.location)}</div>` : ''}
      <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
      )
      .join(''),
    r.experiences.length > 0
  )}
  ${section(
    L.projects,
    `<ul>${r.projects.map((p) => `<li><b>${esc(p.name)}</b> — ${esc(p.description)}</li>`).join('')}</ul>`,
    r.projects.length > 0
  )}
  ${section(
    L.education,
    r.education
      .map((e) => `<div class="row"><span><b>${esc(e.degree)}</b> — ${esc(e.institution)}</span><span class="muted">${esc(e.period)}</span></div>`)
      .join(''),
    r.education.length > 0
  )}
  ${section(L.certs, `<ul>${r.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`, r.certifications.length > 0)}
  ${section(L.langs, `<p>${r.languages.map(esc).join(' · ')}</p>`, r.languages.length > 0)}
</body></html>`
}

export function coverLetterHtml(c: CoverLetterDoc, header: { name: string; contact: string[]; company: string; date: string }, lang: Lang = c.lang ?? 'en'): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Cover letter</title><style>${BASE_CSS}
  body { font-size: 11pt; line-height: 1.55; } .date { margin: 18px 0; color: #57606a; }</style></head><body>
  <h1>${esc(header.name)}</h1>
  <div class="contact">${header.contact.map(esc).join(' · ')}</div>
  <div class="date">${esc(header.date)}${header.company ? ` — ${esc(header.company)}` : ''}</div>
  <p>${esc(c.greeting)}</p>
  ${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
  <p>${esc(c.closing)}</p>
  <p><b>${esc(c.signature)}</b></p>
</body></html>`
}
