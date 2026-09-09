/**
 * `send` — put one composed email on the wire.
 *
 * Almost none of the dangerous machinery is here. `lib/mail-send.ts` owns the
 * send gate, the pacing limiter, the warm-up ramp, the daily cap, the TOCTOU
 * suppression re-check inside the insert transaction, `X-Outreach-Id`, the
 * loop headers, SMTP error classification, the circuit breakers, and
 * reconciliation. This handler picks a mailbox, calls `sendMessage` once, and
 * decides what the queue does next.
 *
 * The two things it must get right on its own:
 *   - a `held` lead is never sent, and its task stays visible as an approval
 *     item rather than failing or vanishing;
 *   - an AMBIGUOUS failure becomes a reconciliation, never a retry.
 */

import {
  enqueue,
  getLeadById,
  isSuppressed,
  listMailboxes,
  logEvent,
  updateLead,
  type LeadRow,
  type MailboxRow,
} from "../../lib/db.ts"
import {
  canSendNow,
  checkCircuitBreakers,
  getMailboxPause,
  sendMessage,
  type SendDeps,
  type SendGate,
  type SendMessageInput,
  type SendOutcome,
} from "../../lib/mail-send.ts"
import {
  AmbiguousSendError,
  DAY_MS,
  HOUR_MS,
  deadLetter,
  deferred,
  done,
  hasEverReplied,
  isSequenceStep,
  isTerminalLeadStatus,
  loadSenderInfo,
  parsePayload,
  readEarliestOutbound,
  type HandlerOutcome,
  type SequenceStep,
  type TaskLike,
} from "./common.ts"

// ---------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------

/**
 * What follows each step, and how long after. Day 4 then day 9, so the gap
 * from step 4 is five days, not four. `null` ends the sequence — there is no
 * step after 9, and nothing may invent one.
 */
export const NEXT_STEP: Record<
  SequenceStep,
  { step: SequenceStep; delayMs: number } | null
> = {
  1: { step: 4, delayMs: 4 * DAY_MS },
  4: { step: 9, delayMs: 5 * DAY_MS },
  9: null,
}

/** How long a `held` lead's send task waits before being looked at again. */
export const HELD_RECHECK_MS = HOUR_MS

/** Statuses `sent` is allowed to overwrite with `contacted`. */
const PRE_CONTACT_STATUSES = ["new", "enriching", "ready", "held", "contacted"]

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface SendPayload {
  step: SequenceStep
  subject: string
  body: string
}

export function parseSendPayload(
  payloadJson: string | null
): SendPayload | null {
  const raw = parsePayload(payloadJson) as {
    step?: unknown
    subject?: unknown
    body?: unknown
  } | null
  if (raw === null) return null
  if (!isSequenceStep(raw.step)) return null
  if (typeof raw.subject !== "string" || raw.subject.trim().length === 0) {
    return null
  }
  if (typeof raw.body !== "string" || raw.body.trim().length === 0) return null
  return { step: raw.step, subject: raw.subject, body: raw.body }
}

// ---------------------------------------------------------------------------
// Mailbox selection
// ---------------------------------------------------------------------------

export interface MailboxChoice {
  mailbox: MailboxRow
  gate: Extract<SendGate, { ok: true }>
}

export interface MailboxRefusal {
  /** The soonest any mailbox said it might be ready, if any said so. */
  retryAt: number | null
  reasons: string[]
}

export type MailboxSelection =
  | { kind: "chosen"; choice: MailboxChoice }
  | { kind: "none"; refusal: MailboxRefusal }

/**
 * The first mailbox with capacity right now.
 *
 * `canSendNow` is the authoritative limiter, so this is a loop over it rather
 * than any judgement of its own. Its refusal is RESPECTED, not worked around:
 * `retryAt` is the gate telling us when it would say yes, and rescheduling to
 * that instant is the entire mechanism that keeps a woken laptop from
 * emptying its backlog into someone's inbox at once.
 */
