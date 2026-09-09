/**
 * Inbound mail: a persistent IMAP IDLE watcher, and the handler that turns one
 * received message into database effects.
 *
 * Spec §6. The shape that matters:
 *  - ONE long-lived IDLE connection per (mailbox, folder), not connect-poll-
 *    disconnect. Logging in every 60s risks `454 4.7.0 Too many login
 *    attempts`, and Gmail then locks the account out for hours.
 *  - `INBOX` **and** `[Gmail]/Spam`. A reply routed to spam is invisible
 *    otherwise, and a missed opt-out sitting in spam is still a CAN-SPAM
 *    violation when the day-9 follow-up fires.
 *  - Gmail drops idle connections around 29 minutes, so IDLE is broken and
 *    restarted on a timer and the connection is rebuilt with backoff.
 *  - If `UIDVALIDITY` changes, the mailbox is NOT reprocessed. Every UID is
 *    meaningless after a change; replaying them would be a burst of duplicate
 *    auto-replies, duplicate suppressions and duplicate classify tasks.
 *
 * The triage rules themselves live in `worker/triage.ts` and are not
 * reimplemented here. This module decides what to DO with a verdict.
 */

import { randomUUID } from "node:crypto"
import { ImapFlow } from "imapflow"

import {
  enqueue,
  getDb,
  getSetting,
  listMailboxes,
  logEvent,
  setSetting,
  type LeadRow,
  type MailboxRow,
  type MessageRow,
} from "./db.ts"
import { htmlToText } from "./untrusted.ts"
import {
  detectLoopSignal,
  extractAddress,
  getHeader,
  getHeaderAll,
  hasHeader,
  bodyRequestsOptOut,
  triage,
  type InboundMessage,
  type RawHeaders,
  type TriageVerdict,
} from "../worker/triage.ts"
import {
  markBounce,
  normalizeEmail,
  suppressAddress,
  tripCircuitBreaker,
  type SentMailHit,
  type SentMailSearcher,
} from "./mail-send.ts"

// ---------------------------------------------------------------------------
// RFC 5322 / MIME parsing
// ---------------------------------------------------------------------------

const HEADER_BODY_SPLIT = /\r?\n\r?\n/

/** Unfolds a header block and returns case-preserving multi-valued headers. */
export function parseHeaderBlock(block: string): RawHeaders {
  const unfolded: string[] = []
  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine.length === 0) continue
    if (/^[ \t]/.test(rawLine) && unfolded.length > 0) {
      // A folded continuation line. Per RFC 5322 the CRLF is removed and the
      // leading whitespace kept, which matters: a folded List-Unsubscribe or a
      // folded Content-Type parameter must survive intact or the triage rules
      // that key off them silently stop matching.
      unfolded[unfolded.length - 1] += ` ${rawLine.trim()}`
      continue
    }
    unfolded.push(rawLine)
  }

  const headers: Record<string, string | string[]> = {}
  for (const line of unfolded) {
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    const existing = headers[name]
    if (existing === undefined) {
      headers[name] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      headers[name] = [existing, value]
    }
  }
  return headers
}

function headerParam(
  value: string | undefined,
  name: string
): string | undefined {
  if (value === undefined) return undefined
  const re = new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i")
  const m = re.exec(value)
  if (m === null) return undefined
  return (m[1] ?? m[2])?.trim()
}

function decodeBytes(buf: Buffer, charset: string | undefined): string {
  const label = (charset ?? "utf-8").trim().toLowerCase()
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf)
  } catch {
    // Unknown charset label. latin1 never throws and never loses bytes, which
    // is what the opt-out regex needs — a decode failure that swallowed the
    // body would silently disable opt-out detection.
    return buf.toString("latin1")
  }
}

function decodeQuotedPrintable(input: string): Buffer {
  // Soft line breaks first. Without this, "remove=\r\nme" never matches the
  // opt-out regex, and a real opt-out is missed.
  const joined = input.replace(/=\r?\n/g, "")
  const out: number[] = []
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i]
    if (ch === "=" && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16))
        i += 2
        continue
      }
    }
    out.push(joined.charCodeAt(i) & 0xff)
  }
  return Buffer.from(out)
}

function decodePart(
  body: string,
  encoding: string | undefined,
  charset: string | undefined
): string {
  const enc = (encoding ?? "7bit").trim().toLowerCase()
  if (enc === "base64") {
    return decodeBytes(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset)
  }
  if (enc === "quoted-printable") {
    return decodeBytes(decodeQuotedPrintable(body), charset)
  }
  return decodeBytes(Buffer.from(body, "latin1"), charset)
}

interface ParsedPart {
  headers: RawHeaders
  body: string
}

function splitMessage(raw: string): ParsedPart {
  const match = HEADER_BODY_SPLIT.exec(raw)
  if (match === null || match.index === undefined) {
    return { headers: parseHeaderBlock(raw), body: "" }
  }
  return {
    headers: parseHeaderBlock(raw.slice(0, match.index)),
    body: raw.slice(match.index + match[0].length),
  }
}

/**
 * Best text rendering of a message body: the first `text/plain` part, else the
 * first `text/html` part run through `htmlToText`.
 *
 * This feeds the opt-out regex, so failing to find or decode the text is a
 * compliance failure, not a cosmetic one. Every fallback here errs towards
 * producing *some* text rather than an empty string.
 */
