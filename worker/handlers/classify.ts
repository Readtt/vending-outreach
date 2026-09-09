/**
 * `classify` — decide what to do about one inbound reply.
 *
 * THE SAFETY PROPERTY OF THIS FILE, from BUILD-SPEC §3:
 *
 *   **Zero LLM-authored bytes ever reach a stranger automatically.**
 *
 * The model returns a LABEL. A hardcoded switch (`actionForIntent`) maps that
 * label to one of four actions, and none of them can emit model output. The
 * only text this app sends without a human in the loop is
 * `FIXED_REPLY_TEMPLATES` — fixed, human-written strings in `lib/prompts.ts`.
 *
 * That is what makes the design safe *under arbitrary misclassification*
 * rather than safe *if the classification is correct*. If you find yourself
 * passing anything derived from `generateGuarded` into `sendMessage`, stop:
 * you have misread the spec, and the fix is not a better prompt.
 *
 * Corollary, also from §3: nothing here gates on a self-reported confidence
 * score. `replyClassificationSchema` does not even have that field. It was
 * removed because it is uncalibrated and is trivially set by injected text —
 * an authorization boundary the attacker controls is not a boundary.
 */

import {
  cancelPendingTasksForLead,
  getDb,
  getLeadById,
  logEvent,
  updateLead,
  type LeadRow,
  type MessageRow,
} from "../../lib/db.ts"
import { generateGuardedObject, hasRoleModel } from "./ai-bridge.ts"
import {
  REPLY_CLASSIFICATION_SYSTEM_PROMPT,
  REPLY_INTENTS,
  renderFixedReply,
  replyClassificationSchema,
  type ReplyClassification,
} from "../../lib/prompts.ts"
import {
  fence,
  isShortNegative,
  sanitize,
  stripQuotedReply,
  verifyEvidenceSpan,
} from "../../lib/untrusted.ts"
import {
  sendMessage,
  suppressAddress,
  type SendDeps,
  type SendMessageInput,
  type SendOutcome,
} from "../../lib/mail-send.ts"
import {
  DAY_MS,
  deadLetter,
  deferred,
  done,
  loadSenderInfo,
  parsePayload,
  type HandlerOutcome,
  type TaskLike,
} from "./common.ts"

// ---------------------------------------------------------------------------
// THE ACTION SET (spec §3)
// ---------------------------------------------------------------------------

export type ClassifyAction =
  /** Suppress permanently, stop the sequence, send NOTHING. */
  | "silence"
  /** Hand it to the human queue. Sends nothing. */
  | "escalate"
  /** No reply. Parse a return date and defer the follow-up. Not a reply. */
  | "no_reply_defer"
  /** Send `FIXED_REPLY_TEMPLATES` verbatim. The only automatic bytes. */
  | "fixed_reply"

/**
 * The §3 table, as a hardcoded switch. The model never decides this.
 *
 * `default` is `escalate`, so a new intent added to `REPLY_INTENTS` later, a
 * typo, or a model that returns something off-schema all fail into "a human
 * looks at it" rather than into an action. That default is load-bearing: it is
 * why this function is safe for inputs that do not exist yet.
 *
 * Why silence rather than a courtesy reply for the two negatives: "No problem,
 * thanks for letting me know!" is an EXTRA unsolicited message to someone who
 * just said go away. It generates complaints and converts nothing.
 */
export function actionForIntent(intent: string): ClassifyAction {
  switch (intent) {
    case "not_interested":
      return "silence"
    case "already_have_vending":
      return "silence"
    case "wrong_person":
      // Not an auto-reply. "Who should I talk to instead?" is a fresh
      // solicitation to someone who just said they are not the buyer — the
      // highest-complaint-rate message in cold outreach.
      return "escalate"
    case "out_of_office":
      return "no_reply_defer"
    case "send_more_info":
      return "fixed_reply"
    default:
      return "escalate"
  }
}

/** Every action other than `fixed_reply` provably sends nothing. */
export function actionSendsBytes(action: ClassifyAction): boolean {
  return action === "fixed_reply"
}

// ---------------------------------------------------------------------------
// Message row bookkeeping
// ---------------------------------------------------------------------------

