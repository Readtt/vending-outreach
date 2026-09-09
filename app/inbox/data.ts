/**
 * Server-only data shaping for the Inbox page. Fetches full thread detail
 * for every escalated lead up front — `listInboxThreads` is deliberately
 * narrow (only `status = 'hot'`), so this is a small list, and prefetching
 * everything lets the page itself be a plain client component with local
 * selection state instead of a second round trip per click.
 */

import {
  listInboxThreads,
  listMessagesForLead,
  listRecentEvents,
} from "@/lib/db"
import { humanizeEvent } from "../humanize-event"
import { snippet, type ThreadDetail } from "./types"

// Only these types ever move a lead to `hot` (worker/handlers/classify.ts,
// worker/handlers/compose.ts) — whichever fired most recently for a given
// lead is "what escalated it."
const ESCALATION_EVENT_TYPES = [
  "classify.escalated",
  "compose.escalated",
  "inbound.escalate",
]

function escalationReasonFor(leadId: string): string | null {
  const [latest] = listRecentEvents(1, {
    leadId,
    types: ESCALATION_EVENT_TYPES,
  })
  if (!latest) return null
  const humanized = humanizeEvent(latest.type, latest.detail_json)
  return humanized.extra ?? humanized.text
}

export function getInboxThreads(limit = 100): ThreadDetail[] {
  const threads = listInboxThreads(limit)

  return threads.map(({ lead, latestInbound, messageCount }) => {
    const messages = listMessagesForLead(lead.id).map((m) => ({
      id: m.id,
      direction: m.direction,
      subject: m.subject,
      body: m.body,
      sentAt: m.sent_at,
      createdAt: m.created_at,
    }))

    return {
      leadId: lead.id,
      name: lead.name,
      type: lead.type,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      fact: lead.personalization_fact,
      latestInboundSnippet: snippet(latestInbound?.body ?? null),
      messageCount,
      escalationReason: escalationReasonFor(lead.id),
      messages,
    }
  })
}