export function extractTextBody(headers: RawHeaders, body: string): string {
  const contentType = getHeader(headers, "content-type") ?? "text/plain"
  const encoding = getHeader(headers, "content-transfer-encoding")
  const charset = headerParam(contentType, "charset")

  // A delivery-status notification must be handed to triage WHOLE. Its
  // hard/soft verdict lives in the `message/delivery-status` part, and
  // reducing the message to its human-readable `text/plain` part would throw
  // that away — every bounce would then default to soft and dead addresses
  // would keep receiving follow-ups. DSNs are 7-bit ASCII by definition, so
  // returning the raw body loses nothing.
  if (/^\s*multipart\/report/i.test(contentType)) return body

  if (/^\s*multipart\//i.test(contentType)) {
    const boundary = headerParam(contentType, "boundary")
    if (boundary === undefined) {
      // Malformed multipart. Return the raw body rather than nothing: the
      // opt-out scan on slightly-mangled text still beats a scan on "".
      return body
    }
    const marker = `--${boundary}`
    const segments = body
      .split(new RegExp(`\\r?\\n?${escapeRegExp(marker)}(--)?\\r?\\n?`))
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)

    let htmlFallback: string | undefined
    for (const segment of segments) {
      const part = splitMessage(segment)
      const partType = getHeader(part.headers, "content-type") ?? ""
      if (/^\s*multipart\//i.test(partType)) {
        const nested = extractTextBody(part.headers, part.body)
        if (nested.trim().length > 0) return nested
        continue
      }
      const text = decodePart(
        part.body,
        getHeader(part.headers, "content-transfer-encoding"),
        headerParam(partType, "charset")
      )
      if (/^\s*text\/plain/i.test(partType) || partType === "") {
        if (text.trim().length > 0) return text
      } else if (/^\s*text\/html/i.test(partType)) {
        htmlFallback ??= htmlToText(text)
      }
    }
    return htmlFallback ?? ""
  }

  const decoded = decodePart(body, encoding, charset)
  if (/^\s*text\/html/i.test(contentType)) return htmlToText(decoded)
  return decoded
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export interface ParsedRawMessage {
  headers: RawHeaders
  /** Decoded text body, already HTML-flattened when necessary. */
  body: string
}

export function parseRawMessage(raw: string): ParsedRawMessage {
  const { headers, body } = splitMessage(raw)
  return { headers, body: extractTextBody(headers, body) }
}

// ---------------------------------------------------------------------------
// Per-folder IMAP state, and the UIDVALIDITY rule
// ---------------------------------------------------------------------------

export const INBOX_PATH = "INBOX"
export const SPAM_PATH = "[Gmail]/Spam"

export interface FolderState {
  uidValidity: number | null
  lastUid: number | null
  /** Nothing older than this instant is ever processed. */
  watermarkAt: number | null
}

export interface MailboxSnapshot {
  uidValidity: number
  uidNext: number
}

export type SyncPlan = {
  mode: "initial" | "resume" | "uidvalidity_reset"
  /** Lowest UID that may be fetched. */
  fromUid: number
  /** Nothing received before this instant may be processed. */
  watermarkAt: number
  uidValidity: number
  reason: string
}

/**
 * Decides what may be fetched from a folder, given what we saw last time.
 *
 * The rule that matters is the third one. **A changed `UIDVALIDITY` must not
 * cause the mailbox to be reprocessed** (spec §6). UIDs are only meaningful
 * within one UIDVALIDITY generation; after a change, every UID we have on
 * record points at a different message or at nothing. Re-walking the folder
 * would replay months of mail through the handler — a burst of duplicate
 * suppressions, duplicate classify tasks, and (worst) duplicate auto-replies
 * to people who wrote in once, weeks ago.
 *
 * So on a change: keep nothing, start at `uidNext`, and set a date watermark
 * so even a UID-based fetch cannot reach backwards.
 *
 * Pure. This is the function the UIDVALIDITY test targets.
 */
export function planMailboxSync(
  prev: FolderState,
  current: MailboxSnapshot,
  now: number
): SyncPlan {
  if (prev.uidValidity === null) {
    // First ever connect. Do not walk an existing inbox of unrelated mail:
    // start from the next UID and watermark at now.
    return {
      mode: "initial",
      fromUid: current.uidNext,
      watermarkAt: now,
      uidValidity: current.uidValidity,
      reason: "first connect to this folder; starting at uidNext, no backfill",
    }
  }

  if (prev.uidValidity !== current.uidValidity) {
    return {
      mode: "uidvalidity_reset",
      fromUid: current.uidNext,
      // Never move the watermark backwards, even if the clock did.
      watermarkAt: Math.max(prev.watermarkAt ?? 0, now),
      uidValidity: current.uidValidity,
      reason: `UIDVALIDITY changed ${prev.uidValidity} -> ${current.uidValidity}; every stored UID is now meaningless. NOT reprocessing — that would be a burst of duplicate handling. Starting at uidNext ${current.uidNext} behind a date watermark.`,
    }
  }

  const fromUid =
    prev.lastUid !== null ? prev.lastUid + 1 : Math.max(1, current.uidNext)
  return {
    mode: "resume",
    fromUid,
    watermarkAt: prev.watermarkAt ?? 0,
    uidValidity: current.uidValidity,
    reason: `resuming at uid ${fromUid} (UIDVALIDITY unchanged)`,
  }
}

