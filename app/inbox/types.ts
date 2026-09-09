/**
 * Pure types + pure helpers for the Inbox page. Zero value-import of
 * `@/lib/db` — see `app/settings/types.ts` for why.
 */

export interface ThreadMessage {
  id: string
  direction: "in" | "out"
  subject: string | null
  body: string | null
  sentAt: number | null
  createdAt: number | null
}

export interface ThreadDetail {
  leadId: string
  name: string | null
  type: string | null
  email: string | null
  phone: string | null
  address: string | null
  fact: string | null
  latestInboundSnippet: string
  messageCount: number
  /** What escalated it, in plain language — null when no escalation event
   * could be found (e.g. a hand-edited status). */
  escalationReason: string | null
  messages: ThreadMessage[]
}

/** The three actions this screen can take on a thread. Kept as a
 * discriminating string rather than a raw `LeadStatus` so the client never
 * needs the full status vocabulary — see `actions.ts` for the mapping. */
export type ThreadOutcome = "won" | "dead" | "nurture"

export function formatDateTime(epochMs: number | null): string {
  if (epochMs === null) return ""
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function snippet(text: string | null, maxLen = 140): string {
  if (!text) return ""
  const collapsed = text.replace(/\s+/g, " ").trim()
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen)}…` : collapsed
}