/**
 * `messages.status` for a classified inbound row: `classified:<intent>`, which
 * continues the `triaged:<action>` convention `handleInboundMessage` uses.
 *
 * `classified:out_of_office` is the one value with behaviour attached — see
 * `NON_ENGAGEMENT_MESSAGE_STATUSES` in `common.ts`. Spec §3 says an
 * out-of-office does not count as a reply, and this stamp is how the compose
 * handler knows not to treat it as one.
 */
export function classifiedStatus(intent: string): string {
  return `classified:${intent}`
}

const CLASSIFIED_PREFIX = /^classified:(.+)$/

function readInboundRow(rowId: string): MessageRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM messages WHERE id = ? AND direction = 'in'`)
    .get(rowId) as MessageRow | undefined
}

function stampMessage(rowId: string, status: string): void {
  getDb()
    .prepare(`UPDATE messages SET status = ? WHERE id = ?`)
    .run(status, rowId)
}

/**
 * How many off-sequence emails we have already sent this lead.
 *
 * Auto-replies are the only sends with `sequence_step IS NULL`, so this is an
 * exact count of them. Spec: at most ONE auto-reply per thread, ever —
 * escalate the second. Two automatic replies to one person is the shape a mail
 * loop takes before it becomes obvious.
 */
export function countAutoReplies(leadId: string): number {
  const row = getDb()
    .prepare(
      `SELECT count(*) AS n FROM messages
       WHERE lead_id = ? AND direction = 'out' AND sequence_step IS NULL`
    )
    .get(leadId) as { n: number | bigint }
  return typeof row.n === "bigint" ? Number(row.n) : row.n
}

/**
 * Pushes this lead's pending `compose` tasks out to `runAfter`.
 *
 * Only ever moves them later (`run_after < ?`), so a message that arrives
 * twice, or a return date earlier than what is already scheduled, cannot pull
 * a follow-up forward.
 */
export function deferPendingCompose(leadId: string, runAfter: number): number {
  const result = getDb()
    .prepare(
      `UPDATE tasks SET run_after = ?
       WHERE lead_id = ? AND kind = 'compose' AND status = 'pending'
         AND run_after < ?`
    )
    .run(runAfter, leadId, runAfter)
  return typeof result.changes === "bigint"
    ? Number(result.changes)
    : result.changes
}

// ---------------------------------------------------------------------------
// Out-of-office return dates
// ---------------------------------------------------------------------------

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

const MONTH_NAMES = Object.keys(MONTHS).join("|")

const DATE_PATTERNS: readonly RegExp[] = [
  // 2026-09-15
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
  // September 15 / Sept 15, 2026
  new RegExp(
    String.raw`\b(${MONTH_NAMES})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`,
    "i"
  ),
  // 15 September 2026
  new RegExp(
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_NAMES})\.?(?:,?\s*(\d{4}))?\b`,
    "i"
  ),
  // 9/15 or 9/15/2026 or 9/15/26 (US order — the corpus is US-only by §0.5)
  /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
]

/** The furthest out an out-of-office may push a follow-up (spec §3). */
export const MAX_OOO_DEFER_MS = 30 * DAY_MS

/** When no date parses, wait this long and try again. */
export const DEFAULT_OOO_DEFER_MS = 7 * DAY_MS

function utcMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day)
}

/**
 * Best-effort return date from an out-of-office body.
 *
 * Returns null rather than guessing when nothing matches, because the caller's
 * fallback (a flat week) is better than a wrong date in either direction: too
 * early and the follow-up lands in an empty inbox, too late and the lead goes
 * cold. Prose like "back next Monday" is deliberately not parsed — resolving
 * it needs the sender's timezone and week convention, which we do not have.
 */
