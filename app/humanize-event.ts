/**
 * Maps raw `events.type` strings (written by `lib/*.ts` and `worker/**` via
 * `logEvent`/`emit`) to plain-language sentences for the dashboard's
 * activity feed. Pure and dependency-free — safe to import from anywhere.
 *
 * The full vocabulary was collected by grepping every `logEvent(`/`emit(`
 * call site in `lib/` and `worker/`, rather than guessing. Anything that
 * shows up later and isn't in this table falls back to a readable
 * title-cased version of the raw type string, per the brief.
 */

export interface HumanizedEvent {
  text: string
  /** Optional short supplementary detail (e.g. a failure reason). */
  extra?: string
}

const EVENT_LABELS: Record<string, string> = {
  // --- lead sourcing ---------------------------------------------------
  "leads.found": "Searched for leads",
  "leads.imported": "Imported leads",
  "lead.enriched": "Lead enriched",
  "lead.unqualified": "Lead disqualified",
  "osm.search": "Searched OpenStreetMap",

  // --- composing ---------------------------------------------------------
  "compose.drafted": "Drafted an email",
  "compose.validation_failed": "Draft failed validation, retrying",
  "compose.escalated": "Draft needs you",

  // --- sending -------------------------------------------------------------
  "send.step_sent": "Sent an email",
  "send.enabled_changed": "Sending setting changed",
  "send.blocked": "Send blocked",
  "send.suppressed_at_send": "Send blocked — address suppressed",
  "send.duplicate": "Duplicate send skipped",
  "send.auto_reply": "Sent an automatic reply",
  "send.failed": "Send failed",
  "send.dryrun_cleared": "Cleared rehearsal drafts",
  "send.breaker_tripped_after_send": "Circuit breaker tripped after sending",
  "send.reconcile_unavailable": "Could not verify a send",
  "send.reconcile_failed": "Failed to verify a send",
  "send.reconciled_found": "Verified a send in Sent Mail",
  "send.reconciled_absent": "A send could not be confirmed as sent",

  // --- inbound / classification ------------------------------------------
  "inbound.bounce": "Email bounced",
  "inbound.suppressed": "Reply ignored — sender is suppressed",
  "inbound.escalate": "Reply needs you",
  "inbound.classify_enqueued": "Reply queued for triage",
  "inbound.ignored": "Reply ignored",
  "inbound.unmatched": "Received an email that didn't match a lead",
  "inbound.loop_alarm": "Loop alarm — possible auto-reply loop",
  "inbound.handler_error": "Error handling a reply",
  "classify.escalated": "Reply needs you",
  "classify.classified": "Classified a reply",
  "classify.silenced": "Reply handled, lead closed",
  "classify.out_of_office": "Out-of-office reply — follow-up rescheduled",
  "classify.fixed_reply_sent": "Sent an automatic reply",

  // --- mailboxes / circuit breakers --------------------------------------
  "mailbox.paused": "Mailbox paused",
  "mailbox.hard_stop": "All mailboxes stopped",
  suppressed: "Address suppressed",
  "circuit_breaker.tripped": "Circuit breaker tripped",
  "circuit_breaker.rearmed": "Circuit breaker re-armed",
  "imap.uidvalidity_changed": "Mailbox re-synced",
  "imap.connection_error": "Mailbox connection error",
  "imap.folder_opened": "Checked mailbox for replies",
  "imap.drain_error": "Error reading mailbox",

  // --- engine / task queue -------------------------------------------------
  "engine.started": "Engine started",
  "engine.lock_lost": "Engine lost its lock",
  "engine.loop_alarm": "Loop alarm",
  "engine.unhandled_rejection": "Unexpected engine error",
  "engine.uncaught_exception": "Unexpected engine crash",
  "task.leases_reaped": "Recovered stuck tasks",
  task_dead_letter: "A task gave up after repeated failures",
  "task.catchup_suppressed": "Skipped an overdue task",
  "task.needs_reconciliation": "A send needs manual verification",
  "task.enriched": "Lead enriched",
  "task.unqualified": "Lead disqualified",

  // --- AI ---
  ai_call: "AI call",
}

function titleCaseFallback(type: string): string {
  const words = type.replace(/[._]/g, " ").trim()
  return words.replace(/\b\w/g, (c) => c.toUpperCase())
}

function parseDetail(detailJson: string | null): Record<string, unknown> {
  if (!detailJson) return {}
  try {
    const parsed: unknown = JSON.parse(detailJson)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

const REASON_TYPES = new Set([
  "task_dead_letter",
  "classify.escalated",
  "compose.escalated",
  "lead.unqualified",
  "task.unqualified",
])

/** Humanizes one event row's `type` + `detail_json` into display text. */
export function humanizeEvent(type: string, detailJson: string | null): HumanizedEvent {
  const detail = parseDetail(detailJson)
  const label = EVENT_LABELS[type] ?? titleCaseFallback(type)

  if (type === "engine.halted") {
    return {
      text:
        detail.reason === "stop_file"
          ? "Engine halted — STOP file present"
          : "Engine halted — circuit breaker tripped",
    }
  }
  if (type === "send.enabled_changed") {
    return { text: detail.enabled === true ? "Turned sending on" : "Turned sending off" }
  }
  if (REASON_TYPES.has(type)) {
    return { text: label, extra: asString(detail.reason) }
  }
  return { text: label }
}
