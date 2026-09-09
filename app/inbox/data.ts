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
import { snippet, type ThreadDetail } from "./types"

/**
 * Why a lead ended up here, said in a sentence.
 *
 * Only these three event types ever move a lead to `hot`
 * (worker/handlers/classify.ts, worker/handlers/compose.ts), so whichever
 * fired most recently is the answer.
 *
 * The `reason` those events carry is an engineering note written for whoever
 * is debugging the triage rules, and it shows: regex sources, RFC numbers,
 * header names. It stays in the database and still appears in the Dashboard's
 * activity feed, which is where the README sends you when something looks
 * wrong. It does not belong on the screen where you decide how to answer a
 * real person.
 */
const ESCALATION_REASONS: Record<string, string> = {
  "classify.escalated": "The app was not sure what this reply meant.",
  "compose.escalated": "The app could not write a good email for this one.",
  "inbound.escalate": "This reply needs a person.",
}

function escalationReasonFor(leadId: string): string | null {
  const [latest] = listRecentEvents(1, {
    leadId,
    types: Object.keys(ESCALATION_REASONS),
  })
  return latest ? (ESCALATION_REASONS[latest.type] ?? null) : null
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
