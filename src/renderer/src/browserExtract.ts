import { pdfToText, type PdfJsLike } from '@shared/pdfText'

/** Resume text extraction in the browser (dev:web mode). PDF via pdf.js, DOCX via mammoth. */

export async function extractTextInBrowser(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return extractPdf(await file.arrayBuffer())
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser.js')
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
  }
  return file.text()
}

async function extractPdf(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfToText(pdfjs as unknown as PdfJsLike, new Uint8Array(data))
}

/** Opens the browser file picker; resolves null if the user cancels. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
