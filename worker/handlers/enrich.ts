/**
 * `enrich` — turn a bare OSM row into a lead we could actually email.
 *
 * All of the work is `enrichLead` in `lib/leads.ts` (scrape, find an address,
 * ground a personalization fact, score). This handler decides only what
 * happens next, which is: compose an email, or stop.
 */

import { enqueue, getLeadById, logEvent, type LeadRow } from "../../lib/db.ts"
import type { FactCategory } from "../../lib/untrusted.ts"
import {
  deadLetter,
  done,
  isTerminalLeadStatus,
  type HandlerOutcome,
  type TaskLike,
} from "./common.ts"

// ---------------------------------------------------------------------------
// The pinned surface of lib/leads.ts
// ---------------------------------------------------------------------------

/**
 * `lib/leads.ts` is being built in parallel with this file and may not exist
 * on disk yet, so this is a local mirror of the signature the brief pins.
 *
 * MIRROR, NOT A GUESS — the shape below is copied from the brief verbatim. The
 * one field it softens is `reason`, typed here as `string` rather than the
 * `UnqualifiedReason` union, because that union's members were never pinned
 * and this handler only ever logs the value.
 *
 * When `lib/leads.ts` lands, replace this block with
 * `import type { EnrichOutcome } from "../../lib/leads.ts"`. The compiler will
 * then check the contract instead of this comment.
 */
export type EnrichOutcome =
  | {
      status: "ready"
      email: string
      fact: string
      factCategory: FactCategory
      score: number
    }
  | {
      status: "held"
      email: string
      fact: string
      factCategory: FactCategory
      score: number
    }
  | { status: "unqualified"; reason: string }

export type EnrichLeadFn = (leadId: string) => Promise<EnrichOutcome>

/**
 * Deliberately typed `string` rather than left as a literal, so TypeScript
 * does not try to resolve a module that is still being written. The import is
 * also lazy: at module load time `lib/leads.ts` may be absent, and a missing
 * file must not stop `worker/main.ts` from booting and running the other three
 * handlers.
 */
const LEADS_MODULE: string = "../../lib/leads.ts"

async function importEnrichLead(): Promise<EnrichLeadFn> {
  let mod: unknown
  try {
    mod = (await import(LEADS_MODULE)) as unknown
  } catch (err) {
    throw new Error(
      `enrich: could not load ${LEADS_MODULE} ` +
        `(${err instanceof Error ? err.message : String(err)})`
    )
  }
  const fn = (mod as { enrichLead?: unknown }).enrichLead
  if (typeof fn !== "function") {
    throw new Error(`enrich: ${LEADS_MODULE} does not export enrichLead`)
  }
  return fn as EnrichLeadFn
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface EnrichDeps {
  enrichLead?: EnrichLeadFn
  getLeadById?: (id: string) => LeadRow | undefined
  enqueue?: typeof enqueue
  logEvent?: typeof logEvent
  now?: () => number
}

/**
 * `enrichLead` writes the lead row itself and returns an expected negative as
 * `unqualified` rather than throwing; it throws ONLY for transient failures.
 * So anything thrown here propagates to the engine, which applies the
 * `enrich` retry policy (4 attempts, up to an hour apart) and dead-letters
 * after that.
 */
export async function handleEnrich(
  task: TaskLike,
  deps: EnrichDeps = {}
): Promise<HandlerOutcome> {
  const leadId = task.lead_id
  if (leadId === null) {
    return deadLetter("enrich task has no lead_id")
  }

  const readLead = deps.getLeadById ?? getLeadById
  const emit = deps.logEvent ?? logEvent
  const now = (deps.now ?? Date.now)()

  const lead = readLead(leadId)
  if (!lead) {
    return deadLetter(`lead ${leadId} no longer exists`)
  }
  // Checked before doing any work, not after: enrichment fetches the lead's
  // website, and a lead that was suppressed while this task sat in the queue
  // should not have its site fetched on our behalf at all.
  if (isTerminalLeadStatus(lead.status)) {
    return done(`lead is ${lead.status}; nothing to enrich`)
  }

  const enrichLead = deps.enrichLead ?? (await importEnrichLead())
  const outcome = await enrichLead(leadId)

  const add = deps.enqueue ?? enqueue

  switch (outcome.status) {
    case "ready":
    case "held": {
      // Both compose. A `held` lead is composed and then held at the SEND
      // step, which is what makes spec §9.2's approval queue free: the pending
      // `send` task's payload IS the draft the UI shows for review, so there
      // is no separate drafts table and no second code path that could send
      // something a human never saw.
      const taskId = add("compose", {
        leadId,
        runAfter: now,
        payload: { step: 1 },
      })
      emit("task.enriched", {
        leadId,
        detail: {
          status: outcome.status,
          score: outcome.score,
          factCategory: outcome.factCategory,
          composeTaskId: taskId,
        },
      })
      return done(`${outcome.status}; compose step 1 enqueued`)
    }

    case "unqualified":
      // An expected negative. `enrichLead` has already written
      // `status='unqualified'`, so there is nothing to schedule and nothing to
      // retry — this lead is simply not emailable.
      emit("task.unqualified", { leadId, detail: { reason: outcome.reason } })
      return done(`unqualified: ${outcome.reason}`)
  }
}