/**
 * Folder state lives in `settings`, keyed per (mailbox, folder).
 *
 * `mailboxes.uidvalidity` / `last_uid` / `watermark_at` exist but there is one
 * set of them per mailbox, and we watch two folders per mailbox. INBOX's state
 * is mirrored into those columns for the UI; Spam's has nowhere else to live.
 */
function folderStateKey(mailboxId: string, folder: string): string {
  return `imap_state:${mailboxId}:${folder}`
}

export function loadFolderState(
  mailboxId: string,
  folder: string
): FolderState {
  const stored = getSetting<Partial<FolderState>>(
    folderStateKey(mailboxId, folder)
  )
  return {
    uidValidity:
      typeof stored?.uidValidity === "number" ? stored.uidValidity : null,
    lastUid: typeof stored?.lastUid === "number" ? stored.lastUid : null,
    watermarkAt:
      typeof stored?.watermarkAt === "number" ? stored.watermarkAt : null,
  }
}

export function saveFolderState(
  mailboxId: string,
  folder: string,
  state: FolderState
): void {
  setSetting(folderStateKey(mailboxId, folder), state)
  if (folder === INBOX_PATH) {
    getDb()
      .prepare(
        `UPDATE mailboxes
         SET uidvalidity = ?, last_uid = ?, watermark_at = ?, last_poll_at = ?
         WHERE id = ?`
      )
      .run(
        state.uidValidity,
        state.lastUid,
        state.watermarkAt,
        Date.now(),
        mailboxId
      )
  }
}

/**
 * Whether a message must be skipped because it predates the folder's
 * watermark.
 *
 * This is the second half of the UIDVALIDITY rule and the half that actually
 * protects us. After a UIDVALIDITY change the UID space restarts, so a stored
 * `lastUid` of 100 no longer excludes anything — the new generation's uid 7
 * is a different message entirely, and uids 1..6 may be years of old mail. The
 * date watermark is what keeps that history from being replayed through the
 * handler as a burst of duplicate suppressions and duplicate classify tasks.
 *
 * A message with no internal date is NOT skipped: better to handle an unknown
 * message once than to silently drop a live reply.
 */
export function shouldSkipByWatermark(
  state: FolderState,
  internalDate: number | null
): boolean {
  if (state.watermarkAt === null) return false
  if (internalDate === null) return false
  return internalDate < state.watermarkAt
}

/** Applies a plan to storage and returns the state that was written. */
export function applySyncPlan(
  mailboxId: string,
  folder: string,
  plan: SyncPlan
): FolderState {
  const state: FolderState = {
    uidValidity: plan.uidValidity,
    // `fromUid` is the first UID we MAY fetch, so the last one already handled
    // is one below it. Storing it this way keeps `resume` idempotent.
    lastUid: plan.fromUid - 1,
    watermarkAt: plan.watermarkAt,
  }
  saveFolderState(mailboxId, folder, state)
  if (plan.mode === "uidvalidity_reset") {
    logEvent("imap.uidvalidity_changed", {
      detail: { mailboxId, folder, plan },
    })
  }
  return state
}

// ---------------------------------------------------------------------------
// Lead matching
// ---------------------------------------------------------------------------

const OUTREACH_ID_ANYWHERE = /X-Outreach-Id:\s*([A-Za-z0-9._:-]{8,128})/i
const MESSAGE_ID_TOKENS = /<[^<>\s]+>/g

export interface LeadMatch {
  lead: LeadRow
  how: "outreach_id" | "in_reply_to" | "sender_address"
  /** The outbound row this inbound message answers, when known. */
  outboundRow?: MessageRow
}

/**
 * Finds the lead an inbound message belongs to.
 *
 * Three mechanisms, most reliable first:
 *
 * 1. `X-Outreach-Id` found anywhere in the raw source. Bounces and many
 *    autoresponders quote our original headers verbatim, and our own id is the
 *    one identifier Gmail cannot rewrite.
 * 2. `In-Reply-To` / `References` matched against `messages.message_id`. This
 *    only works if the stored Message-ID is the one that actually shipped —
 *    which is precisely why `reconcile()` overwrites it with the value read
 *    back from Sent Mail. If Gmail rewrites Message-ID on submission and we
 *    stored nodemailer's, every lookup here misses silently.
 * 3. The sender's address against `leads.email`.
 */
export function matchLeadForInbound(
  headers: RawHeaders,
  raw: string
): LeadMatch | null {
  const db = getDb()

  const outreachMatch = OUTREACH_ID_ANYWHERE.exec(raw)
  if (outreachMatch !== null) {
    const row = db
      .prepare(
        `SELECT * FROM messages WHERE outreach_id = ? AND direction = 'out' LIMIT 1`
      )
      .get(outreachMatch[1]) as MessageRow | undefined
    if (row) {
      const lead = db
        .prepare(`SELECT * FROM leads WHERE id = ?`)
        .get(row.lead_id) as LeadRow | undefined
      if (lead) return { lead, how: "outreach_id", outboundRow: row }
    }
  }

  const threadingRefs = [
    ...getHeaderAll(headers, "in-reply-to"),
    ...getHeaderAll(headers, "references"),
  ].join(" ")
  const ids = threadingRefs.match(MESSAGE_ID_TOKENS) ?? []
  for (const id of ids) {
    const row = db
      .prepare(
        `SELECT * FROM messages WHERE message_id = ? AND direction = 'out' LIMIT 1`
      )
      .get(id) as MessageRow | undefined
    if (row) {
      const lead = db
        .prepare(`SELECT * FROM leads WHERE id = ?`)
        .get(row.lead_id) as LeadRow | undefined
      if (lead) return { lead, how: "in_reply_to", outboundRow: row }
    }
  }

  const from = extractAddress(getHeader(headers, "from"))
  if (from !== undefined) {
    const lead = db
      .prepare(`SELECT * FROM leads WHERE lower(email) = ? LIMIT 1`)
      .get(from) as LeadRow | undefined
    if (lead) return { lead, how: "sender_address" }
  }

  return null
}