export function parseReturnDate(text: string, now: number): number | null {
  const currentYear = new Date(now).getUTCFullYear()

  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue

    let year: number | undefined
    let month: number | undefined
    let day: number | undefined

    if (pattern.source.startsWith("\\b(\\d{4})")) {
      year = Number(match[1])
      month = Number(match[2])
      day = Number(match[3])
    } else if (/^\\b\(\\d\{1,2\}\)\\\//.test(pattern.source)) {
      month = Number(match[1])
      day = Number(match[2])
      if (match[3]) {
        const raw = Number(match[3])
        year = raw < 100 ? 2000 + raw : raw
      }
    } else if (/^\\b\(\\d\{1,2\}\)/.test(pattern.source)) {
      day = Number(match[1])
      month = MONTHS[match[2].toLowerCase()]
      if (match[3]) year = Number(match[3])
    } else {
      month = MONTHS[match[1].toLowerCase()]
      day = Number(match[2])
      if (match[3]) year = Number(match[3])
    }

    if (
      month === undefined ||
      day === undefined ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      continue
    }

    if (year === undefined) {
      // No year given: assume the next occurrence. An OOO saying "back Jan 5"
      // sent in December means next January, not eleven months ago.
      year = currentYear
      if (utcMidnight(year, month, day) < now) year = currentYear + 1
    }

    const parsed = utcMidnight(year, month, day)
    if (!Number.isFinite(parsed)) continue
    return parsed
  }

  return null
}

