/**
 * The contract every task handler shares, plus the few queries that more than
 * one handler needs.
 *
 * This is not a handler. It exists because `engine.ts` imports the handlers and
 * the handlers need the outcome type: putting that type in `engine.ts` would
 * make the cycle `engine -> handler -> engine`. Type-only imports are erased,
 * so a cycle of pure types would in fact be harmless, but `AmbiguousSendError`
 * is a runtime value and would not be. One leaf module both sides import is
 * simpler than reasoning about which edges survive type stripping.
 *
 * Node 24 runs this file by stripping types, so: explicit `.ts` on every
 * relative import, no `@/` alias, no enums, no parameter properties, and
 * `import type` (never a bare `import`) for anything type-only.
 */

import { getDb, getSetting, type LeadStatus } from "../../lib/db.ts"
import type { SenderInfo } from "../../lib/prompts.ts"

// ---------------------------------------------------------------------------
// Handler outcomes
// ---------------------------------------------------------------------------

/**
 * What a handler tells the engine to do with the task it was given.
 *
 * A handler returns one of these instead of manipulating the queue itself, so
 * that every `completeTask` / `failTask` / defer in the system happens in one
 * place (`engine.ts`) and the attempt accounting can be reasoned about.
 *
 * `deferred` is the important one, and it is NOT a failure:
 *
 *   `claimTask` increments `attempts` at claim time (spec §7), which is
 *   correct for work that was actually attempted. But a `send` task that is
 *   outside the send window, or waiting on the jitter gap, or held for
 *   approval, has attempted nothing. Recording those as attempts would burn
 *   `MAX_SEND_ATTEMPTS` (2) in two ticks — a task queued at 17:00 would
 *   dead-letter overnight without a single SMTP connection ever being opened.
 *   So `deferred` gives the claim-time increment back (see
 *   `deferTask` in `engine.ts`) and pushes `run_after` out.
 */
export type HandlerOutcome =
  /** The work is finished (or was correctly abandoned). Task -> 'done'. */
  | { status: "done"; reason?: string }
  /**
   * Nothing was attempted; come back later. Task stays 'pending' with a new
   * `run_after` and does NOT consume an attempt.
   */
  | { status: "deferred"; runAfter: number; reason: string }
  /**
   * Terminal, and no retry could help — a missing Settings field, a payload
   * that will never parse, a lead that no longer exists. Task -> 'failed',
   * which stops it being claimed while keeping it visible in the dead-letter
   * queue.
   */
  | { status: "dead_letter"; reason: string }

/** A handler: one task in, one disposition out. `deps` is always injectable. */
export type TaskHandler = (task: TaskLike) => Promise<HandlerOutcome>

/**
 * The subset of `TaskRow` handlers actually read. Narrower than `TaskRow` so a
 * test can build one without inventing lease columns.
 */
export interface TaskLike {
  id: string
  lead_id: string | null
  kind: string
  run_after: number
  attempts: number
  payload_json: string | null
}

export function done(reason?: string): HandlerOutcome {
  return reason === undefined ? { status: "done" } : { status: "done", reason }
}

export function deferred(runAfter: number, reason: string): HandlerOutcome {
  return { status: "deferred", runAfter, reason }
}

export function deadLetter(reason: string): HandlerOutcome {
  return { status: "dead_letter", reason }
}

/**
 * Thrown when a send failed in a way that leaves it genuinely unknown whether
 * the message reached the recipient (spec §5: "timeout after DATA ->
 * ambiguous -> reconcile only").
 *
 * The engine treats this as terminal for any task kind whose
 * `RetryPolicy.requiresReconciliation` is set, rather than applying the
 * backoff. A retry here is not a retry — it is a coin flip on whether a
 * stranger gets the same cold email twice. The `messages` row stays
 * `sending`, and startup reconciliation against Sent Mail is what settles it.
 */
export class AmbiguousSendError extends Error {
  readonly outreachId: string | null