// ---------------------------------------------------------------------------
// Handling one inbound message
// ---------------------------------------------------------------------------

export interface InboundRecord {
  mailboxId: string
  mailboxEmail: string
  folder: string
  uidValidity: number
  uid: number
  internalDate: number | null
  gmThrid: string | null
  /** Full RFC822 source. Needed for the "X-Loop anywhere" scan. */
  raw: string
}

export type InboundAction =
  | "ignore"
  | "bounce"
  | "suppress"
  | "escalate"
  | "classify"
  | "duplicate"
  | "dropped_own_mail"
  | "unmatched"

export interface InboundResult {
  action: InboundAction
  reason: string
  leadId: string | null
  messageRowId: string | null
  suppressed: boolean
  /** Set when a loop signal was seen, regardless of the triage verdict. */
  loopAlarm?: string
  /** Set only when a `classify` task was enqueued. */
  taskId?: string
  /** The verdict `triage()` returned, for observability. */
  verdict?: TriageVerdict
}

export interface HandleInboundDeps {
  now?: () => number
  /** Defaults to every configured mailbox address. */
  ourMailboxes?: readonly string[]
}

function ourMailboxAddresses(deps: HandleInboundDeps): string[] {
  if (deps.ourMailboxes) {
    return deps.ourMailboxes.map((m) => normalizeEmail(m))
  }
  return listMailboxes().map((m) => normalizeEmail(m.email))
}

function inboundDedupeKey(record: InboundRecord): string {
  return `in:${record.mailboxId}:${record.uidValidity}:${record.uid}`
}

function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false
  const e = err as { errcode?: number; message?: string }
  if (e.errcode === 2067 || e.errcode === 1555) return true
  return (
    typeof e.message === "string" && /UNIQUE constraint failed/i.test(e.message)
  )
}

/**
 * Records the inbound message, deduping on BOTH `(mailbox, uidvalidity, uid)`
 * and `Message-ID` (spec §6).
 *
 * The UID key is stored in `outreach_id`, which carries a UNIQUE index. That
 * is a reuse of an outbound-shaped column, done deliberately: it buys a
 * structural, race-proof dedupe with no schema migration, and every outbound
 * lookup in this codebase filters on `direction = 'out'` so the two never
 * collide. The Message-ID check is a separate SELECT because a message legally
 * appears in both INBOX and `[Gmail]/Spam` with different UIDs and the same
 * Message-ID, and that is exactly the duplicate we need to catch.
 */
function recordInbound(
  record: InboundRecord,
  lead: LeadRow,
  headers: RawHeaders,
  body: string,
  now: number
): { rowId: string } | { duplicate: string } {
  const db = getDb()
  const messageId = getHeader(headers, "message-id") ?? null
  const dedupeKey = inboundDedupeKey(record)

  db.exec("BEGIN IMMEDIATE")
  try {
    if (messageId !== null) {
      const existing = db
        .prepare(
          `SELECT id FROM messages
           WHERE direction = 'in' AND message_id = ? LIMIT 1`
        )
        .get(messageId) as { id: string } | undefined
      if (existing) {
        db.exec("ROLLBACK")
        return {
          duplicate: `Message-ID ${messageId} was already handled (row ${existing.id}); this is the ${record.folder} copy`,
        }
      }
    }

    const rowId = randomUUID()
    db.prepare(
      `INSERT INTO messages
         (id, lead_id, mailbox_id, direction, sequence_step, subject, body,
          outreach_id, message_id, gm_thrid, in_reply_to, refs, status, created_at)
       VALUES (?, ?, ?, 'in', NULL, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`
    ).run(
      rowId,
      lead.id,
      record.mailboxId,
      getHeader(headers, "subject") ?? null,
      body,
      dedupeKey,
      messageId,
      record.gmThrid,
      getHeader(headers, "in-reply-to") ?? null,
      getHeaderAll(headers, "references").join(" ") || null,
      record.internalDate ?? now
    )
    db.exec("COMMIT")
    return { rowId }
  } catch (err) {
    db.exec("ROLLBACK")
    if (isUniqueViolation(err)) {
      return {
        duplicate: `uid ${record.uid} (uidvalidity ${record.uidValidity}) in ${record.folder} was already handled`,
      }
    }
    throw err
  }
}

function finishRow(rowId: string, status: string): void {
  getDb()
    .prepare(`UPDATE messages SET status = ? WHERE id = ?`)
    .run(status, rowId)
}

/**
 * Handles one received message end to end.
 *
 * Order is deliberate and each step is load-bearing:
 *  1. drop our own mail (spec §6),
 *  2. match a lead — an unmatched message is escalated, never auto-handled,
 *  3. dedupe,
 *  4. `triage()` for the verdict, `detectLoopSignal()` for the alarm,
 *  5. **the opt-out override** (see below),
 *  6. act.
 */
