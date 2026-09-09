/**
 * Deterministic triage of an inbound message, from its headers, run BEFORE
 * any model call (spec §2).
 *
 * **The model is never the first decision-maker.** Everything that can be
 * decided from RFC-defined headers is decided here, in a fixed order, by code
 * a human can read. Only messages that survive all fourteen rules are handed
 * to a classifier, and even then §3 restricts what may be done with the
 * result.
 *
 * Pure: no database writes, no network, no sending. The caller owns all
 * effects.
 */

import {
  detectOptOut,
  isShortNegative,
  stripQuotedReply,
} from "../lib/untrusted.ts"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeaderValue = string | readonly string[]
export type RawHeaders = Readonly<Record<string, HeaderValue>>

export interface InboundMessage {
  /**
   * Headers exactly as received. Real-world casing is arbitrary
   * (`Message-ID`, `Message-Id`, `MESSAGE-ID` all occur), so never index this
   * directly — use `getHeader` / `getHeaderAll` / `hasHeader`.
   *
   * A repeated header (Received, List-*) may arrive as an array.
   */
  headers: RawHeaders
  /** Decoded body text. HTML bodies should already be run through htmlToText. */
  body: string
  /** The contact email of the lead this message was matched to. */
  leadEmail: string
  /**
   * Every address this application sends from. Required, not optional: an
   * absent list silently disables half of loop detection, and a silent
   * failure here is a robot-to-robot mail loop.
   */
  ourMailboxes: readonly string[]
  /**
   * Full raw source (headers + body) when available. `X-Loop` has to be
   * findable "anywhere in the message", including inside a bounced or
   * forwarded copy of our own mail, which only the raw source carries.
   */
  raw?: string
}

export type TriageVerdict =
  /** Never reply, never escalate, does not count as engagement. */
  | { action: "ignore"; reason: string }
  | { action: "bounce"; hard: boolean; recipient?: string; reason: string }
  /** Opt-out or hostile: stop forever. */
  | { action: "suppress"; reason: string }
  /** A human must look at this before anything else happens. */
  | { action: "escalate"; reason: string }
  /** The only verdict that proceeds to a model. */
  | { action: "classify"; reason: string }

// ---------------------------------------------------------------------------
// Case-insensitive header access
// ---------------------------------------------------------------------------

/** All values for `name`, in insertion order, trimmed. Case-insensitive. */
export function getHeaderAll(headers: RawHeaders, name: string): string[] {
  const wanted = name.trim().toLowerCase()
  const out: string[] = []
  for (const [key, value] of Object.entries(headers)) {
    if (key.trim().toLowerCase() !== wanted) continue
    if (Array.isArray(value)) {
      for (const entry of value) out.push(String(entry).trim())
    } else {
      out.push(String(value).trim())
    }
  }
  return out
}

/** The first value for `name`, or undefined. Case-insensitive. */
export function getHeader(
  headers: RawHeaders,
  name: string
): string | undefined {
  const all = getHeaderAll(headers, name)
  return all.length > 0 ? all[0] : undefined
}

/**
 * Whether `name` is present at all, regardless of value.
 *
 * Several rules key off presence, not content (`X-Autoreply`,
 * `List-Unsubscribe`, `X-Loop`), so "present but empty" must still count.
 */
export function hasHeader(headers: RawHeaders, name: string): boolean {
  return getHeaderAll(headers, name).length > 0
}

const ADDRESS_IN_TEXT = /[^\s<>,;"()]+@[^\s<>,;"()]+/

/** Lowercased bare address out of `Name <addr@host>` / `addr@host` / `<addr>`. */
export function extractAddress(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const angle = /<([^>]*)>/.exec(value)
  const candidate = angle !== null ? angle[1] : value
  const match = ADDRESS_IN_TEXT.exec(candidate) ?? ADDRESS_IN_TEXT.exec(value)
  return match !== null ? match[0].trim().toLowerCase() : undefined
}

function domainOf(address: string | undefined): string | undefined {
  if (address === undefined) return undefined
  const at = address.lastIndexOf("@")
  return at >= 0 ? address.slice(at + 1) : undefined
}

