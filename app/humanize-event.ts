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
  // --- finding businesses -------------------------------------------------
  "leads.found": "Searched for businesses",
  "leads.imported": "Added businesses to the list",
  "lead.enriched": "Researched a business",
  "lead.unqualified": "Skipped a business",
  "osm.search": "Searched the map",

  // --- writing --------------------------------------------------------------
  "compose.drafted": "Wrote an email",
  "compose.validation_failed": "Rewriting an email",
  "compose.escalated": "An email needs you",

  // --- sending -------------------------------------------------------------
  "send.step_sent": "Sent an email",
  "send.enabled_changed": "Changed the sending setting",
  "send.blocked": "Held an email back",
  "send.suppressed_at_send": "Did not send, because they asked us to stop",
  "send.duplicate": "Skipped a repeat email",
  "send.auto_reply": "Sent an automatic reply",
  "send.failed": "An email would not send",
  "send.dryrun_cleared": "Deleted the practice emails",
  "send.breaker_tripped_after_send": "Sending stopped itself after a send",
  "send.reconcile_unavailable": "Could not check your Sent folder",
  "send.reconcile_failed": "Failed to check your Sent folder",
  "send.reconciled_found": "Found the email in your Sent folder",
  "send.reconciled_absent": "An email is missing from your Sent folder",

  // --- replies --------------------------------------------------------------
  "inbound.bounce": "An email came back undelivered",
  "inbound.suppressed": "Ignored a reply, because they asked us to stop",
  "inbound.escalate": "A reply needs you",
  "inbound.classify_enqueued": "Reading a reply",
  "inbound.ignored": "Ignored a reply",
  "inbound.unmatched": "Got an email we could not match to anyone",
  "inbound.loop_alarm": "Stopped a possible reply loop",
  "inbound.handler_error": "Something went wrong reading a reply",
  "classify.escalated": "A reply needs you",
  "classify.classified": "Sorted a reply",
  "classify.silenced": "Reply handled, this one is closed",
  "classify.out_of_office": "They are away, so the follow-up moved later",
  "classify.fixed_reply_sent": "Sent an automatic reply",

  // --- email account / safety limits ---------------------------------------
  "mailbox.paused": "Paused an email account",
  "mailbox.hard_stop": "Stopped every email account",
  suppressed: "Added an address to the never-email list",
  "circuit_breaker.tripped": "Sending stopped itself",
  "circuit_breaker.rearmed": "Sending switched back on",
  "imap.uidvalidity_changed": "Re-synced with your mailbox",
  "imap.connection_error": "Could not reach your mailbox",
  "imap.folder_opened": "Checked for new replies",
  "imap.drain_error": "Something went wrong reading your mailbox",

  // --- the engine ----------------------------------------------------------
  "engine.started": "Engine started",
  "engine.lock_lost": "Engine stopped, because another copy took over",
  "engine.loop_alarm": "Engine caught itself going in circles",
  "engine.unhandled_rejection": "Unexpected engine error",
  "engine.uncaught_exception": "The engine crashed",
  "task.leases_reaped": "Picked up jobs that got stuck",
  task_dead_letter: "A job gave up after repeated tries",
  "task.catchup_suppressed": "Skipped a job that was too old to run",
  "task.needs_reconciliation": "An email needs checking by hand",
  "task.enriched": "Researched a business",
  "task.unqualified": "Skipped a business",

  // --- AI ---
  ai_call: "Asked the AI",
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
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

const REASON_TYPES = new Set([
  "task_dead_letter",
  "classify.escalated",
  "compose.escalated",
  "lead.unqualified",
  "task.unqualified",
])

/** Humanizes one event row's `type` + `detail_json` into display text. */
export function humanizeEvent(
  type: string,
  detailJson: string | null
): HumanizedEvent {
  const detail = parseDetail(detailJson)
  const label = EVENT_LABELS[type] ?? titleCaseFallback(type)

  if (type === "engine.halted") {
    return {
      text:
        detail.reason === "stop_file"
          ? "Everything halted, because there is a STOP file"
          : "Everything halted, because a safety limit tripped",
    }
  }
  if (type === "send.enabled_changed") {
    return {
      text:
        detail.enabled === true ? "Turned sending on" : "Turned sending off",
    }
  }
  if (REASON_TYPES.has(type)) {
    return { text: label, extra: asString(detail.reason) }
  }
  return { text: label }
}