export function handleInboundMessage(
  record: InboundRecord,
  deps: HandleInboundDeps = {}
): InboundResult {
  const now = (deps.now ?? Date.now)()
  const { headers, body } = parseRawMessage(record.raw)
  const ours = ourMailboxAddresses(deps)

  // --- 1. Our own mail ------------------------------------------------------
  const from = extractAddress(getHeader(headers, "from"))
  if (from !== undefined && ours.includes(from)) {
    // `[Gmail]/All Mail` carries our own sends; INBOX and Spam normally do not,
    // so seeing one here is worth an alarm as well as a drop. It is NOT passed
    // any further: replying to ourselves is the first half of a mail loop.
    const alarm = `inbound From is one of our own mailboxes (${from}) in ${record.folder}`
    logEvent("inbound.loop_alarm", {
      detail: { mailboxId: record.mailboxId, folder: record.folder, from },
    })
    tripCircuitBreaker("auto_reply_burst", `LOOP ALARM: ${alarm}`, {
      folder: record.folder,
      from,
    })
    return {
      action: "dropped_own_mail",
      reason: alarm,
      leadId: null,
      messageRowId: null,
      suppressed: false,
      loopAlarm: alarm,
    }
  }

  // --- 2. Lead matching -----------------------------------------------------
  const match = matchLeadForInbound(headers, record.raw)
  if (match === null) {
    // Never auto-handle mail we cannot attribute. `messages.lead_id` is NOT
    // NULL, so there is nowhere to file it either; a human gets it.
    logEvent("inbound.unmatched", {
      detail: {
        mailboxId: record.mailboxId,
        folder: record.folder,
        from,
        subject: getHeader(headers, "subject"),
        uid: record.uid,
      },
    })
    return {
      action: "unmatched",
      reason: `no lead matched (from ${from ?? "unparseable"}) — escalated to the human queue`,
      leadId: null,
      messageRowId: null,
      suppressed: false,
    }
  }
  const lead = match.lead

  // --- 3. Dedupe ------------------------------------------------------------
  const recorded = recordInbound(record, lead, headers, body, now)
  if ("duplicate" in recorded) {
    return {
      action: "duplicate",
      reason: recorded.duplicate,
      leadId: lead.id,
      messageRowId: null,
      suppressed: false,
    }
  }
  const rowId = recorded.rowId

  // --- 4. Triage ------------------------------------------------------------
  const leadEmail = lead.email ?? from ?? ""
  const msg: InboundMessage = {
    headers,
    body,
    leadEmail,
    ourMailboxes: ours,
    raw: record.raw,
  }
  const verdict = triage(msg)

  // The loop alarm is raised independent of the verdict, because the spec's
  // rule order puts several `ignore` rules above loop detection and an
  // `ignore` verdict would swallow the alarm.
  const loopAlarm = detectLoopSignal(msg)
  if (loopAlarm !== undefined) {
    logEvent("inbound.loop_alarm", {
      leadId: lead.id,
      detail: { reason: loopAlarm, folder: record.folder },
    })
    // Severity split. A bounce quotes our original headers — including
    // `X-Loop` — so treating every quoted marker as a live loop would halt the
    // whole app on an ordinary hard bounce. Only a TOP-LEVEL `X-Loop` header
    // means our own message came back as a message, which is the real loop.
    if (hasHeader(headers, "x-loop") && verdict.action !== "bounce") {
      tripCircuitBreaker("auto_reply_burst", `LOOP ALARM: ${loopAlarm}`, {
        leadId: lead.id,
        folder: record.folder,
      })
    }
  }

  // --- 5. THE OPT-OUT OVERRIDE ----------------------------------------------
  // `triage()` follows the spec's first-match-wins order, in which the
  // machine-mail `ignore` rules sit ABOVE the opt-out rule. A message that is
  // both list-stamped and says "remove me" therefore returns `ignore`, which
  // stops the reply but NOT the day-9 follow-up — the exact per-email CAN-SPAM
  // violation §2 exists to prevent.
  //
  // triage() is not changed. Instead: whenever the sender IS the lead's own
  // contact address and `bodyRequestsOptOut()` is true, the lead is suppressed
  // regardless of the verdict.
  //
  // The scope to the lead's own address is what keeps this safe. Newsletter
  // footers all contain the word "unsubscribe", so an unscoped rule would
  // suppress a lead the moment any bulk mail from their domain arrived.
  const senderIsLead =
    from !== undefined &&
    lead.email !== null &&
    from === normalizeEmail(lead.email)
  const optOutOverride = senderIsLead && bodyRequestsOptOut(msg)

  // --- 6. Act ---------------------------------------------------------------
  if (verdict.action === "bounce") {
    // Record, suppress on hard, NEVER reply. A DSN has a null return path
    // precisely so that bounces cannot bounce.
    const outreachMatch = OUTREACH_ID_ANYWHERE.exec(record.raw)
    if (outreachMatch !== null) {
      markBounce(outreachMatch[1], verdict.hard)
    }
    logEvent("inbound.bounce", {
      leadId: lead.id,
      detail: {
        hard: verdict.hard,
        recipient: verdict.recipient,
        reason: verdict.reason,
      },
    })
    let suppressed = false
    if (verdict.hard) {
      const target = verdict.recipient ?? lead.email
      if (target) {
        suppressAddress(target, `hard bounce: ${verdict.reason}`, {
          leadId: lead.id,
        })
        suppressed = true
      }
      getDb()
        .prepare(
          `UPDATE leads SET status = 'dead' WHERE id = ? AND status != 'suppressed'`
        )
        .run(lead.id)
    }
    finishRow(rowId, `triaged:bounce:${verdict.hard ? "hard" : "soft"}`)
    return {
      action: "bounce",
      reason: verdict.reason,
      leadId: lead.id,
      messageRowId: rowId,
      suppressed,
      loopAlarm,
      verdict,
    }
  }

  if (optOutOverride || verdict.action === "suppress") {
    const reason = optOutOverride
      ? `opt-out from the lead's own address (${from}); triage said "${verdict.action}" but a follow-up would be a CAN-SPAM violation`
      : verdict.reason
    // suppressAddress cancels every pending task for the lead in the SAME
    // transaction as the suppression write (spec §7).
    suppressAddress(lead.email ?? from ?? "", reason, { leadId: lead.id })
    logEvent("inbound.suppressed", {
      leadId: lead.id,
      detail: { reason, override: optOutOverride, verdict: verdict.action },
    })
    finishRow(rowId, "triaged:suppress")
    return {
      action: "suppress",
      reason,
      leadId: lead.id,
      messageRowId: rowId,
      suppressed: true,
      loopAlarm,
      verdict,
    }
  }

  if (verdict.action === "escalate") {
    logEvent("inbound.escalate", {
      leadId: lead.id,
      detail: { reason: verdict.reason, folder: record.folder },
    })
    getDb()
      .prepare(
        `UPDATE leads SET status = 'replied'
         WHERE id = ? AND status IN ('new','enriching','ready','held','contacted')`
      )
      .run(lead.id)
    finishRow(rowId, "triaged:escalate")
    return {
      action: "escalate",
      reason: verdict.reason,
      leadId: lead.id,
      messageRowId: rowId,
      suppressed: false,
      loopAlarm,
      verdict,
    }
  }

  if (verdict.action === "classify") {
    // The ONLY path that enqueues a classify task. `classify` means "a model
    // may look at this", not "a model may act on it" — spec §3 restricts the
    // action set on the far side.
    getDb()
      .prepare(
        `UPDATE leads SET status = 'replied'
         WHERE id = ? AND status IN ('new','enriching','ready','held','contacted')`
      )
      .run(lead.id)
    const taskId = enqueue("classify", {
      leadId: lead.id,
      payload: { messageRowId: rowId, mailboxId: record.mailboxId },
    })
    logEvent("inbound.classify_enqueued", {
      leadId: lead.id,
      detail: { taskId, messageRowId: rowId },
    })
    finishRow(rowId, "triaged:classify")
    return {
      action: "classify",
      reason: verdict.reason,
      leadId: lead.id,
      messageRowId: rowId,
      suppressed: false,
      loopAlarm,
      taskId,
      verdict,
    }
  }

  // `ignore`: machine mail. Never replied to, never escalated, and it does not
  // count as engagement. The follow-up sequence continues untouched — which is
  // correct here ONLY because the opt-out override above already caught the
  // case where an ignored message was also an opt-out.
  logEvent("inbound.ignored", {
    leadId: lead.id,
    detail: { reason: verdict.reason, folder: record.folder },
  })
  finishRow(rowId, "triaged:ignore")
  return {
    action: "ignore",
    reason: verdict.reason,
    leadId: lead.id,
    messageRowId: rowId,
    suppressed: false,
    loopAlarm,
    verdict,
  }
}

