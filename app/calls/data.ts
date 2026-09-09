/**
 * Server-only data shaping for the Calls page.
 */

import { listCallList, listMessagesForLead } from "@/lib/db"
import { shortLocation } from "@/lib/format"
import { TYPE_LABELS, type LeadType } from "@/lib/osm"
import type { CallListItem } from "./types"

/** `leads.research_json` holds whatever each stage has merged into it —
 * `{osm: OsmResearch}` from import, plus enrichment's own keys, plus (once
 * generated) `callScript`. This reads only the one key this page cares
 * about and never assumes anything else about the shape. */
interface ResearchJson {
  callScript?: string
  [key: string]: unknown
}

export function parseResearchJson(json: string | null): ResearchJson {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ResearchJson)
      : {}
  } catch {
    return {}
  }
}

export function getCallListItems(now: number = Date.now()): CallListItem[] {
  const entries = listCallList(now)

  return entries.map(({ lead, hoursSinceContact }) => {
    const lastOutbound = listMessagesForLead(lead.id)
      .filter((m) => m.direction === "out" && m.status === "sent")
      .at(-1)
    const research = parseResearchJson(lead.research_json)

    return {
      id: lead.id,
      name: lead.name,
      type: typeLabel(lead.type),
      // listCallList's own WHERE clause guarantees a non-empty phone.
      phone: lead.phone ?? "",
      location: shortLocation(lead.address),
      hoursSinceContact,
      fact: lead.personalization_fact,
      lastEmailSubject: lastOutbound?.subject ?? null,
      lastEmailBody: lastOutbound?.body ?? null,
      callScript:
        typeof research.callScript === "string" ? research.callScript : null,
    }
  })
}

/** The stored `type` is an internal id like `car_repair`. Nobody outside this
 * codebase should have to read one, so it becomes a real name here — same
 * mapping the Leads table uses. */
function typeLabel(type: string | null): string | null {
  if (!type) return null
  return TYPE_LABELS[type as LeadType] ?? type.replace(/_/g, " ")
}