/** Flattens headers back to text, for the "anywhere in the message" scans. */
function messageText(msg: InboundMessage): string {
  if (msg.raw !== undefined) return msg.raw
  const lines: string[] = []
  for (const [key, value] of Object.entries(msg.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) lines.push(`${key}: ${String(entry)}`)
    } else {
      lines.push(`${key}: ${String(value)}`)
    }
  }
  return `${lines.join("\n")}\n\n${msg.body}`
}

// ---------------------------------------------------------------------------
// Rule 1 + 2 — bounces and delivery-status notifications
// ---------------------------------------------------------------------------

const NULL_SENDER = /^\s*<\s*>\s*$/

interface DsnDetails {
  /** True only when a 5.x.x status (or an unambiguous 5xx) was actually found. */
  hard: boolean
  /** True when hardness was determined rather than defaulted. */
  determined: boolean
  recipient?: string
  status?: string
}

const DSN_PART = /content-type:\s*message\/delivery-status/i
const DSN_STATUS = /^[ \t]*Status:[ \t]*([245])\.(\d{1,3})\.(\d{1,3})\b/im
const DSN_RECIPIENT =
  /^[ \t]*(?:Final|Original)-Recipient:[ \t]*[^;\n]*;[ \t]*([^\n]+)$/im
const DIAGNOSTIC_5XX = /diagnostic-code:[^\n]*?\b5\d{2}\b/i
const DIAGNOSTIC_4XX = /diagnostic-code:[^\n]*?\b4\d{2}\b/i
const LOOSE_ENHANCED_STATUS = /\b([45])\.\d{1,3}\.\d{1,3}\b/
const HARD_BOUNCE_PHRASE =
  /\b(?:user unknown|no such user|no such recipient|recipient (?:address )?rejected|address not found|does ?n[o']?t exist|unknown (?:user|recipient|address)|mailbox (?:unavailable|not found)|account (?:has been )?disabled|invalid recipient)\b/i

function cleanRecipient(value: string): string | undefined {
  const address = extractAddress(value)
  return address
}

/**
 * Pulls hard/soft and the failed recipient out of a DSN.
 *
 * Called from BOTH rule 1 and rule 2. That is deliberate: the spec's ordering
 * puts `Return-Path: <>` (rule 1) above DSN parsing (rule 2), but a real DSN
 * carries *both* — RFC 3464 requires the null return path on the notification
 * itself. Taking rule 1 literally and returning early would throw away the
 * hard/soft distinction on every bounce we ever see, and hard/soft is the
 * difference between "suppress permanently" and "retry". So rule 1 fires
 * first, as specified, but with the DSN already parsed.
 */
function parseDeliveryStatus(msg: InboundMessage): DsnDetails {
  const body = msg.body
  const partIndex = body.search(DSN_PART)

  let region = body
  if (partIndex >= 0) {
    const rest = body.slice(partIndex)
    // The delivery-status part ends at the next MIME boundary line.
    const boundary = rest.search(/\n--/)
    region = boundary > 0 ? rest.slice(0, boundary) : rest
  }

  const failedHeader = getHeader(msg.headers, "x-failed-recipients")
  const recipientMatch = DSN_RECIPIENT.exec(region)
  const recipient =
    (recipientMatch !== null ? cleanRecipient(recipientMatch[1]) : undefined) ??
    (failedHeader !== undefined ? cleanRecipient(failedHeader) : undefined)

  const statusMatch = DSN_STATUS.exec(region) ?? DSN_STATUS.exec(body)
  if (statusMatch !== null) {
    const status = `${statusMatch[1]}.${statusMatch[2]}.${statusMatch[3]}`
    return {
      hard: statusMatch[1] === "5",
      determined: true,
      recipient,
      status,
    }
  }

  // Non-conforming bounce. Try, in order: a Diagnostic-Code SMTP reply, a
  // loose enhanced status code anywhere, then the classic English phrases.
  if (DIAGNOSTIC_5XX.test(region) || DIAGNOSTIC_5XX.test(body)) {
    return { hard: true, determined: true, recipient }
  }
  if (DIAGNOSTIC_4XX.test(region) || DIAGNOSTIC_4XX.test(body)) {
    return { hard: false, determined: true, recipient }
  }
  const loose = LOOSE_ENHANCED_STATUS.exec(region)
  if (loose !== null) {
    return { hard: loose[1] === "5", determined: true, recipient }
  }
  if (HARD_BOUNCE_PHRASE.test(body)) {
    return { hard: true, determined: true, recipient }
  }

  // Undetermined. Default to SOFT: a soft bounce costs a retry that the
  // per-kind attempt limit caps anyway, while a wrongly-hard bounce
  // permanently suppresses a live lead with no way to notice.
  return { hard: false, determined: false, recipient }
}

const MULTIPART_REPORT = /multipart\/report/i
const REPORT_TYPE_DSN = /report-type\s*=\s*"?delivery-status"?/i

// ---------------------------------------------------------------------------
// Rules 3-6, 8, 9, 13 — pattern tables
// ---------------------------------------------------------------------------

/** RFC 2369 / RFC 2919 list headers plus the de facto `Mailing-List`. */
const LIST_HEADERS = [
  "list-id",
  "list-unsubscribe",
  "list-post",
  "list-help",
  "list-subscribe",
  "list-owner",
  "list-archive",
  "mailing-list",
] as const

const BULK_PRECEDENCE = /^(?:list|bulk|junk|auto_reply)\b/i

/** Headers whose mere presence means "this came from a robot". */
const AUTORESPONDER_HEADERS = [
  "x-auto-response-suppress",
  "x-autoreply",
  "x-autorespond",
  "x-ms-exchange-inbox-rules-loop",
] as const

/**
 * Local parts that never belong to a human who wants a conversation.
 *
 * Anchored at the start and allowed to carry a suffix (`bounces+abc123@`,
 * `no-reply-marketing@`) because VERP and tagged addresses are the norm. Word
 * separators are `-`, `.` and `_`, all three of which occur in the wild
 * (`do-not-reply@`, `do.not.reply@`, `do_not_reply@`); matching only the
 * hyphen misses a third of real no-reply addresses.
 */
const ROBOT_LOCAL_PART =
  /^(?:mailer[-._]?daemon|postmaster|no[-._]?reply|do[-._]?not[-._]?reply|bounce(?:s|d)?|notification(?:s)?|auto[-._]?reply|auto[-._]?respond(?:er)?|system|daemon|root|abuse|nobody|devnull|unsubscribe)\b/i

const CALENDAR_CONTENT_TYPE = /text\/calendar/i
const CALENDAR_METHOD_REQUEST = /method\s*=\s*"?request"?/i
const VCALENDAR_REQUEST = /^\s*METHOD\s*:\s*REQUEST\s*$/im

/**
 * Ticket-system markers. Ticket systems are the classic infinite-loop partner:
 * our reply opens a ticket, their acknowledgement replies, our reply opens a
 * ticket, forever.
 */
const TICKET_MARKERS: readonly RegExp[] = [
  /\[#\d{2,}\]/,
  /\bticket\s*(?:id|no\.?|number|#)\s*[:#]?\s*\w+/i,
  /\bcase\s*(?:id|no\.?|number)?\s*#\s*\w+/i,
  /\bref(?:erence)?\s*[:#]\s*\d{4,}/i,
  /\[[A-Z]{2,10}-\d{1,7}\]/,
  /##\s*\d{3,}\s*##/,
  /\[~\d{4,}\]/,
  /\bincident\s*(?:id|no\.?|number|#)/i,
  /\bsr\s*#\s*\d{3,}/i,
]

/**
 * Subject-only autoresponder heuristics, in several languages.
 *
 * These downgrade to **escalate**, never to ignore-and-reply. i18n makes
 * subject sniffing unreliable in both directions — an English pattern misses a
 * Japanese out-of-office, and a human could plausibly write "Auto: ..." — so
 * the rule has to degrade safely. Escalating a real out-of-office costs a
 * human 5 seconds. Auto-replying to one starts a loop.
 */
const AUTORESPONDER_SUBJECTS: readonly RegExp[] = [
  /^\s*(?:re\s*:\s*)?automatic(?:al)?\s*(?:reply|response)\b/i,
  /^\s*(?:re\s*:\s*)?auto(?:matic)?\s*[:\-]/i,
  /\bout\s*of\s*(?:the\s*)?office\b/i,
  /\bout\s*of\s*office\s*(?:auto)?reply\b/i,
  /\bon\s+(?:annual\s+|maternity\s+|paternity\s+|parental\s+)?leave\b/i,
  /\bautoreply\b/i,
  /\babwesenheits(?:notiz|assistent)\b/i, // de
  /\bautomatische\s+antwort\b/i, // de
  /\br[ée]ponse\s+automatique\b/i, // fr
  /\babsence\s+du\s+bureau\b/i, // fr
  /\brespuesta\s+autom[áa]tica\b/i, // es
  /\bfuori\s+sede\b/i, // it
  /\bautomatisch\s+antwoord\b/i, // nl
  /\bautomatiskt\s+svar\b/i, // sv
  /自動応答|不在/, // ja
]

// ---------------------------------------------------------------------------
// Loop detection
// ---------------------------------------------------------------------------

const X_LOOP_ANYWHERE = /(?:^|\n)[ \t>]*x-loop[ \t]*:/i

/**
 * The loop alarm, factored out of `triage` on purpose.
 *
 * The spec's first-match-wins order puts loop detection at rule 7, *below* the
 * autoresponder and list rules — and our own auto-reply carries
 * `Auto-Submitted: auto-replied`, which rule 3 catches first. No loop can
 * actually run (rules 3-6 all return `ignore`, which never replies), but the
 * verdict alone would silently swallow the alarm.
 *
 * Callers should raise the alarm on this function's result regardless of the
 * verdict `triage` returns. Keeping it separate means the alarm does not
 * depend on rule ordering.
 */
export function detectLoopSignal(msg: InboundMessage): string | undefined {
  if (hasHeader(msg.headers, "x-loop")) {
    const value = getHeaderAll(msg.headers, "x-loop").join(", ")
    return `LOOP ALARM: our own X-Loop header came back to us (${value || "empty value"})`
  }

  const text = messageText(msg)
  if (X_LOOP_ANYWHERE.test(text)) {
    return "LOOP ALARM: an X-Loop header appears inside the message body (our mail was quoted or bounced back)"
  }

  const from = extractAddress(getHeader(msg.headers, "from"))
  if (from !== undefined) {
    const ours = new Set(
      msg.ourMailboxes.map((mailbox) => mailbox.trim().toLowerCase())
    )
    if (ours.has(from)) {
      return `LOOP ALARM: inbound From is one of our own mailboxes (${from})`
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Opt-out, independent of verdict ordering
// ---------------------------------------------------------------------------

/**
 * True when the de-quoted body carries a human opt-out, *regardless* of what
 * `triage` decided.
 *
 * Why this exists: `triage` follows the spec's first-match-wins order, in
 * which the machine-mail `ignore` rules (3-6 and 9) sit ABOVE the opt-out rule
 * (11). `ignore` means "never reply" — but it does NOT mean "stop the
 * sequence", so a message that is both list-stamped and an opt-out would be
 * ignored and the day-9 follow-up would still fire. That is the exact
 * per-email CAN-SPAM violation §2 exists to prevent.
 *
 * Anything that schedules a follow-up MUST consult this in addition to the
 * verdict. See the report note on amending the rule order.
 */
export function bodyRequestsOptOut(msg: InboundMessage): boolean {
  return detectOptOut(stripQuotedReply(msg.body).text)
}

// ---------------------------------------------------------------------------
// triage
// ---------------------------------------------------------------------------

/**
 * Classifies an inbound message from its headers. First match wins; the rule
 * numbers below are the spec's (§2) and the order is load-bearing.
 *
 * Note for the `classify` path: the caller must still treat
 * `sanitize(...).truncated` as an escalation signal (spec §4) before handing
 * the body to a model, and must apply the §3 action table to whatever the
 * model returns. `classify` means "a model may look at this", not "a model may
 * act on this".
 */
export function triage(msg: InboundMessage): TriageVerdict {
  const headers = msg.headers

  // --- 1. Null envelope sender -------------------------------------------
  // `Return-Path: <>` is how every conforming MTA marks a message that must
  // never be replied to, precisely so that bounces cannot bounce.
  const returnPath = getHeader(headers, "return-path")
  if (returnPath !== undefined && NULL_SENDER.test(returnPath)) {
    const dsn = parseDeliveryStatus(msg)
    return {
      action: "bounce",
      hard: dsn.hard,
      recipient: dsn.recipient,
      reason: dsn.determined
        ? `null envelope sender (Return-Path: <>); DSN status ${dsn.status ?? "inferred"} -> ${dsn.hard ? "hard" : "soft"}`
        : "null envelope sender (Return-Path: <>); no parseable status, defaulted to soft",
    }
  }

  // --- 2. Delivery status notification -----------------------------------
  const contentType = getHeaderAll(headers, "content-type").join(" ")
  const isDsn =
    (MULTIPART_REPORT.test(contentType) && REPORT_TYPE_DSN.test(contentType)) ||
    hasHeader(headers, "x-failed-recipients")
  if (isDsn) {
    const dsn = parseDeliveryStatus(msg)
    return {
      action: "bounce",
      hard: dsn.hard,
      recipient: dsn.recipient,
      reason: dsn.determined
        ? `delivery-status report; status ${dsn.status ?? "inferred"} -> ${dsn.hard ? "hard" : "soft"} bounce`
        : "delivery-status report with no parseable status, defaulted to soft",
    }
  }

  // --- 3. RFC 3834 Auto-Submitted ----------------------------------------
  // The one header an autoresponder is actually required to set. Anything
  // other than the literal `no` means a machine generated this.
  const autoSubmitted = getHeader(headers, "auto-submitted")
  if (autoSubmitted !== undefined) {
    const token = autoSubmitted.split(";")[0].trim().toLowerCase()
    if (token !== "no") {
      return {
        action: "ignore",
        reason: `Auto-Submitted: ${autoSubmitted || "(empty)"} (RFC 3834 autoresponder)`,
      }
    }
  }

  // --- 4. Mailing list / bulk mail ---------------------------------------
  for (const name of LIST_HEADERS) {
    if (hasHeader(headers, name)) {
      return { action: "ignore", reason: `list mail (${name} present)` }
    }
  }
  const precedence = getHeader(headers, "precedence")
  if (precedence !== undefined && BULK_PRECEDENCE.test(precedence)) {
    return { action: "ignore", reason: `Precedence: ${precedence}` }
  }

  // --- 5. Vendor autoresponder headers ------------------------------------
  for (const name of AUTORESPONDER_HEADERS) {
    if (hasHeader(headers, name)) {
      return {
        action: "ignore",
        reason: `autoresponder header ${name} present`,
      }
    }
  }

  // --- 6. Robot From addresses --------------------------------------------
  const fromHeader = getHeader(headers, "from")
  const fromAddress = extractAddress(fromHeader)
  if (fromAddress !== undefined) {
    const localPart = fromAddress.slice(0, fromAddress.lastIndexOf("@"))
    if (ROBOT_LOCAL_PART.test(localPart)) {
      return {
        action: "ignore",
        reason: `From local-part "${localPart}" is a no-reply/daemon address`,
      }
    }
  }

  // --- 7. Loop detection ---------------------------------------------------
  // The single thing standing between this app and a two-robot infinite mail
  // loop. Escalate with a distinct alarm reason and stop: a loop that is
  // merely ignored is a loop that nobody fixes.
  const loop = detectLoopSignal(msg)
  if (loop !== undefined) {
    return { action: "escalate", reason: loop }
  }

  // --- 8. Calendar invitation ----------------------------------------------
  // Most invites arrive as a text/calendar *part* inside a multipart message,
  // so the top-level Content-Type alone is not enough to see them.
  const isCalendarInvite =
    (CALENDAR_CONTENT_TYPE.test(contentType) &&
      CALENDAR_METHOD_REQUEST.test(contentType)) ||
    (CALENDAR_CONTENT_TYPE.test(msg.body) &&
      CALENDAR_METHOD_REQUEST.test(msg.body)) ||
    VCALENDAR_REQUEST.test(msg.body)
  if (isCalendarInvite) {
    return {
      action: "escalate",
      reason: "text/calendar; method=REQUEST — they sent a meeting invitation",
    }
  }

  // --- 9. Ticket-system subjects -------------------------------------------
  const subject = getHeader(headers, "subject") ?? ""
  for (const marker of TICKET_MARKERS) {
    if (marker.test(subject)) {
      return {
        action: "ignore",
        reason: `subject carries a ticket marker (${marker.source})`,
      }
    }
  }

  // --- 10. Sender is not the lead ------------------------------------------
  // A reply from an address we never contacted means the mail was forwarded.
  // Auto-replying would be cold-emailing a third party who never heard from
  // us — the worst complaint profile there is.
  const leadAddress =
    extractAddress(msg.leadEmail) ?? msg.leadEmail.trim().toLowerCase()
  if (fromAddress === undefined) {
    return {
      action: "escalate",
      reason:
        "no parseable From address; cannot confirm the sender is the lead",
    }
  }
  if (fromAddress !== leadAddress) {
    const sameDomain =
      domainOf(fromAddress) !== undefined &&
      domainOf(fromAddress) === domainOf(leadAddress)
    return {
      action: "escalate",
      reason: sameDomain
        ? `From ${fromAddress} differs from the lead address ${leadAddress} (same domain — probably a colleague, still a human decision)`
        : `From ${fromAddress} differs from the lead address ${leadAddress} (forwarded to a third party)`,
    }
  }

  // --- 11. Opt-out ----------------------------------------------------------
  // On the DE-QUOTED body. Quoted history contains our own message and, often,
  // a corporate GDPR footer; matching inside it would suppress leads who never
  // asked for anything. See lib/untrusted.ts.
  const dequoted = stripQuotedReply(msg.body)
  if (detectOptOut(dequoted.text)) {
    return {
      action: "suppress",
      reason: "body matches OPT_OUT_RE (CAN-SPAM opt-out or hostile reply)",
    }
  }

  // --- 12. Short negative replies -------------------------------------------
  if (isShortNegative(dequoted.text)) {
    return {
      action: "escalate",
      reason:
        "short reply containing a negative token — classifiers are least reliable here, never auto-send",
    }
  }

  // --- 13. Subject-only autoresponder heuristics ----------------------------
  for (const pattern of AUTORESPONDER_SUBJECTS) {
    if (pattern.test(subject)) {
      return {
        action: "escalate",
        reason: `subject looks like an autoresponder (${pattern.source}) but carries no Auto-Submitted header — degrading to a human, never to an auto-reply`,
      }
    }
  }

  // --- 14. Plain human reply ------------------------------------------------
  return {
    action: "classify",
    reason: "no deterministic rule matched; eligible for classification",
  }
}

// ---------------------------------------------------------------------------
// Outbound loop headers
// ---------------------------------------------------------------------------

/**
 * The headers every outgoing message must carry.
 *
 * `X-Loop: <mailbox>` always. If a message we sent ever comes back to us —
 * bounced, forwarded, or echoed by another robot — rule 7 sees our own marker
 * and halts instead of replying. This is the single thing that stops the
 * classic two-robot infinite loop, and it was missing from the original
 * design.
 *
 * `Auto-Submitted: auto-replied` on auto-replies (RFC 3834), so the *other*
 * side's triage can do the same for us. A conforming autoresponder will not
 * reply to it. Normal (human-scheduled) mail omits the header entirely, since
 * RFC 3834 makes `no` the default.
 *
 * Throws rather than returning something incomplete: a silently empty
 * `X-Loop:` disables loop detection, and a mailbox containing CR/LF is header
 * injection — an attacker-controlled mailbox string could otherwise append
 * `\r\nBcc: victim@...` to every outgoing message.
 */
export function outboundLoopHeaders(
  mailbox: string,
  isAutoReply: boolean
): Record<string, string> {
  if (/[\r\n]/.test(mailbox)) {
    throw new Error(
      "outboundLoopHeaders: mailbox contains CR/LF (header injection attempt)"
    )
  }

  const trimmed = mailbox.trim()
  if (trimmed.length === 0) {
    throw new Error(
      "outboundLoopHeaders: mailbox is empty; an empty X-Loop header disables loop detection"
    )
  }
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(trimmed)) {
    throw new Error(
      `outboundLoopHeaders: "${trimmed}" is not a bare email address`
    )
  }

  const headers: Record<string, string> = { "X-Loop": trimmed }
  if (isAutoReply) {
    headers["Auto-Submitted"] = "auto-replied"
  }
  return headers
}