// ---------------------------------------------------------------------------
// IMAP plumbing
// ---------------------------------------------------------------------------

export const IMAP_HOST = "imap.gmail.com"
export const IMAP_PORT = 993

function imapOptions(
  mailbox: MailboxRow
): ConstructorParameters<typeof ImapFlow>[0] {
  return {
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: mailbox.email, pass: mailbox.app_password },
    logger: false,
    // Gmail drops idle connections around 29 minutes. Breaking and restarting
    // IDLE a few minutes short of that keeps the connection alive without ever
    // re-authenticating, which is the whole point: repeated logins at a 60s
    // cadence are what earn `454 4.7.0 Too many login attempts`.
    maxIdleTime: 4 * 60 * 1000,
    socketTimeout: 10 * 60 * 1000,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    clientInfo: { name: "vending-outreach", version: "0.0.1" },
  }
}

/**
 * Resolves a special-use folder by its IMAP flag rather than by name.
 *
 * `[Gmail]/Sent Mail` and `[Gmail]/Spam` are the ENGLISH names. Gmail
 * localizes them (`[Gmail]/Enviados`, `[Google Mail]/Spam`, ...), so hardcoding
 * the English path makes reconciliation silently find nothing on a
 * non-English account — and "found nothing" means "safe to resend", i.e. a
 * duplicate cold email. The literal path is only a last-resort fallback.
 */
async function resolveSpecialFolder(
  client: ImapFlow,
  specialUse: string,
  fallback: string
): Promise<string> {
  try {
    const boxes = await client.list()
    const hit = boxes.find((b) => b.specialUse === specialUse)
    if (hit) return hit.path
  } catch {
    /* fall through to the literal path */
  }
  return fallback
}

function headerValueFrom(
  buffer: Buffer | undefined,
  name: string
): string | null {
  if (!buffer) return null
  const headers = parseHeaderBlock(buffer.toString("utf8"))
  return getHeader(headers, name) ?? null
}

