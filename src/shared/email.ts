import type { EmailSource } from './types'

/**
 * Finds the latest email the check-email run recorded in an application's notes, and the address that opens it
 * in the browser. Note lines look like:
 *   Email <id> (<date>, <from>) link <url>: "<subject>" — <summary> Next: <step> [→ <status>]
 * (" link <url>" is optional: webmail runs give it; for the Gmail connector the id is enough.)
 */

export interface RecordedEmail {
  id: string
  subject: string
  link: string | null
}

const LINE = /\bEmail ([A-Za-z0-9._:@<>+=-]{3,200}) \([^)]*\)(?: link (https?:\/\/\S+))?: "([^"]*)"/

export function latestEmail(notes: string): RecordedEmail | null {
  const lines = notes.split('\n').filter((l) => LINE.test(l))
  const m = lines.length ? lines[lines.length - 1].match(LINE) : null
  return m ? { id: m[1], link: m[2] ?? null, subject: m[3] } : null
}

/** Gmail API message / thread ids are 16-hex-digit numbers; Gmail on the web opens them at #all/<id>. */
const isGmailId = (id: string) => /^[0-9a-f]{12,20}$/i.test(id)

export function emailUrl(notes: string, source: EmailSource, webmailUrl: string): string | null {
  const e = latestEmail(notes)
  if (!e) return null
  if (e.link) return e.link
  if (source === 'gmail-connector' || /mail\.google\.com/i.test(webmailUrl)) {
    if (isGmailId(e.id)) return `https://mail.google.com/mail/u/0/#all/${e.id}`
    return e.subject ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`subject:"${e.subject}"`)}` : 'https://mail.google.com/mail/u/0/'
  }
  if (/outlook\.(live|office)\.com/i.test(webmailUrl) && e.subject) return `https://outlook.live.com/mail/0/search?q=${encodeURIComponent(e.subject)}`
  return /^https?:\/\//i.test(webmailUrl) ? webmailUrl : null
}
