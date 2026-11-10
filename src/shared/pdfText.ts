/**
 * PDF → plain text with pdf.js, shared by the Electron main process (legacy Node build) and the browser build.
 * Modern pdf.js reconstructs broken cross-reference tables ("bad XRef entry"), which many resume
 * PDFs exported by Word/Canva/LinkedIn have.
 */

interface TextItemLike {
  str?: string
  hasEOL?: boolean
  transform?: number[]
}
interface PdfDocLike {
  numPages: number
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
}
export interface PdfJsLike {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocLike>; destroy(): Promise<void> }
}

export async function pdfToText(pdfjs: PdfJsLike, data: Uint8Array, extra: Record<string, unknown> = {}): Promise<string> {
  // pdf.js takes ownership of the buffer, so pass a copy
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0, ...extra })
  try {
    const doc = await task.promise
    const pages: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent()
      let text = ''
      let lastY: number | null = null
      for (const raw of content.items) {
        const item = raw as TextItemLike
        if (typeof item.str !== 'string') continue
        const y: number = item.transform?.[5] ?? lastY ?? 0
        // Visual line break without an explicit EOL
        if (lastY !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n'
        text += item.str
        if (item.hasEOL) text += '\n'
        lastY = y
      }
      pages.push(text)
    }
    return pages.join('\n')
  } catch (err) {
    const msg = (err as Error).message || String(err)
    if (/password/i.test(msg)) throw new Error('This PDF is password-protected. Remove the password (or export it again) and try again.')
    throw new Error(`Could not read this PDF (${msg}). Try exporting it again as PDF, or import a DOCX instead.`)
  } finally {
    await task.destroy()
  }
}