/** The instant to resume outreach, floored at +1 day and capped at +30 days. */
export function resolveOooDeferUntil(text: string, now: number): number {
  const parsed = parseReturnDate(text, now)
  const target = parsed ?? now + DEFAULT_OOO_DEFER_MS
  return Math.min(Math.max(target, now + DAY_MS), now + MAX_OOO_DEFER_MS)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ClassifyDeps {
  now?: () => number
  readInboundRow?: (rowId: string) => MessageRow | undefined
  getLeadById?: (id: string) => LeadRow | undefined
  stampMessage?: (rowId: string, status: string) => void
  countAutoReplies?: (leadId: string) => number
  deferPendingCompose?: (leadId: string, runAfter: number) => number
  cancelPendingTasksForLead?: typeof cancelPendingTasksForLead
  suppressAddress?: typeof suppressAddress
  updateLead?: typeof updateLead
  logEvent?: typeof logEvent
  hasTriageModel?: () => boolean | Promise<boolean>
  classifyReply?: (params: {
    role: "triage"
    prompt: string
    system: string
    leadId?: string
  }) => Promise<{ object: ReplyClassification }>
  renderFixedReply?: typeof renderFixedReply
  loadSenderInfo?: () => {
    sender?: { name: string; company: string; address: string }
    missing: string[]
  }
  sendMessage?: (
    input: SendMessageInput,
    deps?: SendDeps
  ) => Promise<SendOutcome>
  sendDeps?: SendDeps
}

export async function handleClassify(
  task: TaskLike,
  deps: ClassifyDeps = {}
): Promise<HandlerOutcome> {
  const payload = parsePayload(task.payload_json) as {
    messageRowId?: unknown
    mailboxId?: unknown
  } | null

  // Read the payload; do not assume it. `handleInboundMessage` writes
  // `{messageRowId, mailboxId}` — the mailbox is the one that RECEIVED the
  // reply, which is also the only correct one to answer from.
  const messageRowId =
    typeof payload?.messageRowId === "string" ? payload.messageRowId : null
  if (messageRowId === null) {
    return deadLetter(
      `classify payload must carry {"messageRowId": string}, got ${
        task.payload_json ?? "null"
      }`
    )
  }
  const payloadMailboxId =
    typeof payload?.mailboxId === "string" ? payload.mailboxId : null

  const now = (deps.now ?? Date.now)()
  const readRow = deps.readInboundRow ?? readInboundRow
  const readLead = deps.getLeadById ?? getLeadById
  const stamp = deps.stampMessage ?? stampMessage
  const emit = deps.logEvent ?? logEvent
  const patchLead = deps.updateLead ?? updateLead

  const row = readRow(messageRowId)
  if (!row) {
    return deadLetter(`inbound message row ${messageRowId} does not exist`)
  }
  const lead = readLead(row.lead_id)
  if (!lead) return deadLetter(`lead ${row.lead_id} no longer exists`)

  // Already suppressed or dead: the inbound path or a human got here first,
  // and there is nothing a classification could change.
  if (lead.status === "suppressed" || lead.status === "dead") {
    return done(`lead is ${lead.status}; no action`)
  }

  const escalate = (reason: string, detail: unknown): HandlerOutcome => {
    // Escalation is the safe default everywhere in this file: it sends
    // nothing, and `/inbox` reads leads with status `replied` or `hot`.
    patchLead(lead.id, { status: "hot" })
    emit("classify.escalated", { leadId: lead.id, detail: { reason, detail } })
    return done(`escalated: ${reason}`)
  }

  // --- 1. Sanitize the reply ----------------------------------------------
  // Order matters and is spec §4: strip the quote chain FIRST, then truncate.
  // Reversed, "do not contact me again" gets pushed past the 2000-char cap by
  // quoted history and the model sees only the friendly original.
  const dequoted = stripQuotedReply(row.body ?? "")
  const sanitized = sanitize(dequoted.text)

  if (sanitized.text.trim().length === 0) {
    return escalate("reply body is empty after de-quoting and sanitizing", {
      messageRowId,
    })
  }
  if (sanitized.truncated) {
    // Spec §4: truncation is an escalation signal in its own right. Hiding
    // part of a reply from the classifier is exactly how an opt-out buried
    // under 4KB of history gets missed.
    stamp(messageRowId, "classified:truncated")
    return escalate(
      "reply was truncated, so the classifier saw less than arrived",
      {
        messageRowId,
      }
    )
  }

  // --- 2. Classify --------------------------------------------------------
  // A resume path: if this task already ran, chose `send_more_info`, and was
  // then deferred because the send window was closed, the label is recorded on
  // the row. Re-using it avoids paying for a second model call on every
  // deferral. Any other recorded label means the action already ran.
  const recorded = CLASSIFIED_PREFIX.exec(row.status)
  let classification: ReplyClassification | null = null

  if (recorded && recorded[1] === "send_more_info") {
    classification = {
      intent: "send_more_info",
      ready_to_talk: false,
      evidence_span: "",
      reason: "resumed from a previously recorded classification",
    }
  } else {
    const hasModel = deps.hasTriageModel ?? (() => hasRoleModel("triage"))
    if (!(await hasModel())) {
      return deadLetter(
        "no model is assigned to the Reply triage role. Set one in Settings -> AI Providers."
      )
    }

    const fenced = fence("an inbound email reply", sanitized.text)
    const classify =
      deps.classifyReply ??
      ((params) =>
        generateGuardedObject({
          role: params.role,
          prompt: params.prompt,
          system: params.system,
          ...(params.leadId ? { leadId: params.leadId } : {}),
          schema: replyClassificationSchema,
          schemaName: "ReplyClassification",
        }))

    const result = await classify({
      role: "triage",
      system: REPLY_CLASSIFICATION_SYSTEM_PROMPT,
      prompt: fenced.block,
      leadId: lead.id,
    })
    classification = result.object

    // --- 3. Evidence grounding (spec §4) ---------------------------------
    // The model must quote the text it based the call on, verbatim. A
    // paraphrased or hallucinated span is a failed decision, not a decision
    // with a caveat. Cheap, and it catches most injection.
    if (!verifyEvidenceSpan(classification.evidence_span, sanitized.text)) {
      stamp(messageRowId, "classified:ungrounded")
      return escalate("evidence_span does not appear verbatim in the reply", {
        messageRowId,
        intent: classification.intent,
        evidenceSpan: classification.evidence_span.slice(0, 200),
      })
    }
  }

  // --- 4. THE HARDCODED SWITCH -------------------------------------------
  let action = actionForIntent(classification.intent)

  // Two narrowings, both of which can only ever REMOVE an automatic send.
  // Neither can turn an escalation into a reply, and neither can stop a
  // suppression — a short "no thanks" must still suppress, or the day-9
  // follow-up fires at someone who declined.
  if (action === "fixed_reply" && classification.ready_to_talk) {
    // They are asking to move forward. A human closes that, not a template.
    action = "escalate"
  }
  if (action === "fixed_reply" && isShortNegative(sanitized.text)) {
    // Spec §2's short-reply rule. `triage()` already escalates these before a
    // model ever sees them (rule 12), so this is a second line of defence
    // against a future reordering there, not the primary control.
    action = "escalate"
  }

  emit("classify.classified", {
    leadId: lead.id,
    detail: {
      messageRowId,
      intent: classification.intent,
      action,
      readyToTalk: classification.ready_to_talk,
      reason: classification.reason,
      // Recorded so the human queue can be sorted by it. NEVER read as an
      // authorization signal (spec §3).
      evidenceSpan: classification.evidence_span.slice(0, 200),
    },
  })

  const leadEmail = lead.email?.trim() ?? ""

  switch (action) {
    // -----------------------------------------------------------------------
    case "silence": {
      // Suppress permanently and stop the sequence. NOTHING is sent — no
      // courtesy reply, no confirmation. `suppressAddress` writes the
      // suppression, cancels every pending task for the lead, and sets
      // `leads.status='suppressed'` inside ONE transaction (spec §7), which is
      // what closes the window where a suppression exists but the day-9
      // follow-up is still queued.
      const suppress = deps.suppressAddress ?? suppressAddress
      const reason = `reply classified ${classification.intent}: ${classification.reason}`
      if (leadEmail.length > 0) {
        suppress(leadEmail, reason, { leadId: lead.id })
      } else {
        // No address to suppress, but the tasks must still stop.
        const cancel =
          deps.cancelPendingTasksForLead ?? cancelPendingTasksForLead
        cancel(lead.id)
        patchLead(lead.id, { status: "suppressed" })
      }
      stamp(messageRowId, classifiedStatus(classification.intent))
      emit("classify.silenced", {
        leadId: lead.id,
        detail: { intent: classification.intent, sent: false },
      })
      return done(`silenced and suppressed (${classification.intent})`)
    }

    // -----------------------------------------------------------------------
    case "no_reply_defer": {
      // An out-of-office. No reply, and per §3 it does not count as a reply:
      // the sequence resumes when they are back rather than being cancelled.
      const until = resolveOooDeferUntil(sanitized.text, now)
      const moved = (deps.deferPendingCompose ?? deferPendingCompose)(
        lead.id,
        until
      )
      // `handleInboundMessage` optimistically set `replied` for every message
      // that reached classification. An OOO is not a reply, so that is undone
      // here — otherwise an autoresponder silently ends the sequence.
      if (lead.status === "replied") {
        patchLead(lead.id, { status: "contacted" })
      }
      stamp(messageRowId, classifiedStatus("out_of_office"))
      emit("classify.out_of_office", {
        leadId: lead.id,
        detail: {
          deferUntil: until,
          composeTasksMoved: moved,
          cappedAt30Days: until >= now + MAX_OOO_DEFER_MS,
        },
      })
      return done(
        `out of office; ${moved} compose task(s) deferred to ${new Date(until).toISOString()}`
      )
    }

    // -----------------------------------------------------------------------
    case "fixed_reply": {
      // The ONE path that sends anything automatically, and the text is a
      // fixed, human-written template from `lib/prompts.ts`. No model output
      // is involved in producing these bytes.
      const priorAutoReplies = (deps.countAutoReplies ?? countAutoReplies)(
        lead.id
      )
      if (priorAutoReplies >= 1) {
        // At most one auto-reply per thread, ever.
        return escalate(
          "a fixed reply was already sent to this lead; a second automatic reply is how a mail loop starts",
          { messageRowId, priorAutoReplies }
        )
      }
      if (leadEmail.length === 0) {
        return escalate("lead has no email address to reply to", {
          messageRowId,
        })
      }

      const senderResult = (
        deps.loadSenderInfo ?? (() => loadSenderInfoDefault())
      )()
      if (!senderResult.sender) {
        return escalate(
          `cannot send the fixed reply without sender details (Settings -> ${senderResult.missing.join(
            ", "
          )})`,
          { messageRowId }
        )
      }

      const mailboxId = payloadMailboxId ?? row.mailbox_id
      if (!mailboxId) {
        return escalate("no mailbox recorded for the inbound message", {
          messageRowId,
        })
      }

      // Recorded BEFORE the send so a deferral (closed send window) resumes
      // without paying for the model again.
      stamp(messageRowId, classifiedStatus("send_more_info"))

      const render = deps.renderFixedReply ?? renderFixedReply
      const text = render("send_more_info", {
        name: senderResult.sender.name,
        company: senderResult.sender.company,
        address: senderResult.sender.address,
      })

      const references = row.refs
        ? [...row.refs.split(/\s+/).filter(Boolean)]
        : []
      if (row.message_id) references.push(row.message_id)

      const input: SendMessageInput = {
        leadId: lead.id,
        mailboxId,
        to: leadEmail,
        subject: row.subject?.trim() || "Re: vending machine placement",
        text,
        // Off-sequence, so `UNIQUE(lead_id, sequence_step)` does not cover it
        // and `dedupeKey` is mandatory. Keyed on the inbound row, so the same
        // reply can never produce two outgoing ones.
        sequenceStep: null,
        dedupeKey: `autoreply:send_more_info:${lead.id}:${messageRowId}`,
        // Adds `Auto-Submitted: auto-replied` (amendment A9, via
        // `outboundLoopHeaders` inside `buildMime`) so a conforming
        // autoresponder on the far side will not answer it.
        isAutoReply: true,
        // Honest here, unlike anywhere in the sequence: they really did reply,
        // so `Re:` is accurate rather than deceptive.
        recipientReplied: true,
        ...(row.message_id ? { inReplyTo: row.message_id } : {}),
        ...(references.length > 0 ? { references } : {}),
        leadTimezone: lead.timezone,
        taskRunAfter: task.run_after,
      }

      const send = deps.sendMessage ?? sendMessage
      const outcome = await send(input, deps.sendDeps ?? {})

      switch (outcome.status) {
        case "sent":
          emit("classify.fixed_reply_sent", {
            leadId: lead.id,
            detail: {
              outreachId: outcome.outreachId,
              dryRun: outcome.dryRun,
              template: "send_more_info",
            },
          })
          // Left at `replied` (set by the inbound path), not `hot`: they asked
          // for information, they now have it, and the ball is with them.
          return done(
            `fixed reply ${outcome.dryRun ? "dry-run" : "sent"} (send_more_info)`
          )

        case "duplicate":
          return done(`fixed reply already sent: ${outcome.reason}`)

        case "suppressed":
          return done(`fixed reply not sent: ${outcome.reason}`)

        case "blocked":
          if (outcome.retryAt !== null) {
            return deferred(
              outcome.retryAt,
              `fixed reply blocked (${outcome.code}): ${outcome.reason}`
            )
          }
          return escalate(
            `fixed reply blocked (${outcome.code}): ${outcome.reason}`,
            { messageRowId }
          )

        case "failed":
          // An auto-reply is a convenience, never worth an aggressive retry
          // loop against a stranger's mail server. A human takes it from here.
          return escalate(
            `fixed reply failed (${outcome.classification.kind}): ${outcome.classification.detail}`,
            { messageRowId, unresolved: outcome.unresolved }
          )
      }
    }

    // -----------------------------------------------------------------------
    case "escalate":
      stamp(messageRowId, classifiedStatus(classification.intent))
      return escalate(
        `intent "${classification.intent}" needs a human: ${classification.reason}`,
        { messageRowId, intent: classification.intent }
      )
  }
}

/**
 * Narrows `loadSenderInfo` to the three fields `renderFixedReply` actually
 * substitutes, so `ClassifyDeps` does not oblige a test to build a whole
 * `SenderInfo`. One definition of "which Settings fields are required" stays
 * in `common.ts`.
 */
function loadSenderInfoDefault(): {
  sender?: { name: string; company: string; address: string }
  missing: string[]
} {
  const result = loadSenderInfo()
  return result.sender
    ? {
        sender: {
          name: result.sender.name,
          company: result.sender.company,
          address: result.sender.address,
        },
        missing: [],
      }
    : { missing: result.missing }
}

/** Re-exported so a test can assert the table covers every declared intent. */
export { REPLY_INTENTS }
