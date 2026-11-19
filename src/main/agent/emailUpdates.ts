import type { ApplicationStatus } from '@shared/types'

/**
 * Pure rules (unit-tested) for the "check-email" task: which emails were already processed for an application,
 * and whether a reply may move an application to a new status.
 */

/** Email ids recorded in an application's notes by update_application_from_email ("Email <id> (…"). */
export function emailIdsInNotes(notes: string): string[] {
  return [...new Set([...notes.matchAll(/\bEmail ([A-Za-z0-9._:@<>+=-]{3,200}) \(/g)].map((m) => m[1]))]
}

export type EmailStatus = Exclude<ApplicationStatus, 'draft'> | 'no-change'

/**
 * offer and rejected are final: a later email does not move them without force (a misread email must not
 * reopen a rejection). Everything else may move both ways (scheduling again after an interview = next round).
 */
export function statusMove(current: ApplicationStatus, next: EmailStatus, force = false): { status: ApplicationStatus; changed: boolean; refused?: string } {
  if (next === 'no-change' || next === current) return { status: current, changed: false }
  if ((current === 'offer' || current === 'rejected') && !force)
    return { status: current, changed: false, refused: `The application is already "${current}". Pass force=true only if this email clearly reverses that.` }
  return { status: next, changed: true }
}

export const STATUS_WORD: Record<ApplicationStatus, string> = {
  draft: 'draft',
  applied: 'applied',
  scheduling: 'awaiting interview scheduling',
  interview: 'interview',
  offer: 'offer',
  rejected: 'rejected'
}