  constructor(message: string, outreachId: string | null = null) {
    super(message)
    this.name = "AmbiguousSendError"
    this.outreachId = outreachId
  }
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * Parses `tasks.payload_json`. Returns null rather than throwing: a malformed
 * payload is a dead-letter, not a retry, and the caller says so with a message
 * a human can act on.
 */
export function parsePayload(payloadJson: string | null): unknown {
  if (payloadJson === null || payloadJson.trim().length === 0) return null
  try {
    return JSON.parse(payloadJson) as unknown
  } catch {
    return null
  }
}

/** The three sequence steps, as data. Spec: first email, day 4, day 9. */
export const SEQUENCE_STEPS = [1, 4, 9] as const
export type SequenceStep = (typeof SEQUENCE_STEPS)[number]

export function isSequenceStep(value: unknown): value is SequenceStep {
  return (
    typeof value === "number" &&
    (SEQUENCE_STEPS as readonly number[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// Sender identity (the /settings "About you" section)
// ---------------------------------------------------------------------------

/** Exactly the keys `app/settings/data.ts` writes under the `about` setting. */
interface AboutSettingsShape {
  name?: string
  company?: string
  phone?: string
  address?: string
  offerTerms?: string
}

export const ABOUT_SETTINGS_KEY = "about"

/** Which Settings field is missing, in the words the Settings page uses. */
export interface SenderInfoResult {
  sender?: SenderInfo
  missing: string[]
}

/**
 * Builds the `SenderInfo` every outbound prompt and fixed template needs.
 *
 * `address` is not optional and not cosmetic: CAN-SPAM requires a physical
 * postal address on every commercial email, so a blank one is a legal defect,
 * not a formatting one. Missing fields are returned by name so the handler can
 * dead-letter with "fill in Settings -> About you -> Your name" instead of a
 * stack trace.
 */
export function loadSenderInfo(
  read: <T>(key: string) => T | undefined = getSetting
): SenderInfoResult {
  let about: AboutSettingsShape = {}
  try {
    about = read<AboutSettingsShape>(ABOUT_SETTINGS_KEY) ?? {}
  } catch {
    about = {}
  }

  const name = about.name?.trim() ?? ""
  const company = about.company?.trim() ?? ""
  const address = about.address?.trim() ?? ""
  const phone = about.phone?.trim() ?? ""
  const offerTerms = about.offerTerms?.trim() ?? ""

  const missing: string[] = []
  if (name.length === 0) missing.push("About you -> Your name")
  if (company.length === 0) missing.push("About you -> Company")
  if (address.length === 0) {
    missing.push("About you -> Business address (required by CAN-SPAM)")
  }
  if (missing.length > 0) return { missing }

  return {
    sender: {
      name,
      company,
      address,
      ...(phone.length > 0 ? { phone } : {}),
      ...(offerTerms.length > 0 ? { offerTerms } : {}),
    },
    missing: [],
  }
}

// ---------------------------------------------------------------------------
// Lead state
// ---------------------------------------------------------------------------

/**
 * Statuses from which no further outreach may be composed or sent, ever.
 *
 * Spec §9.3 asked for terminal states precisely so that "should this lead get
 * another email" is answerable from one column instead of inferred from which
 * tasks happen to exist.
 */
export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = [
  "suppressed",
  "dead",
  "won",
  "unqualified",
]

export function isTerminalLeadStatus(status: LeadStatus): boolean {
  return TERMINAL_LEAD_STATUSES.includes(status)
}

/**
 * Inbound `messages.status` values that do NOT count as the lead having
 * replied.
 *
 * `handleInboundMessage` stamps every inbound row `triaged:<action>`, and
 * `classify.ts` re-stamps it `classified:<intent>` once a model has looked at
 * it. Machine mail and a parsed out-of-office are recorded like any other
 * message, but spec §2/§3 are explicit that neither counts as engagement — an
 * autoresponder must not silently cancel the day-4 follow-up.
 */
export const NON_ENGAGEMENT_MESSAGE_STATUSES: readonly string[] = [
  "triaged:ignore",
  "triaged:bounce:hard",
  "triaged:bounce:soft",
  "classified:out_of_office",
]

/**
 * Whether this lead has ever genuinely replied.
 *
 * Any real reply pauses the sequence immediately (brief §compose 1), so this
 * gates steps 4 and 9. Deliberately a query over `messages` rather than a read
 * of `leads.status`: a reply that was escalated moves the lead to `hot`, a
 * human may then move it anywhere at all, and the follow-up must stay
 * cancelled regardless of where the status ended up.
 */
export function hasEverReplied(leadId: string): boolean {
  const placeholders = NON_ENGAGEMENT_MESSAGE_STATUSES.map(() => "?").join(", ")
  const row = getDb()
    .prepare(
      `SELECT 1 AS hit FROM messages
       WHERE lead_id = ? AND direction = 'in' AND status NOT IN (${placeholders})
       LIMIT 1`
    )
    .get(leadId, ...NON_ENGAGEMENT_MESSAGE_STATUSES) as
    | { hit: number }
    | undefined
  return row !== undefined
}

// ---------------------------------------------------------------------------
// Threading anchors
// ---------------------------------------------------------------------------

export interface PriorOutbound {
  subject: string | null
  /**
   * The Message-ID as reconciliation left it — read back from `[Gmail]/Sent
   * Mail`, which per spec §5 is the only authoritative one. It is null until
   * reconciliation runs, and a follow-up sent before then simply has no
   * `In-Reply-To` rather than a fabricated one.
   */
  messageId: string | null
  refs: string | null
  sequenceStep: number | null
}

/**
 * The first email we sent this lead: the subject follow-ups inherit and the
 * thread they attach to.
 *
 * Dry-run rows are included on purpose. During a dry run there is no real send
 * to thread onto, and excluding them would make every dry-run follow-up invent
 * a fresh subject line — which would hide exactly the continuity bug this
 * query exists to prevent.
 */
export function readEarliestOutbound(leadId: string): PriorOutbound | undefined {
  return getDb()
    .prepare(
      `SELECT subject, message_id AS messageId, refs, sequence_step AS sequenceStep
       FROM messages
       WHERE lead_id = ? AND direction = 'out' AND sequence_step IS NOT NULL
       ORDER BY sequence_step ASC, created_at ASC
       LIMIT 1`
    )
    .get(leadId) as PriorOutbound | undefined
}

/** Milliseconds, for schedules that read as prose at the call site. */
export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
