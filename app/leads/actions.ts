"use server"

/**
 * Server actions backing the Leads page: searching Overpass, importing
 * results, and lazily loading one lead's full detail (fact, thread,
 * events) when its row is opened. Every mutation ends with
 * `revalidatePath`, same pattern as `app/settings/actions.ts`.
 */

import { revalidatePath } from "next/cache"
import {
  countLeads,
  enqueue,
  getLeadById,
  getSearchResult,
  listLeads,
  listMessagesForLead,
  listRecentEvents,
  saveSearchResult,
  updateLead,
} from "@/lib/db"
import { isCountry } from "@/lib/geo"
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
  countries: string[]
}

export async function findLocationsAction(
  input: FindLocationsInput
): Promise<FindLocationsFormResult> {
  const place = input.place.trim()
  if (!place) {
    throw new Error("Enter a town, a ZIP code, or a postal code to search.")
  }
  const types = input.types.filter(isLeadType)
  if (types.length === 0) {
    throw new Error("Pick at least one business type.")
  }
  const radiusMiles = Number.isFinite(input.radiusMiles)
    ? Math.min(100, Math.max(1, input.radiusMiles))
    : 15
  // Re-checked here rather than trusted: this is a server action, so its
  // argument is whatever the browser sent, not whatever the dialog rendered.
  const countries = input.countries.filter(isCountry)
  if (countries.length === 0) {
    throw new Error("Pick at least one country to search.")
  }

  const result = await findLocations({
    place,
    radiusMiles,
    types,
    countries,
  })

  // The candidates stay here. Handing the browser a `searchId` instead of the
  // list itself is what keeps `importLeadsAction` under the 1 MB server action
  // body limit — see migration 5 in `lib/db.ts`.
  return {
    distinctFound: result.distinctFound,
    newCount: result.newCount,
    clamped: result.clamped,
    ...(result.resolvedPlace !== undefined
      ? { resolvedPlace: result.resolvedPlace }
      : {}),
    searchId: saveSearchResult(JSON.stringify(result.candidates)),
  }
}

export interface ImportLeadsResult {
  inserted: number
  skipped: number
}

/**
 * Imports the candidates a search parked under `searchId`, and enqueues one
 * `enrich` task per newly-inserted lead. Without the enqueue, an import
 * writes `status='new'` rows that nothing ever picks up — `lib/leads.ts`
 * deliberately enqueues nothing itself (the worker owns the task queue), so
 * the caller that turns candidates into leads is the one place this has to
 * happen. Only the actually-new `leadIds` are enqueued, never a skipped
 * duplicate.
 *
 * Takes an id rather than the candidates themselves because the candidates
 * are the one thing here that has no size bound: a 20-mile search around
 * Toronto is 7,435 of them and 1.62 MB, and a server action body may be 1 MB.
 * Sending the id keeps this request the same handful of bytes at every search
 * size, and the browser was never shown the list anyway.
 */
export async function importLeadsAction(
  searchId: string
): Promise<ImportLeadsResult> {
  const stored =
    typeof searchId === "string" ? getSearchResult(searchId) : undefined
  if (stored === undefined) {
    // Only reachable once a few more searches have pushed this one out of the
    // table, which needs a second tab — but "nothing happened" is not an
    // acceptable answer to a button press, so it gets a real sentence.
    throw new Error(
      "That search is no longer held. Run the search again, then add."
    )
  }
  const candidates = JSON.parse(stored) as OsmCandidate[]
  if (candidates.length === 0) {
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

export async function getLeadDetailAction(
  id: string
): Promise<LeadDetail | null> {
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

/**
 * Releases a held draft so the engine may send it.
 *
 * The first `APPROVAL_QUEUE_SIZE` leads are enriched and composed but parked
 * at `held` (spec 9.2) so the template gets read before hundreds of businesses
 * see it. The send handler defers a held lead's task an hour at a time,
 * forever, and refunds the attempt so it never dead-letters — it waits for
 * exactly this call. Until it existed, the first twenty leads could never
 * send and nothing said why.
 *
 * No new task is enqueued: the send task already exists and is waiting.
 */
export async function approveLeadAction(id: string): Promise<void> {
  const lead = getLeadById(id)
  if (!lead) throw new Error("That lead no longer exists.")
  if (lead.status !== "held") {
    // Not an error worth throwing over — two clicks on the same row, or an
    // approve-all that already covered it.
    return
  }
  updateLead(id, { status: "ready" })
  revalidatePath("/leads")
  revalidatePath("/")
}

/** Approves every held draft at once, for when the batch reads well. */
export async function approveAllHeldAction(): Promise<{ approved: number }> {
  const held = listLeads({ status: ["held"], limit: 500 })
  for (const lead of held) {
    updateLead(lead.id, { status: "ready" })
  }
  revalidatePath("/leads")
  revalidatePath("/")
  return { approved: held.length }
}

/** How many drafts are parked waiting for a human. Drives the review banner. */
export async function countHeldAction(): Promise<number> {
  return countLeads({ status: ["held"] })
}