/**
 * The IMAP-backed `SentMailSearcher` that `reconcile()` uses.
 *
 * Two lookups, and the second one is not optional. Gmail's IMAP `SEARCH
 * HEADER` does not reliably index arbitrary custom headers — it maps onto
 * Gmail's own search index, which ignores headers it does not know. If the
 * header search silently returns nothing, `reconcile()` reads that as "not
 * sent" and permits a resend: a false negative here manufactures the exact
 * duplicate this whole subsystem exists to prevent.
 *
 * So a miss falls back to fetching the recent Sent Mail window and matching
 * `X-Outreach-Id` in code. And any error is rethrown rather than swallowed,
 * so `reconcile()` reports `unknown` (which never retries) instead of
 * `not_sent` (which does).
 */
export function createImapSentMailSearcher(
  options: {
    /** How far back the fallback scan looks. Default 3 days. */
    fallbackWindowMs?: number
    /** Hard cap on the fallback scan. Default 500 messages. */
    fallbackMaxMessages?: number
  } = {}
): SentMailSearcher {
  const windowMs = options.fallbackWindowMs ?? 3 * 24 * 60 * 60 * 1000
  const maxMessages = options.fallbackMaxMessages ?? 500

  return {
    async find(
      mailbox: MailboxRow,
      outreachId: string
    ): Promise<SentMailHit | null> {
      const client = new ImapFlow(imapOptions(mailbox))
      await client.connect()
      try {
        const sentPath = await resolveSpecialFolder(
          client,
          "\\Sent",
          "[Gmail]/Sent Mail"
        )
        const lock = await client.getMailboxLock(sentPath, { readOnly: true })
        try {
          const uids = await client.search(
            { header: { "x-outreach-id": outreachId } },
            { uid: true }
          )
          const candidates = Array.isArray(uids) ? uids : []

          for (const uid of candidates) {
            const hit = await fetchAsHit(client, uid, outreachId)
            if (hit) return hit
          }

          // Fallback scan — see the note above; a false "not found" is how a
          // duplicate cold email happens.
          const since = new Date(Date.now() - windowMs)
          const recent = await client.search({ since }, { uid: true })
          const list = (Array.isArray(recent) ? recent : []).slice(-maxMessages)
          for (const uid of list) {
            const hit = await fetchAsHit(client, uid, outreachId)
            if (hit) return hit
          }
          return null
        } finally {
          lock.release()
        }
      } finally {
        await client.logout().catch(() => client.close())
      }
    },
  }
}

async function fetchAsHit(
  client: ImapFlow,
  uid: number,
  outreachId: string
): Promise<SentMailHit | null> {
  const message = await client.fetchOne(
    String(uid),
    {
      uid: true,
      envelope: true,
      internalDate: true,
      threadId: true,
      headers: ["x-outreach-id", "message-id"],
    },
    { uid: true }
  )
  if (!message || typeof message === "boolean") return null
  const found = headerValueFrom(message.headers, "x-outreach-id")
  if (found !== outreachId) return null
  return {
    outreachId,
    // AUTHORITATIVE Message-ID: read back from Sent Mail, never the one
    // nodemailer generated. Gmail may rewrite it on submission.
    messageId:
      headerValueFrom(message.headers, "message-id") ??
      message.envelope?.messageId ??
      null,
    gmThrid: message.threadId ?? null,
    uid: message.uid,
    internalDate: message.internalDate
      ? new Date(message.internalDate).getTime()
      : null,
  }
}

// ---------------------------------------------------------------------------
// The watcher
// ---------------------------------------------------------------------------

export interface WatcherOptions {
  /** Folders to watch. Spam is NOT optional — replies land there. */
  folders?: readonly string[]
  /** Called for every handled message; defaults to logging only. */
  onResult?: (result: InboundResult, record: InboundRecord) => void
  /** Backoff schedule for reconnects, in ms. */
  backoffMs?: readonly number[]
}

const DEFAULT_BACKOFF = [5_000, 15_000, 60_000, 300_000, 900_000] as const

/**
 * How long a connection has to survive before it counts as healthy and the
 * reconnect backoff resets. Anything shorter is treated as flapping.
 */
const CONNECTION_HEALTHY_MS = 2 * 60 * 1000

/**
 * One persistent IDLE connection per (mailbox, folder).
 *
 * IMAP allows exactly one selected mailbox per connection, so watching INBOX
 * and Spam means two connections per mailbox. That is well inside Gmail's
 * simultaneous-connection limit and vastly cheaper than the alternative of
 * re-selecting folders on a timer, which reintroduces the polling cadence this
 * design exists to avoid.
 */
export class MailWatcher {
  private readonly folders: readonly string[]
  private readonly onResult?: (
    result: InboundResult,
    record: InboundRecord
  ) => void
  private readonly backoff: readonly number[]
  private stopped = false
  private readonly connections = new Set<ImapFlow>()
  private readonly timers = new Set<NodeJS.Timeout>()

  constructor(options: WatcherOptions = {}) {
    this.folders = options.folders ?? [INBOX_PATH, SPAM_PATH]
    this.onResult = options.onResult
    this.backoff = options.backoffMs ?? DEFAULT_BACKOFF
  }

