"use server"

/**
 * Server actions backing the Leads page: searching Overpass, importing
 * results, and lazily loading one lead's full detail (fact, thread,
 * events) when its row is opened. Every mutation ends with
 * `revalidatePath`, same pattern as `app/settings/actions.ts`.
 */

import { revalidatePath } from "next/cache"
import { enqueue, getLeadById, listMessagesForLead, listRecentEvents } from "@/lib/db"
import { findLocations, importCandidates } from "@/lib/leads"
import { TARGET_TYPES, type LeadType, type OsmCandidate } from "@/lib/osm"
import { humanizeEvent } from "../humanize-event"
import type { FindLocationsFormResult, LeadDetail } from "./types"

function isLeadType(value: string): value is LeadType {
  return (TARGET_TYPES as readonly string[]).includes(value)
}

export interface FindLocationsInput {
  place: string
  radiusMiles: number
  types: string[]
}

export async function findLocationsAction(
  input: FindLocationsInput
): Promise<FindLocationsFormResult> {
  const place = input.place.trim()
  if (!place) {
    throw new Error("Enter a city, state, or ZIP code to search.")
  }
  const types = input.types.filter(isLeadType)
  if (types.length === 0) {
    throw new Error("Pick at least one business type.")
  }
  const radiusMiles = Number.isFinite(input.radiusMiles)
    ? Math.min(100, Math.max(1, input.radiusMiles))
    : 15

  const result = await findLocations({ place, radiusMiles, types })

  return {
    totalFound: result.totalFound,
    newCount: result.newCount,
    clamped: result.clamped,
    ...(result.resolvedPlace !== undefined ? { resolvedPlace: result.resolvedPlace } : {}),
    candidates: result.candidates,
  }
}

export interface ImportLeadsResult {
  inserted: number
  skipped: number
}

/**
 * Imports candidates and enqueues one `enrich` task per newly-inserted lead.
 * Without the enqueue, an import writes `status='new'` rows that nothing
 * ever picks up — `lib/leads.ts` deliberately enqueues nothing itself (the
 * worker owns the task queue), so the caller that turns candidates into
 * leads is the one place this has to happen. Only the actually-new
 * `leadIds` are enqueued, never a skipped duplicate.
 */
export async function importLeadsAction(
  candidates: OsmCandidate[]
): Promise<ImportLeadsResult> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Nothing to import — run a search first.")
  }
  const result = importCandidates(candidates)
  for (const leadId of result.leadIds) {
    enqueue("enrich", { leadId })
  }
  revalidatePath("/leads")
  revalidatePath("/")
  return { inserted: result.inserted, skipped: result.skipped }
}

export async function getLeadDetailAction(id: string): Promise<LeadDetail | null> {
  const lead = getLeadById(id)
  if (!lead) return null

  const messages = listMessagesForLead(id).map((m) => ({
    id: m.id,
    direction: m.direction,
    subject: m.subject,
    body: m.body,
    status: m.status,
    sentAt: m.sent_at,
    createdAt: m.created_at,
    dryRun: m.dry_run === 1,
  }))

  const events = listRecentEvents(50, { leadId: id }).map((e) => {
    const humanized = humanizeEvent(e.type, e.detail_json)
    return {
      id: e.id,
      text: humanized.text,
      ...(humanized.extra !== undefined ? { extra: humanized.extra } : {}),
      createdAt: e.created_at,
    }
  })

  return {
    id: lead.id,
    name: lead.name,
    type: lead.type,
    status: lead.status,
    score: lead.score,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    address: lead.address,
    fact: lead.personalization_fact,
    factCategory: lead.fact_category,
    messages,
    events,
  }
}