export function selectMailbox(
  leadTimezone: string | null,
  taskRunAfter: number,
  deps: {
    now: number
    listMailboxes: () => MailboxRow[]
    getMailboxPause: typeof getMailboxPause
    canSendNow: typeof canSendNow
  }
): MailboxSelection {
  const reasons: string[] = []
  let soonest: number | null = null

  for (const mailbox of deps.listMailboxes()) {
    if (mailbox.status === "disabled") {
      reasons.push(`${mailbox.email}: disabled`)
      continue
    }
    const pause = deps.getMailboxPause(mailbox.id)
    if (pause && pause.until > deps.now) {
      reasons.push(`${mailbox.email}: paused (${pause.reason})`)
      soonest = soonest === null ? pause.until : Math.min(soonest, pause.until)
      continue
    }

    const gate = deps.canSendNow(mailbox.id, leadTimezone, {
      now: deps.now,
      taskRunAfter,
    })
    if (gate.ok) return { kind: "chosen", choice: { mailbox, gate } }

    reasons.push(`${mailbox.email}: ${gate.code} (${gate.reason})`)
    if (gate.retryAt !== null) {
      soonest =
        soonest === null ? gate.retryAt : Math.min(soonest, gate.retryAt)
    }
  }

  return { kind: "none", refusal: { retryAt: soonest, reasons } }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface SendHandlerDeps {
  now?: () => number
  getLeadById?: (id: string) => LeadRow | undefined
  isSuppressed?: (email: string) => boolean
  hasEverReplied?: (leadId: string) => boolean
  listMailboxes?: () => MailboxRow[]
  getMailboxPause?: typeof getMailboxPause
  canSendNow?: typeof canSendNow
  sendMessage?: (
    input: SendMessageInput,
    deps?: SendDeps
  ) => Promise<SendOutcome>
  checkCircuitBreakers?: typeof checkCircuitBreakers
  readEarliestOutbound?: typeof readEarliestOutbound
  loadSenderInfo?: typeof loadSenderInfo
  updateLead?: typeof updateLead
  enqueue?: typeof enqueue
  logEvent?: typeof logEvent
  /** Transport/searcher overrides handed straight to `sendMessage`. */
  sendDeps?: SendDeps
}

export async function handleSend(
  task: TaskLike,
  deps: SendHandlerDeps = {}
): Promise<HandlerOutcome> {
  const leadId = task.lead_id
  if (leadId === null) return deadLetter("send task has no lead_id")

  const payload = parseSendPayload(task.payload_json)
  if (payload === null) {
    return deadLetter(
      `send payload must be {"step":1|4|9,"subject":string,"body":string}, got ` +
        `${task.payload_json ?? "null"}`
    )
  }

  const now = (deps.now ?? Date.now)()
  const readLead = deps.getLeadById ?? getLeadById
  const suppressed = deps.isSuppressed ?? isSuppressed
  const replied = deps.hasEverReplied ?? hasEverReplied
  const emit = deps.logEvent ?? logEvent
  const patchLead = deps.updateLead ?? updateLead
  const add = deps.enqueue ?? enqueue

  const lead = readLead(leadId)
  if (!lead) return deadLetter(`lead ${leadId} no longer exists`)

  const email = lead.email?.trim() ?? ""
  if (email.length === 0)
    return deadLetter(`lead ${leadId} has no email address`)

  // --- 1. Suppression, re-checked here (spec §7, TOCTOU) -------------------
  // `sendMessage` re-checks it again inside the same transaction as the
  // `messages` insert, which is the guarantee that actually holds. This check
  // is the cheap one: it stops a "not interested" that arrived at 09:02 from
  // costing a mailbox scan and an SMTP connection for a follow-up due at 09:05.
  if (isTerminalLeadStatus(lead.status)) {
    return done(`not sent: lead is ${lead.status}`)
  }
  if (suppressed(email)) {
    return done(`not sent: ${email} is on the suppression list`)
  }
  if (payload.step !== 1 && replied(leadId)) {
    return done(`not sent: lead replied, so step ${payload.step} is cancelled`)
  }

  // --- 2. Held for approval ------------------------------------------------
  // Deliberately NOT a failure and NOT a completion. The task stays pending
  // with `run_after` pushed out, because its payload is the draft the approval
  // queue shows — completing it would delete the thing the user is meant to
  // review, and failing it would burn one of only two send attempts.
  // Approval is a UI action that flips the lead to `ready`.
  if (lead.status === "held") {
    return deferred(
      now + HELD_RECHECK_MS,
      `lead is held for approval; step ${payload.step} draft is waiting for review`
    )
  }

  // --- 3. Pick a mailbox with capacity ------------------------------------
  // Nothing here consults `isSendEnabled()`. `createTransport` reads it inside
  // `sendMessage` and hands back a `FileTransport`, so a dry run exercises the
  // gate, the row insert, the MIME build, and the pacing counters — everything
  // except the socket. Branching on the flag out here would skip the pipeline,
  // which is the one thing the dry run exists to test.
  const selection = selectMailbox(lead.timezone, task.run_after, {
    now,
    listMailboxes: deps.listMailboxes ?? listMailboxes,
    getMailboxPause: deps.getMailboxPause ?? getMailboxPause,
    canSendNow: deps.canSendNow ?? canSendNow,
  })

  if (selection.kind === "none") {
    const { retryAt, reasons } = selection.refusal
    if (reasons.length === 0) {
      return deadLetter(
        "no mailboxes are configured. Add one in Settings -> Mailboxes."
      )
    }
    return deferred(
      retryAt ?? now + HOUR_MS,
      `no mailbox has capacity: ${reasons.join("; ")}`
    )
  }

  const { mailbox } = selection.choice
  const prior = (deps.readEarliestOutbound ?? readEarliestOutbound)(leadId)
  const sender = (deps.loadSenderInfo ?? loadSenderInfo)().sender

  const input: SendMessageInput = {
    leadId,
    mailboxId: mailbox.id,
    to: email,
    subject: payload.subject,
    text: payload.body,
    sequenceStep: payload.step,
    leadTimezone: lead.timezone,
    // Handed down so the authoritative catch-up check in `canSendNow` sees the
    // same `run_after` the engine did.
    taskRunAfter: task.run_after,
    // False for every sequence step, always. A lead who replied never reaches
    // here, so a `Re:` would be a deceptive subject line (spec §5). The
    // threading headers below are kept regardless — they are honest.
    recipientReplied: false,
    ...(sender ? { fromName: sender.name } : {}),
    ...(payload.step !== 1 && prior?.messageId
      ? {
          inReplyTo: prior.messageId,
          references: prior.refs
            ? [...prior.refs.split(/\s+/).filter(Boolean), prior.messageId]
            : [prior.messageId],
        }
      : {}),
  }

  const send = deps.sendMessage ?? sendMessage
  const outcome = await send(input, deps.sendDeps ?? {})

  // --- 4. Circuit breakers, after every send (spec §5) --------------------
  // They must trip in minutes, not after the campaign has finished. Checked
  // here as well as inside `sendMessage` so that a breaker armed BY this send
  // stops the tick before the next task is claimed.
  const breakers = (deps.checkCircuitBreakers ?? checkCircuitBreakers)({ now })

  switch (outcome.status) {
    case "sent": {
      // Re-read: an inbound reply may have landed while SMTP was open, and
      // stamping `contacted` over `replied` would lose it.
      const after = readLead(leadId)
      if (after && PRE_CONTACT_STATUSES.includes(after.status)) {
        patchLead(leadId, { status: "contacted" })
      }

      const next = NEXT_STEP[payload.step]
      let nextTaskId: string | null = null
      if (next) {
        nextTaskId = add("compose", {
          leadId,
          runAfter: now + next.delayMs,
          payload: { step: next.step },
        })
      }

      emit("send.step_sent", {
        leadId,
        detail: {
          step: payload.step,
          mailbox: mailbox.email,
          dryRun: outcome.dryRun,
          outreachId: outcome.outreachId,
          nextStep: next?.step ?? null,
          nextTaskId,
        },
      })

      if (breakers.tripped) {
        // The send itself succeeded; the task is done. The engine will decline
        // to claim anything on the next tick.
        emit("send.breaker_tripped_after_send", {
          leadId,
          detail: { breaker: breakers.state?.breaker, step: payload.step },
        })
      }
      return done(
        `step ${payload.step} ${outcome.dryRun ? "dry-run" : "sent"} via ${mailbox.email}`
      )
    }

    case "duplicate":
      // `UNIQUE(lead_id, sequence_step)` fired: this step already went out.
      // That is the structural guarantee working, not an error.
      return done(`already sent: ${outcome.reason}`)

    case "suppressed":
      return done(`not sent: ${outcome.reason}`)

    case "blocked": {
      if (
        outcome.code === "needs_reconciliation" ||
        outcome.code === "attempts_exhausted"
      ) {
        // The `messages` row is stuck in `sending` or has used its one resend.
        // Either way this task must stop asking; startup reconciliation
        // against Sent Mail is what resolves the row.
        return deadLetter(`${outcome.code}: ${outcome.reason}`)
      }
      return deferred(
        outcome.retryAt ?? now + HOUR_MS,
        `blocked (${outcome.code}): ${outcome.reason}`
      )
    }

    case "failed": {
      if (outcome.unresolved) {
        // AMBIGUOUS. nodemailer resolves after `250 OK`, so a timeout after
        // DATA is indistinguishable from one before it. Never blind-retry:
        // the engine turns this into a dead-letter plus a reconciliation
        // event, and a delayed email beats a duplicate one.
        throw new AmbiguousSendError(
          `send outcome is ambiguous (${outcome.classification.kind}: ` +
            `${outcome.classification.detail}); must reconcile against Sent Mail`,
          outcome.outreachId
        )
      }

      switch (outcome.classification.action) {
        case "suppress_recipient":
          // `sendMessage` already suppressed the address and cancelled the
          // lead's pending tasks.
          return done(`address rejected: ${outcome.classification.detail}`)

        case "pause_mailbox_24h":
        case "backoff_and_trip_breaker":
        case "hard_stop_all_mailboxes":
          // A temporary condition, sometimes wearing a 5xx code. Spec §5:
          // requeue UNCHANGED. A deferral rather than a failure, because the
          // message is fine and the mailbox is not — charging it an attempt is
          // how "daily sending limit exceeded" ends up burning a live lead
          // forever.
          return deferred(
            now + Math.max(outcome.classification.backoffMs, HOUR_MS),
            `${outcome.classification.kind}: ${outcome.classification.detail}`
          )

        case "dead_letter":
          return deadLetter(
            `${outcome.classification.kind}: ${outcome.classification.detail}`
          )

        default:
          // Positively not delivered. Let the engine apply the `send` retry
          // policy, which allows exactly one more attempt.
          throw new Error(
            `send failed (${outcome.classification.kind}): ${outcome.classification.detail}`
          )
      }
    }
  }
}