  /** Starts a watcher loop per (mailbox, folder). Resolves immediately. */
  start(mailboxes: readonly MailboxRow[] = listMailboxes()): void {
    this.stopped = false
    for (const mailbox of mailboxes) {
      if (mailbox.status === "disabled") continue
      for (const folder of this.folders) {
        void this.runFolderLoop(mailbox, folder)
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    const closing = [...this.connections].map(async (client) => {
      try {
        await client.logout()
      } catch {
        client.close()
      }
    })
    this.connections.clear()
    await Promise.allSettled(closing)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer)
        resolve()
      }, ms)
      this.timers.add(timer)
    })
  }

  private async runFolderLoop(
    mailbox: MailboxRow,
    folder: string
  ): Promise<void> {
    let attempt = 0
    while (!this.stopped) {
      const startedAt = Date.now()
      try {
        await this.watchFolder(mailbox, folder)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logEvent("imap.connection_error", {
          detail: { mailboxId: mailbox.id, folder, reason },
        })
      }
      if (this.stopped) return

      // The backoff applies to a CLEAN close as well as to an error. A server
      // that accepts the login and then drops the connection immediately —
      // which is one of the shapes Gmail rate limiting takes — would otherwise
      // produce a tight reconnect loop of successful logins, and repeated
      // logins are exactly what earn `454 4.7.0 Too many login attempts` and a
      // multi-hour lockout.
      //
      // Only a connection that actually stayed up resets the backoff, so a
      // flapping connection escalates instead of hammering.
      if (Date.now() - startedAt > CONNECTION_HEALTHY_MS) attempt = 0
      const wait = this.backoff[Math.min(attempt, this.backoff.length - 1)]
      attempt++
      await this.sleep(wait)
    }
  }

  private async watchFolder(
    mailbox: MailboxRow,
    folder: string
  ): Promise<void> {
    const client = new ImapFlow(imapOptions(mailbox))
    this.connections.add(client)
    // An 'error' event with no listener is an unhandled exception that takes
    // the whole worker process down.
    client.on("error", () => {
      /* surfaced by the awaited calls below */
    })

    try {
      await client.connect()
      const box = await client.mailboxOpen(folder)
      const plan = planMailboxSync(
        loadFolderState(mailbox.id, folder),
        { uidValidity: Number(box.uidValidity), uidNext: box.uidNext },
        Date.now()
      )
      applySyncPlan(mailbox.id, folder, plan)
      logEvent("imap.folder_opened", {
        detail: {
          mailboxId: mailbox.id,
          folder,
          mode: plan.mode,
          reason: plan.reason,
        },
      })

      // Catch anything that arrived while we were disconnected, then let IDLE
      // drive from here.
      await this.drain(client, mailbox, folder)

      let pending = false
      client.on("exists", () => {
        if (pending) return
        pending = true
        void this.drain(client, mailbox, folder)
          .catch((err: unknown) => {
            logEvent("imap.drain_error", {
              detail: {
                mailboxId: mailbox.id,
                folder,
                reason: err instanceof Error ? err.message : String(err),
              },
            })
          })
          .finally(() => {
            pending = false
          })
      })

      // Block until the connection dies; imapflow keeps IDLE alive and
      // restarts it every `maxIdleTime`.
      await new Promise<void>((resolve) => {
        client.on("close", () => resolve())
        if (this.stopped) resolve()
      })
    } finally {
      this.connections.delete(client)
      try {
        client.close()
      } catch {
        /* already closed */
      }
    }
  }

  /** Fetches and handles everything above the stored watermark. */
  private async drain(
    client: ImapFlow,
    mailbox: MailboxRow,
    folder: string
  ): Promise<void> {
    const state = loadFolderState(mailbox.id, folder)
    const fromUid = (state.lastUid ?? 0) + 1
    const messages = await client.fetchAll(
      `${fromUid}:*`,
      { uid: true, source: true, internalDate: true, threadId: true },
      { uid: true }
    )

    let highest = state.lastUid ?? 0
    for (const message of messages) {
      if (message.uid < fromUid) continue
      const internalDate = message.internalDate
        ? new Date(message.internalDate).getTime()
        : null
      // The date watermark is what makes a UIDVALIDITY reset safe: even if a
      // UID range slips through, nothing older than the reset instant is ever
      // processed.
      if (shouldSkipByWatermark(state, internalDate)) {
        highest = Math.max(highest, message.uid)
        continue
      }
      if (!message.source) {
        highest = Math.max(highest, message.uid)
        continue
      }

      const record: InboundRecord = {
        mailboxId: mailbox.id,
        mailboxEmail: mailbox.email,
        folder,
        uidValidity: Number(state.uidValidity ?? 0),
        uid: message.uid,
        internalDate,
        gmThrid: message.threadId ?? null,
        raw: message.source.toString("utf8"),
      }

      try {
        const result = handleInboundMessage(record)
        this.onResult?.(result, record)
      } catch (err) {
        // One malformed message must not stall the folder forever. Record it
        // and move the watermark past it; a stuck watermark means every later
        // reply is invisible too.
        logEvent("inbound.handler_error", {
          detail: {
            mailboxId: mailbox.id,
            folder,
            uid: message.uid,
            reason: err instanceof Error ? err.message : String(err),
          },
        })
      }
      highest = Math.max(highest, message.uid)
    }

    if (highest > (state.lastUid ?? 0)) {
      saveFolderState(mailbox.id, folder, { ...state, lastUid: highest })
    }
  }
}
