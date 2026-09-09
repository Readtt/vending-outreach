/**
 * Outbound mail.
 *
 * This module physically sends email to real businesses from the user's own
 * Gmail account. Every guard in here exists because of a specific way this
 * can go wrong; the comments say which one. Do not "simplify" a guard away
 * without reading the reason first.
 *
 * What lives here:
 *  - `Transport` + `FileTransport` (default) + `SmtpTransport` (opt-in only)
 *  - `buildMime` — plain text, no HTML, no images, no tracking pixel
 *  - `sendMessage` — the idempotency protocol from spec §5
 *  - `reconcile` — the only thing standing between the user and duplicate
 *    cold emails after an ambiguous SMTP failure
 *  - `classifySmtpError` — spec §5's error table
 *  - `canSendNow` — the AUTHORITATIVE rate limiter (scheduling is advisory)
 *  - `checkCircuitBreakers` — halt-everything conditions
 *
 * ---------------------------------------------------------------------------
 * DRY RUN
 * ---------------------------------------------------------------------------
 * A dry-run send writes an `.eml` and still records a `messages` row with
 * status='sent', flagged by the `dry_run` column. That is deliberate: the dry
 * run has to exercise the *real* idempotency and pacing paths, and those are
 * keyed off rows existing.
 *
 * Rehearsals and real sends occupy separate uniqueness namespaces (migration
 * 3): `ux_msg_step_dryrun` vs `ux_msg_step` for a sequence step, and a
 * `dryrun:`-prefixed dedupe key vs the bare one for an off-sequence send. So a
 * rehearsal never consumes the real send's slot — dry-running the first 200
 * leads used to burn them permanently — while a repeated rehearsal still
 * reports `duplicate` exactly as a repeated real send does, and rehearsing
 * something that already went out for real is refused outright.
 *
 * `countSentToday` counts dry-run rows, deliberately, so the daily cap and the
 * warm-up ramp are exercised faithfully. That only holds because the count is
 * bounded: one row per step per lead per namespace. Do not relax either index
 * without revisiting it.
 *
 * `clearDryRunMessages()` / `countDryRunMessages()` remain for tidying up
 * before going live. Nothing is blocked if you forget, but the rows do consume
 * the derived daily count.
 */

import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import nodemailer from "nodemailer"

import {
  countSentToday,
  getDb,
  getMailboxById,
  getSetting,
  isSuppressed,
  listMailboxes,
  logEvent,
  setSetting,
  type MailboxRow,
  type MessageRow,
} from "./db.ts"
import {
  isUsFederalHoliday,
  isWithinSendWindow,
  localMidnightEpochMs,
  nextSendWindowStart,
  type SendWindowRules,
} from "./time.ts"
import {
  bodyRequestsOptOut,
  outboundLoopHeaders,
  type InboundMessage,
} from "../worker/triage.ts"

// ---------------------------------------------------------------------------
// Message row status vocabulary
// ---------------------------------------------------------------------------

/**
 * `messages.status` for outbound rows. The whole idempotency protocol is a
 * state machine over these four values, so they are named here rather than
 * spelled inline at each call site.
 *
 * - `sending`   the row exists, SMTP may or may not have accepted it. NOBODY
 *               may retry a row in this state — only `reconcile` may move it.
 * - `sent`      confirmed handed to the MTA. Terminal.
 * - `retryable` positively known NOT to have been delivered. Exactly one more
 *               attempt is allowed (see MAX_SEND_ATTEMPTS).
 * - `failed`    terminal failure; no further attempts.
 */
export type OutboundStatus = "sending" | "sent" | "retryable" | "failed"

/**
 * Total attempts allowed per (lead, sequence step). Spec §5: "Not found ->
 * exactly one resend." One initial attempt plus one resend = 2.
 */
export const MAX_SEND_ATTEMPTS = 2

/**
 * Bookkeeping kept in `messages.error`, which is a free TEXT column we own.
 * It lives here rather than in dedicated columns because it is per-attempt
 * diagnostic detail with no schema of its own.
 *
 * Deliberately NOT here: dry-run state. That was once `{"dryRun":true}` in
 * this record, which meant a real error string and a dry-run marker competed
 * for the same column, and uniqueness could not key off it. It is the
 * `messages.dry_run` column now (migration 3).
 */
interface SendAttemptRecord {
  attempts: number
  step: number | null
  lastKind?: SmtpErrorKind
  lastDetail?: string
  bounce?: "hard" | "soft"
  bounceStatus?: string
}

function readAttemptRecord(row: Pick<MessageRow, "error">): SendAttemptRecord {
  if (!row.error) return { attempts: 0, step: null }
  try {
    const parsed: unknown = JSON.parse(row.error)
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Partial<SendAttemptRecord>
      return {
        attempts: typeof record.attempts === "number" ? record.attempts : 0,
        step: typeof record.step === "number" ? record.step : null,
        lastKind: record.lastKind,
        lastDetail: record.lastDetail,
        bounce: record.bounce,
        bounceStatus: record.bounceStatus,
      }
    }
  } catch {
    // A plain (non-JSON) error string, from an older row or another module.
    // Treat it as "one attempt already happened" — the conservative reading.
    return { attempts: 1, step: null, lastDetail: row.error }
  }
  return { attempts: 0, step: null }
}

// ---------------------------------------------------------------------------
// Pacing configuration
// ---------------------------------------------------------------------------

/**
 * Send pacing. The first six fields share the `settings` row that the
 * Settings UI writes (`app/settings/data.ts`, key `"sending"`); the rest are
 * send-layer policy the UI does not expose. Defaults are duplicated rather
 * than imported because the worker runs as plain Node with no `@/` alias.
 */
export interface PacingConfig {
  emailsPerDay: number
  sendGapMinMinutes: number
  sendGapMaxMinutes: number
  windowStartHour: number
  windowEndHour: number
  weekdaysOnly: boolean
  /**
   * IANA zone used for "which day is it" when counting the daily cap. This is
   * the OPERATOR's day, not the recipient's: the cap protects the user's own
   * Gmail account, whose quota resets on its own clock. The send *window* is
   * evaluated in the recipient's zone instead — different question, different
   * zone. Spec §7 does not distinguish the two; this is the resolution.
   */
  operatorTimezone: string
  /** Warm-up: emails/day on the first day with any sending activity. */
  warmupStartPerDay: number
  /** Warm-up: multiplier per day WITH ACTUAL SENDING ACTIVITY (not calendar days). */
  warmupGrowthPerActiveDay: number
  /** Spec §5: a send task whose run_after is older than this does not fire. */
  catchUpGraceMs: number
  /** How many steps the planned outreach sequence has (circuit breaker #2). */
  plannedSequenceSteps: number
}

function systemTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && zone.length > 0 ? zone : "America/New_York"
  } catch {
    return "America/New_York"
  }
}

export const DEFAULT_PACING: PacingConfig = {
  emailsPerDay: 25,
  sendGapMinMinutes: 6,
  sendGapMaxMinutes: 20,
  windowStartHour: 9,
  windowEndHour: 16,
  weekdaysOnly: true,
  operatorTimezone: systemTimezone(),
  warmupStartPerDay: 5,
  warmupGrowthPerActiveDay: 1.2,
  catchUpGraceMs: 45 * 60 * 1000,
  plannedSequenceSteps: 3,
}

const SENDING_SETTINGS_KEY = "sending"
const OPERATOR_TZ_KEY = "operator_timezone"

/** Merges stored settings over the defaults. Never throws on a malformed row. */
export function getPacingConfig(
  overrides: Partial<PacingConfig> = {}
): PacingConfig {
  let stored: Partial<PacingConfig> = {}
  let operatorTimezone: string | undefined
  try {
    stored = getSetting<Partial<PacingConfig>>(SENDING_SETTINGS_KEY) ?? {}
    operatorTimezone = getSetting<string>(OPERATOR_TZ_KEY)
  } catch {
    // A settings read must never be the reason a send crashes, and the
    // defaults are the conservative values anyway.
    stored = {}
  }
  return {
    ...DEFAULT_PACING,
    ...(operatorTimezone ? { operatorTimezone } : {}),
    ...stored,
    ...overrides,
  }
}

function windowRules(pacing: PacingConfig): SendWindowRules {
  return {
    startHour: pacing.windowStartHour,
    endHour: pacing.windowEndHour,
    weekdaysOnly: pacing.weekdaysOnly,
  }
}

// ---------------------------------------------------------------------------
// The send-enabled flag (spec §0.1) and the STOP file (spec §1)
// ---------------------------------------------------------------------------

const SEND_ENABLED_KEY = "send_enabled"

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true
  }
  // Anything else — including a typo — is "off". A misspelled env var must
  // never be the thing that turns real sending on.
  return false
}

/**
 * Whether real SMTP is permitted. Defaults to FALSE.
 *
 * Two independent controls, because they answer different questions:
 *  - the DB setting `send_enabled` is the user's UI toggle (spec §0.1);
 *  - the env var `SEND_ENABLED` is the ops control, and setting it explicitly
 *    to a false value is a HARD VETO that overrides the UI. That ordering is
 *    what makes `SEND_ENABLED=false node worker/main.mjs` a usable kill switch
 *    on a machine whose database says otherwise.
 *
 * Never read this at a call site — `createTransport` reads it, so a caller
 * cannot reach SMTP by forgetting a check.
 */
export function isSendEnabled(): boolean {
  const env = envFlag("SEND_ENABLED")
  if (env === false) return false
  let dbEnabled = false
  try {
    dbEnabled = getSetting<boolean>(SEND_ENABLED_KEY) === true
  } catch {
    dbEnabled = false
  }
  return env === true || dbEnabled
}

/** Sets the UI-facing send toggle. */
export function setSendEnabled(enabled: boolean): void {
  setSetting(SEND_ENABLED_KEY, enabled === true)
  logEvent("send.enabled_changed", { detail: { enabled: enabled === true } })
}

function stopFilePath(): string {
  return process.env.VENDING_STOP_FILE?.trim() || path.resolve("STOP")
}

/**
 * Spec §1: a STOP file on disk halts everything. Checked in the send path too,
 * not only in the worker loop — the user needs a kill switch that works when
 * the loop itself is the broken thing.
 */
export function isStopFilePresent(): boolean {
  try {
    return fs.existsSync(stopFilePath())
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// The outgoing message shape
// ---------------------------------------------------------------------------

/**
 * A message ready for a transport.
 *
 * Note what is NOT here: no `html`, no `attachments`, no `alternatives`. The
 * spec requires plain text only, with no tracking pixel and no images.
 * Leaving the fields out of the type means nobody can add one later by
 * accident.
 */
export interface OutgoingMessage {
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly headers: Readonly<Record<string, string>>
  readonly inReplyTo?: string
  readonly references?: string
  readonly replyTo?: string
  readonly envelopeFrom: string
  readonly envelopeTo: string
}

export interface TransportSendResult {
  /**
   * The Message-ID nodemailer put on the wire.
   *
   * ### BLOCKED ITEM — DO NOT TRUST THIS VALUE (spec §5, "Threading")
   * Gmail may rewrite `Message-ID` on SMTP submission. If it does, a follow-up
   * that sets `In-Reply-To` to this value points at an ID that never existed:
   * threading breaks and bounce attribution fails, both silently, with no
   * error raised anywhere. We have no Gmail credentials yet, so this is
   * untested and must be verified empirically before follow-up logic ships.
   *
   * Therefore: the Message-ID read back from `[Gmail]/Sent Mail` is the ONLY
   * authoritative one (see `reconcile`), and correlation is always on our own
   * `X-Outreach-Id`. This field is stored for diagnostics and is overwritten
   * by whatever reconciliation finds.
   */
  readonly generatedMessageId: string | null
  readonly response: string
  readonly accepted: readonly string[]
  readonly rejected: readonly string[]
  /** FileTransport only: the `.eml` that was written. */
  readonly artifactPath?: string
}

export type TransportKind = "smtp" | "file"

export interface Transport {
  readonly kind: TransportKind
  send(message: OutgoingMessage): Promise<TransportSendResult>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Header-injection guards
// ---------------------------------------------------------------------------

function assertNoCrlf(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    // A newline in any header value appends attacker-chosen headers to the
    // message (`\r\nBcc: victim@...`). Subject and recipient both originate
    // in scraped or model-adjacent data.
    throw new Error(`buildMime: ${field} contains CR/LF (header injection)`)
  }
}

const BARE_ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

function assertBareAddress(value: string, field: string): void {
  assertNoCrlf(value, field)
  if (!BARE_ADDRESS_RE.test(value.trim())) {
    throw new Error(
      `buildMime: ${field} ("${value}") is not a bare email address`
    )
  }
}

// ---------------------------------------------------------------------------
// buildMime
// ---------------------------------------------------------------------------

export interface BuildMimeInput {
  /** The sending mailbox address. Also the X-Loop value. */
  from: string
  /** Optional display name. */
  fromName?: string
  to: string
  subject: string
  /** Plain text body. No HTML part is ever produced. */
  text: string
  outreachId: string
  isAutoReply: boolean
  /**
   * TRUE ONLY IF THE RECIPIENT ACTUALLY REPLIED to the message being threaded
   * onto. Spec §5: a `Re:` on a message they never answered is a deceptive
   * subject line under CAN-SPAM. Threading headers are kept either way; only
   * the visible `Re:` is gated.
   */
  recipientReplied: boolean
  inReplyTo?: string | null
  references?: readonly string[]
  replyTo?: string
}

const LEADING_REPLY_PREFIX =
  /^\s*(?:(?:re|aw|sv|antw|res|fwd?|fw|tr|vs)\s*(?:\[\d+\])?\s*:\s*)+/i

/**
 * Builds the outgoing message. Plain text only, threading via
 * In-Reply-To/References, `X-Outreach-Id` plus the loop headers always set.
 */
export function buildMime(input: BuildMimeInput): OutgoingMessage {
  const from = input.from.trim()
  const to = input.to.trim()
  assertBareAddress(from, "from")
  assertBareAddress(to, "to")
  assertNoCrlf(input.subject, "subject")
  if (input.fromName !== undefined) assertNoCrlf(input.fromName, "fromName")
  if (input.replyTo !== undefined) assertBareAddress(input.replyTo, "replyTo")

  const outreachId = input.outreachId.trim()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(outreachId)) {
    // The id goes on the wire as a header AND into an IMAP SEARCH string.
    // Anything outside this alphabet is either a bug or an injection attempt.
    throw new Error(
      `buildMime: outreachId "${input.outreachId}" is not a safe token`
    )
  }

  const trimmedSubject = input.subject.trim()
  const bareSubject = trimmedSubject.replace(LEADING_REPLY_PREFIX, "").trim()

  // CAN-SPAM: `Re:` is only honest when they replied. When they did not, any
  // `Re:`/`Fwd:` the caller happened to pass through is STRIPPED rather than
  // trusted — callers build follow-up subjects by copying the previous step's
  // subject, which is exactly how a stray `Re:` gets onto a message the
  // recipient never answered.
  const subject = input.recipientReplied
    ? `Re: ${bareSubject || trimmedSubject}`
    : bareSubject || trimmedSubject

  const headers: Record<string, string> = {
    // Our correlation id. This, not Message-ID, is what reconciliation
    // searches on, because Gmail may rewrite Message-ID (see above).
    //
    // Note the wire form is `X-Outreach-ID` — nodemailer normalises header
    // name casing on output. Header names are case-insensitive in RFC 5322 and
    // in IMAP SEARCH, and every lookup in this codebase is case-insensitive
    // (`getHeader`, the `/i` regex in mail-receive, the IMAP header search), so
    // this is safe. Do not "fix" it by string-matching the exact casing.
    "X-Outreach-Id": outreachId,
    // Throws on an empty/malformed mailbox rather than shipping a header that
    // silently disables loop detection.
    ...outboundLoopHeaders(from, input.isAutoReply),
  }

  const references =
    input.references && input.references.length > 0
      ? input.references
          .map((r) => r.trim())
          .filter((r) => r.length > 0)
          .join(" ")
      : undefined
  if (references !== undefined) assertNoCrlf(references, "references")
  const inReplyTo = input.inReplyTo?.trim() || undefined
  if (inReplyTo !== undefined) assertNoCrlf(inReplyTo, "inReplyTo")

  return {
    from: input.fromName
      ? `${sanitizeDisplayName(input.fromName)} <${from}>`
      : from,
    to,
    subject,
    text: input.text,
    headers,
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    ...(references !== undefined ? { references } : {}),
    ...(input.replyTo !== undefined ? { replyTo: input.replyTo.trim() } : {}),
    // Explicit envelope so the Return-Path is unambiguously ours and bounces
    // come back to a mailbox we actually watch.
    envelopeFrom: from,
    envelopeTo: to,
  }
}

function sanitizeDisplayName(name: string): string {
  const clean = name.replace(/["\\]/g, "").trim()
  return `"${clean}"`
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

interface NodemailerOptions {
  from: string
  to: string
  subject: string
  text: string
  headers: Record<string, string>
  inReplyTo?: string
  references?: string
  replyTo?: string
  envelope: { from: string; to: string }
}

function toNodemailerOptions(message: OutgoingMessage): NodemailerOptions {
  return {
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    headers: { ...message.headers },
    ...(message.inReplyTo !== undefined
      ? { inReplyTo: message.inReplyTo }
      : {}),
    ...(message.references !== undefined
      ? { references: message.references }
      : {}),
    ...(message.replyTo !== undefined ? { replyTo: message.replyTo } : {}),
    envelope: { from: message.envelopeFrom, to: message.envelopeTo },
  }
}

/**
 * Renders the exact MIME bytes nodemailer would put on the wire, without a
 * socket. `streamTransport` has no network code path at all, which is what
 * makes the dry run trustworthy rather than merely well-intentioned.
 */
async function renderMime(message: OutgoingMessage): Promise<{
  raw: Buffer
  messageId: string | null
}> {
  const streamer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  })
  const info = await streamer.sendMail(toNodemailerOptions(message))
  const raw = Buffer.isBuffer(info.message)
    ? info.message
    : Buffer.from(String(info.message))
  return { raw, messageId: info.messageId ?? null }
}

export const DEFAULT_DRYRUN_DIR = "outbox-dryrun"

function dryRunDir(): string {
  return (
    process.env.OUTBOX_DRYRUN_DIR?.trim() || path.resolve(DEFAULT_DRYRUN_DIR)
  )
}

/**
 * THE DEFAULT TRANSPORT. Writes a `.eml` to `./outbox-dryrun/` and touches no
 * network. Spec §0.1.
 */
export class FileTransport implements Transport {
  readonly kind: TransportKind = "file"
  private readonly dir: string

  constructor(dir: string = dryRunDir()) {
    this.dir = dir
  }

  async send(message: OutgoingMessage): Promise<TransportSendResult> {
    const { raw, messageId } = await renderMime(message)
    await fs.promises.mkdir(this.dir, { recursive: true })
    const outreachId = message.headers["X-Outreach-Id"] ?? randomUUID()
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const file = path.join(this.dir, `${stamp}-${outreachId}.eml`)
    await fs.promises.writeFile(file, raw)
    return {
      generatedMessageId: messageId,
      response: "250 2.0.0 OK (dry run: written to disk, nothing was sent)",
      accepted: [message.envelopeTo],
      rejected: [],
      artifactPath: file,
    }
  }

  async close(): Promise<void> {
    /* nothing to close */
  }
}

/**
 * Module-private capability token. `SmtpTransport` cannot be constructed
 * without it, and only `createTransport` — which checks `isSendEnabled()` —
 * holds it. This is what makes "nothing reaches SMTP until the user turns it
 * on" structural rather than a convention someone can forget.
 */
const SMTP_UNLOCK: unique symbol = Symbol("smtp-transport-unlock")
type SmtpUnlock = typeof SMTP_UNLOCK

export const SMTP_HOST = "smtp.gmail.com"
export const SMTP_PORT = 587

/**
 * The slice of nodemailer's transporter this module uses. Declared
 * structurally rather than as `nodemailer.Transporter`, whose type parameter
 * defaults to `any` and would leak that `any` outwards.
 */
interface NodemailerTransporter {
  sendMail(options: NodemailerOptions): Promise<{
    messageId?: string
    response?: string
    accepted?: unknown[]
    rejected?: unknown[]
  }>
  close(): void
}

/** Real SMTP over STARTTLS. Only `createTransport` can build one. */
export class SmtpTransport implements Transport {
  readonly kind: TransportKind = "smtp"
  private readonly transporter: NodemailerTransporter
  private readonly mailboxEmail: string

  constructor(mailbox: MailboxRow, unlock: SmtpUnlock) {
    if (unlock !== SMTP_UNLOCK) {
      throw new Error(
        "SmtpTransport cannot be constructed directly. Use createTransport(), " +
          "which refuses to build one unless SEND_ENABLED is on."
      )
    }
    if (!mailbox.app_password) {
      throw new Error(
        `SmtpTransport: mailbox ${mailbox.email} has no app password`
      )
    }
    this.mailboxEmail = mailbox.email
    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      // STARTTLS: connect in the clear on 587, then require the upgrade.
      // `requireTLS` makes a server that fails to offer STARTTLS an error
      // rather than a silent plaintext submission of the app password.
      secure: false,
      requireTLS: true,
      auth: { user: mailbox.email, pass: mailbox.app_password },
      tls: { minVersion: "TLSv1.2", servername: SMTP_HOST },
      // No pooling: one connection per send. A pool keeps a socket open across
      // the jitter gap and turns a single auth failure into a reconnect storm
      // against a possibly-locked account.
      pool: false,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
    })
  }

  async send(message: OutgoingMessage): Promise<TransportSendResult> {
    const info = await this.transporter.sendMail(toNodemailerOptions(message))
    return {
      generatedMessageId:
        typeof info.messageId === "string" ? info.messageId : null,
      response: typeof info.response === "string" ? info.response : "",
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
    }
  }

  async close(): Promise<void> {
    this.transporter.close()
  }

  toString(): string {
    return `SmtpTransport(${this.mailboxEmail})`
  }
}

/**
 * THE ONLY place `isSendEnabled()` is read.
 *
 * Callers ask for a transport and get whatever the flag says they may have.
 * There is no call site that can decide to send for real, and no way to obtain
 * an `SmtpTransport` except through this function.
 */
export function createTransport(mailbox: MailboxRow): Transport {
  if (!isSendEnabled()) return new FileTransport()
  // Belt and braces: the STOP file must beat a stale `send_enabled` setting.
  if (isStopFilePresent()) return new FileTransport()
  return new SmtpTransport(mailbox, SMTP_UNLOCK)
}

// ---------------------------------------------------------------------------
// SMTP error classification (spec §5 table)
// ---------------------------------------------------------------------------

export type SmtpErrorKind =
  | "auth_revoked"
  | "daily_limit"
  | "rate_limit"
  | "bad_recipient"
  | "pre_data_socket"
  | "post_data_ambiguous"
  | "permanent"
  | "temporary"
  | "unknown"

export type SmtpErrorAction =
  /** Add the recipient to the suppression list; never contact again. */
  | "suppress_recipient"
  /** Definitely not delivered. Requeue. */
  | "retry"
  /** Might have been delivered. IMAP-search Sent Mail before doing anything. */
  | "reconcile"
  /** App password revoked: stop every mailbox and alert. Never retry. */
  | "hard_stop_all_mailboxes"
  /** Temporary condition behind a 5xx code. Pause 24h, requeue UNCHANGED. */
  | "pause_mailbox_24h"
  /** Reputation warning. Back off hours and trip the circuit breaker. */
  | "backoff_and_trip_breaker"
  /** Terminal, not the recipient's fault. Dead-letter it for a human. */
  | "dead_letter"

export interface SmtpErrorClassification {
  kind: SmtpErrorKind
  retryable: boolean
  action: SmtpErrorAction
  /**
   * True when the outcome is AMBIGUOUS: nodemailer resolves after `250 OK`, so
   * a failure at or after DATA is indistinguishable from one before it. A
   * caller seeing this must reconcile and must NOT retry.
   */
  requiresReconciliation: boolean
  /** Suggested backoff before the next attempt, when retryable. */
  backoffMs: number
  detail: string
}

interface SmtpErrorLike {
  message: string
  code?: string
  responseCode?: number
  response?: string
  command?: string
}

function asSmtpError(err: unknown): SmtpErrorLike {
  if (err === null || typeof err !== "object") {
    return { message: String(err) }
  }
  const e = err as Record<string, unknown>
  return {
    message: typeof e.message === "string" ? e.message : String(err),
    code: typeof e.code === "string" ? e.code : undefined,
    responseCode:
      typeof e.responseCode === "number" ? e.responseCode : undefined,
    response: typeof e.response === "string" ? e.response : undefined,
    command: typeof e.command === "string" ? e.command : undefined,
  }
}

/**
 * SMTP commands issued BEFORE the message body. A socket failure at any of
 * these is positively "the server never saw the message", which is the only
 * situation in which a blind retry is safe.
 */
const PRE_DATA_COMMANDS = new Set([
  "CONN",
  "EHLO",
  "HELO",
  "STARTTLS",
  "AUTH",
  "AUTH PLAIN",
  "AUTH LOGIN",
  "AUTH XOAUTH2",
  "API",
  "MAIL FROM",
  "RCPT TO",
])

/** Network errors meaning we never established a usable session at all. */
const NEVER_CONNECTED_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EDNS",
])

const SOCKET_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ESOCKET",
  "ECONNECTION",
  "ETLS",
  "EHOSTDOWN",
])

const HARD_RECIPIENT_PHRASES =
  /\b(?:user unknown|no such user|no such recipient|recipient (?:address )?rejected|address not found|does ?n[o']?t exist|unknown (?:user|recipient|address)|mailbox (?:unavailable|not found)|invalid recipient|address rejected)\b/i

/**
 * Maps an SMTP/nodemailer failure onto the spec §5 action table.
 *
 * Order is load-bearing. In particular the two Gmail cases that break the
 * naive "5xx means permanent" rule are checked BEFORE the generic 5xx branch:
 *
 *  - `535-5.7.8 Username and Password not accepted` is not a message problem
 *    at all; the app password was revoked. Retrying hammers a locked account
 *    and deepens the lockout, so it hard-stops every mailbox.
 *  - `550 5.4.5 Daily user sending limit exceeded` is a 5xx code carrying a
 *    TEMPORARY condition. Treating it as permanent marks live leads dead
 *    forever. It pauses the mailbox 24h and requeues the message unchanged.
 *
 * The default for an unrecognised failure is `reconcile`, not `retry`: an
 * error whose timing we cannot place might have been delivered, and the cost
 * asymmetry (a duplicate cold email vs. a delayed one) is not close.
 */
export function classifySmtpError(err: unknown): SmtpErrorClassification {
  const e = asSmtpError(err)
  const text = `${e.response ?? ""} ${e.message}`.trim()
  const command = e.command?.trim().toUpperCase()
  const code = e.code?.trim().toUpperCase()
  const rc = e.responseCode

  // --- 1. App password revoked --------------------------------------------
  if (
    /\b535\b/.test(text) ||
    rc === 535 ||
    code === "EAUTH" ||
    /username and password not accepted/i.test(text) ||
    /\b5\.7\.8\b/.test(text) ||
    /application-specific password required/i.test(text) ||
    /web login required/i.test(text)
  ) {
    return {
      kind: "auth_revoked",
      retryable: false,
      action: "hard_stop_all_mailboxes",
      requiresReconciliation: false,
      backoffMs: 0,
      detail: `authentication rejected (${text || "no response text"}) — app password revoked or blocked; every retry deepens the lockout`,
    }
  }

  // --- 2. Daily sending limit: a 5xx code for a TEMPORARY condition --------
  if (
    /\b5\.4\.5\b/.test(text) ||
    /\b4\.5\.3\b/.test(text) ||
    /daily (?:user )?sending (?:quota|limit) exceeded/i.test(text) ||
    /you have reached a limit for sending mail/i.test(text) ||
    /quota exceeded/i.test(text)
  ) {
    return {
      kind: "daily_limit",
      retryable: true,
      action: "pause_mailbox_24h",
      requiresReconciliation: false,
      backoffMs: 24 * 60 * 60 * 1000,
      detail: `daily sending limit (${text}) — 5xx code for a temporary condition; pause 24h and requeue unchanged`,
    }
  }

  // --- 3. Rate / reputation warning ----------------------------------------
  if (
    rc === 421 ||
    rc === 454 ||
    /\b421\b/.test(text) ||
    /\b454\b/.test(text) ||
    /\b4\.7\.0\b/.test(text) ||
    /unusual rate/i.test(text) ||
    /suspicious activity/i.test(text) ||
    /try again later/i.test(text) ||
    /too many login attempts/i.test(text) ||
    /rate limit/i.test(text) ||
    /throttl/i.test(text)
  ) {
    return {
      kind: "rate_limit",
      retryable: true,
      action: "backoff_and_trip_breaker",
      requiresReconciliation: command === "DATA" || command === ".",
      backoffMs: 4 * 60 * 60 * 1000,
      detail: `rate/reputation response (${text}) — back off hours and halt until a human re-arms`,
    }
  }

  // --- 4. Bad address -------------------------------------------------------
  const isFiveXx =
    (rc !== undefined && rc >= 500 && rc < 600) || /\b5\d{2}\b/.test(text)
  if (
    (command === "RCPT TO" && isFiveXx) ||
    /\b5\.1\.[01]\b/.test(text) ||
    (isFiveXx && HARD_RECIPIENT_PHRASES.test(text))
  ) {
    return {
      kind: "bad_recipient",
      retryable: false,
      action: "suppress_recipient",
      requiresReconciliation: false,
      backoffMs: 0,
      detail: `recipient rejected at ${command ?? "RCPT"} (${text}) — suppress, never retry`,
    }
  }

  // --- 5. Positively-not-delivered socket failure ---------------------------
  // Only when we can place the failure BEFORE the body was written. Anything
  // we cannot place falls through to the ambiguous branch below.
  const preData = command !== undefined && PRE_DATA_COMMANDS.has(command)
  if (
    (code !== undefined && NEVER_CONNECTED_CODES.has(code)) ||
    (preData && code !== undefined && SOCKET_CODES.has(code)) ||
    (preData && /socket|connection|timeout|timed out/i.test(text) && !isFiveXx)
  ) {
    return {
      kind: "pre_data_socket",
      retryable: true,
      action: "retry",
      requiresReconciliation: false,
      backoffMs: 5 * 60 * 1000,
      detail: `socket failure at ${command ?? code ?? "connect"}, before DATA — the server never saw the message; safe to retry`,
    }
  }

  // --- 6. Ambiguous: at or after DATA ---------------------------------------
  // Ambiguity comes from the ABSENCE of a verdict, not from the timing alone.
  // A server that answered `554 5.7.1` to our DATA has told us plainly that it
  // did not accept the message; classifying that as ambiguous would send it
  // through reconciliation and then permit a pointless resend of something the
  // server will reject again. Only a failure with no server response — a
  // socket drop or a timeout — is genuinely undecidable.
  const definiteServerVerdict = rc !== undefined && rc >= 400 && rc < 600
  const postData = command === "DATA" || command === "." || command === "BDAT"
  if (
    !definiteServerVerdict &&
    (postData ||
      (code !== undefined && SOCKET_CODES.has(code)) ||
      /timed? ?out/i.test(text))
  ) {
    return {
      kind: "post_data_ambiguous",
      retryable: false,
      action: "reconcile",
      requiresReconciliation: true,
      backoffMs: 0,
      detail: `failure at or after DATA (${command ?? code ?? "unknown"}: ${text}) — nodemailer resolves after 250 OK, so this is indistinguishable from a delivered message. Reconcile; NEVER blind-retry.`,
    }
  }

  // --- 7. Other 5xx / 4xx ---------------------------------------------------
  if (isFiveXx) {
    return {
      kind: "permanent",
      retryable: false,
      action: "dead_letter",
      requiresReconciliation: false,
      backoffMs: 0,
      detail: `permanent SMTP failure (${text})`,
    }
  }
  if ((rc !== undefined && rc >= 400 && rc < 500) || /\b4\d{2}\b/.test(text)) {
    return {
      kind: "temporary",
      retryable: true,
      action: "retry",
      requiresReconciliation: false,
      backoffMs: 30 * 60 * 1000,
      detail: `temporary SMTP failure (${text})`,
    }
  }

  // --- 8. Unknown: assume the worst -----------------------------------------
  return {
    kind: "unknown",
    retryable: false,
    action: "reconcile",
    requiresReconciliation: true,
    backoffMs: 0,
    detail: `unrecognised failure (${text || "no detail"}) — cannot prove the message was not delivered, so reconcile rather than retry`,
  }
}

// ---------------------------------------------------------------------------
// Mailbox pause / hard stop / circuit breaker state
// ---------------------------------------------------------------------------

/**
 * Pause + breaker state lives in `settings` rather than in new `mailboxes`
 * columns, on purpose: adding a migration to lib/db.ts while other agents are
 * editing it risks two conflicting "migration 2"s and a divergent
 * `user_version`. `mailboxes.status` and `last_error` are mirrored for the
 * Settings UI.
 */
function mailboxPauseKey(mailboxId: string): string {
  return `mailbox_pause:${mailboxId}`
}

export interface MailboxPause {
  until: number
  reason: string
}

export function getMailboxPause(mailboxId: string): MailboxPause | null {
  const stored = getSetting<MailboxPause | null>(mailboxPauseKey(mailboxId))
  if (!stored || typeof stored.until !== "number") return null
  return stored
}

export function pauseMailbox(
  mailboxId: string,
  untilMs: number,
  reason: string
): void {
  setSetting(mailboxPauseKey(mailboxId), { until: untilMs, reason })
  getDb()
    .prepare(
      `UPDATE mailboxes SET status = 'paused', last_error = ? WHERE id = ?`
    )
    .run(reason.slice(0, 500), mailboxId)
  logEvent("mailbox.paused", { detail: { mailboxId, until: untilMs, reason } })
}

export function clearMailboxPause(mailboxId: string): void {
  setSetting(mailboxPauseKey(mailboxId), null)
  getDb()
    .prepare(
      `UPDATE mailboxes SET status = 'active' WHERE id = ? AND status = 'paused'`
    )
    .run(mailboxId)
}

export type BreakerName =
  | "auto_reply_burst"
  | "unplanned_repeat_to_address"
  | "domain_volume"
  | "hard_bounce_rate"
  | "rate_limit_response"
  | "auth_revoked"

export interface CircuitBreakerState {
  breaker: BreakerName
  reason: string
  trippedAt: number
  detail: Record<string, unknown>
}

const BREAKER_KEY = "circuit_breaker"

export function getCircuitBreakerState(): CircuitBreakerState | null {
  const stored = getSetting<CircuitBreakerState | null>(BREAKER_KEY)
  if (!stored || typeof stored.trippedAt !== "number") return null
  return stored
}

/**
 * Halts everything. Requires a MANUAL re-arm — deliberately not time-based,
 * because every breaker here fires on evidence that the campaign itself is
 * misbehaving, and "wait an hour and resume automatically" is how a
 * misbehaving campaign burns a sending domain overnight.
 */
export function tripCircuitBreaker(
  breaker: BreakerName,
  reason: string,
  detail: Record<string, unknown> = {}
): CircuitBreakerState {
  const existing = getCircuitBreakerState()
  // First trip wins: the original cause is the diagnostic one, and later
  // findings are usually consequences of it.
  if (existing) return existing
  const state: CircuitBreakerState = {
    breaker,
    reason,
    trippedAt: Date.now(),
    detail,
  }
  setSetting(BREAKER_KEY, state)
  logEvent("circuit_breaker.tripped", { detail: state })
  return state
}

export function rearmCircuitBreaker(note = ""): void {
  const previous = getCircuitBreakerState()
  setSetting(BREAKER_KEY, null)
  logEvent("circuit_breaker.rearmed", { detail: { previous, note } })
}

/**
 * App password revoked: stop every mailbox and alert. Retrying an SMTP AUTH
 * against a locked Google account is what turns a revoked app password into a
 * suspended account.
 */
export function hardStopAllMailboxes(reason: string): void {
  getDb()
    .prepare(`UPDATE mailboxes SET status = 'disabled', last_error = ?`)
    .run(reason.slice(0, 500))
  tripCircuitBreaker("auth_revoked", reason, {
    mailboxes: listMailboxes().map((m) => m.email),
  })
  logEvent("mailbox.hard_stop", { detail: { reason } })
}

// ---------------------------------------------------------------------------
// Circuit breakers (spec §5)
// ---------------------------------------------------------------------------

/**
 * Shared consumer mail providers, exempt from the per-domain volume breaker.
 *
 * SPEC DEVIATION, deliberate. Spec §5 says ">3 messages to any single domain
 * in a day" with no exemption. But per §10 the addresses in this campaign come
 * from scraping small-business websites, and a large share of small businesses
 * use a gmail.com / yahoo.com / aol.com address. At 25 sends/day, reaching 4
 * gmail.com leads is close to certain on day one, so the unexempted rule would
 * halt the app immediately and demand a manual re-arm every single day. The
 * predictable user response is to disable the breaker entirely, which loses the
 * protection that actually matters.
 *
 * The breaker exists to stop us hammering ONE ORGANISATION's mail server, or
 * looking like a targeted attack on one company. That rationale does not apply
 * to a shared consumer provider. Set the setting
 * `domainBreakerExemptFreeMail` to `false` to enforce the spec literally.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "mail.com",
  "windstream.net",
  "frontier.com",
  "juno.com",
  "optonline.net",
  "rr.com",
])

export interface BreakerFinding {
  breaker: BreakerName
  reason: string
  detail: Record<string, unknown>
}

export interface BreakerReport {
  tripped: boolean
  state: CircuitBreakerState | null
  findings: BreakerFinding[]
}

export interface CheckBreakerOptions {
  now?: number
  pacing?: Partial<PacingConfig>
}

/**
 * Spec §5. Runs in the send path; must trip in minutes, not after a campaign
 * has finished. Any finding halts everything and requires a manual re-arm.
 */
export function checkCircuitBreakers(
  opts: CheckBreakerOptions = {}
): BreakerReport {
  const db = getDb()
  const now = opts.now ?? Date.now()
  const pacing = getPacingConfig(opts.pacing)
  const findings: BreakerFinding[] = []

  const alreadyTripped = getCircuitBreakerState()
  if (alreadyTripped) {
    return { tripped: true, state: alreadyTripped, findings: [] }
  }

  // --- >5 auto-replies in a rolling hour ------------------------------------
  // Counted from `events`, because `messages` has no is-auto-reply column and
  // `sequence_step IS NULL` also covers ordinary off-sequence sends.
  const hourAgo = now - 60 * 60 * 1000
  const autoReplies = db
    .prepare(
      `SELECT count(*) AS n FROM events
       WHERE type = 'send.auto_reply' AND created_at >= ?`
    )
    .get(hourAgo) as { n: number | bigint }
  if (Number(autoReplies.n) > 5) {
    findings.push({
      breaker: "auto_reply_burst",
      reason: `${Number(autoReplies.n)} auto-replies in the last rolling hour (limit 5)`,
      detail: { count: Number(autoReplies.n), since: hourAgo },
    })
  }

  // --- >2 messages to any single address, outside the planned sequence ------
  const unplanned = db
    .prepare(
      `SELECT lower(l.email) AS addr, count(*) AS n
       FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE m.direction = 'out' AND m.status = 'sent'
         AND m.sequence_step IS NULL AND l.email IS NOT NULL
       GROUP BY lower(l.email)
       HAVING count(*) > 2
       LIMIT 5`
    )
    .all() as unknown as Array<{ addr: string; n: number | bigint }>
  for (const row of unplanned) {
    findings.push({
      breaker: "unplanned_repeat_to_address",
      reason: `${Number(row.n)} unplanned (non-sequence) messages to ${row.addr} (limit 2)`,
      detail: { address: row.addr, count: Number(row.n) },
    })
  }

  // A lead can also only ever receive as many messages as the sequence has
  // steps. The unique index enforces "not the same step twice"; this catches a
  // misconfigured sequence emitting steps 4, 5, 6...
  const overSequence = db
    .prepare(
      `SELECT lower(l.email) AS addr, count(*) AS n
       FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE m.direction = 'out' AND m.status = 'sent' AND l.email IS NOT NULL
       GROUP BY lower(l.email)
       HAVING count(*) > ?
       LIMIT 5`
    )
    .all(pacing.plannedSequenceSteps + 2) as unknown as Array<{
    addr: string
    n: number | bigint
  }>
  for (const row of overSequence) {
    findings.push({
      breaker: "unplanned_repeat_to_address",
      reason: `${Number(row.n)} total messages to ${row.addr}, more than the planned sequence (${pacing.plannedSequenceSteps} steps) allows`,
      detail: { address: row.addr, count: Number(row.n) },
    })
  }

  // --- >3 messages to any single domain in a day ----------------------------
  const exemptFreeMail =
    getSetting<boolean>("domainBreakerExemptFreeMail") !== false
  const midnight = localMidnightEpochMs(pacing.operatorTimezone, now)
  const domains = db
    .prepare(
      `SELECT lower(substr(l.email, instr(l.email, '@') + 1)) AS domain,
              count(*) AS n
       FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE m.direction = 'out' AND m.status = 'sent' AND m.sent_at >= ?
         AND l.email IS NOT NULL AND instr(l.email, '@') > 0
       GROUP BY lower(substr(l.email, instr(l.email, '@') + 1))
       HAVING count(*) > 3`
    )
    .all(midnight) as unknown as Array<{ domain: string; n: number | bigint }>
  for (const row of domains) {
    if (exemptFreeMail && FREE_MAIL_DOMAINS.has(row.domain)) continue
    findings.push({
      breaker: "domain_volume",
      reason: `${Number(row.n)} messages to ${row.domain} today (limit 3)`,
      detail: { domain: row.domain, count: Number(row.n), since: midnight },
    })
  }

  // --- hard-bounce rate over the last 50 sends > 5% -------------------------
  const recent = db
    .prepare(
      `SELECT id, error FROM messages
       WHERE direction = 'out' AND status = 'sent' AND sent_at IS NOT NULL
       ORDER BY sent_at DESC LIMIT 50`
    )
    .all() as unknown as Array<Pick<MessageRow, "id" | "error">>
  if (recent.length >= 20) {
    // Below ~20 sends the rate is too noisy to act on: two bounces out of three
    // sends is 66% and means nothing.
    const hard = recent.filter(
      (r) => readAttemptRecord(r).bounce === "hard"
    ).length
    const rate = hard / recent.length
    if (rate > 0.05) {
      findings.push({
        breaker: "hard_bounce_rate",
        reason: `hard-bounce rate ${(rate * 100).toFixed(1)}% over the last ${recent.length} sends (limit 5%)`,
        detail: { hard, sample: recent.length, rate },
      })
    }
  }

  if (findings.length === 0) {
    return { tripped: false, state: null, findings: [] }
  }

  const first = findings[0]
  const state = tripCircuitBreaker(first.breaker, first.reason, {
    ...first.detail,
    allFindings: findings.map((f) => f.reason),
  })
  return { tripped: true, state, findings }
}

// ---------------------------------------------------------------------------
// canSendNow — the authoritative rate limiter (spec §5)
// ---------------------------------------------------------------------------

export type SendGateCode =
  | "stop_file"
  | "circuit_breaker"
  | "mailbox_missing"
  | "mailbox_disabled"
  | "mailbox_paused"
  | "daily_cap"
  | "warmup_cap"
  | "jitter_gap"
  | "catchup_suppressed"
  | "outside_window"

export type SendGate =
  | { ok: true; reason: string; dailyCapInEffect: number; sentToday: number }
  | { ok: false; code: SendGateCode; reason: string; retryAt: number | null }

export interface CanSendNowOptions {
  now?: number
  /**
   * The `run_after` of the task asking to send. Required for catch-up
   * suppression; omit only for an interactive/manual send.
   */
  taskRunAfter?: number | null
  pacing?: Partial<PacingConfig>
  /** Injectable for deterministic tests. */
  random?: () => number
}

function jitterMs(pacing: PacingConfig, random: () => number): number {
  const min = Math.max(0, pacing.sendGapMinMinutes)
  const max = Math.max(min, pacing.sendGapMaxMinutes)
  return Math.round((min + random() * (max - min)) * 60_000)
}

/**
 * Distinct local days on which this mailbox actually sent something.
 *
 * Spec §7: the warm-up ramp keys off days WITH SENDING ACTIVITY, not calendar
 * days since the mailbox was created. Running the app 3 days out of 14 must
 * not jump straight to full volume with no sending history behind it.
 *
 * Grouped by UTC day in SQL first so the (comparatively expensive) Intl
 * conversion runs once per active day rather than once per message. Both the
 * first and last send of each UTC day are converted, which covers a UTC day
 * that straddles two local days.
 */
export function countActiveSendingDays(
  mailboxId: string,
  timeZone: string,
  before: number
): number {
  const rows = getDb()
    .prepare(
      `SELECT min(sent_at) AS lo, max(sent_at) AS hi
       FROM messages
       WHERE mailbox_id = ? AND direction = 'out' AND status = 'sent'
         AND sent_at IS NOT NULL AND sent_at < ?
       GROUP BY sent_at / 86400000`
    )
    .all(mailboxId, before) as unknown as Array<{ lo: number; hi: number }>

  const days = new Set<number>()
  for (const row of rows) {
    days.add(localMidnightEpochMs(timeZone, row.lo))
    if (row.hi !== row.lo) days.add(localMidnightEpochMs(timeZone, row.hi))
  }
  return days.size
}

/**
 * Today's effective cap: the warm-up ramp, floored at the start value and
 * capped by the mailbox's own configured cap.
 */
export function warmupCap(
  mailboxId: string,
  pacing: PacingConfig,
  mailboxCap: number,
  now: number
): number {
  const todayMidnight = localMidnightEpochMs(pacing.operatorTimezone, now)
  const priorActiveDays = countActiveSendingDays(
    mailboxId,
    pacing.operatorTimezone,
    todayMidnight
  )
  const ramped = Math.floor(
    pacing.warmupStartPerDay *
      Math.pow(pacing.warmupGrowthPerActiveDay, priorActiveDays)
  )
  return Math.max(
    1,
    Math.min(mailboxCap, Math.max(pacing.warmupStartPerDay, ramped))
  )
}

/** The most recent successful send from this mailbox, or null. */
export function lastSentAt(mailboxId: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT max(sent_at) AS t FROM messages
       WHERE mailbox_id = ? AND direction = 'out' AND sent_at IS NOT NULL`
    )
    .get(mailboxId) as { t: number | null } | undefined
  return row?.t ?? null
}

/**
 * THE AUTHORITATIVE RATE LIMITER. Scheduling is advisory; this is not.
 *
 * Windows laptops sleep. `setTimeout` does not fire while the machine is
 * suspended, so on wake every overdue task is due at once and 25 emails leave
 * in 30 seconds — exactly the burst pattern abuse detection exists to catch.
 * Every gate below is therefore checked at SEND time, against the database, on
 * every single send.
 *
 * `leadTimezone` is the RECIPIENT's zone: emailing a Pacific-coast business at
 * 06:00 their time is an own-goal, and the send window has to be evaluated
 * where the reader is. Pass null only when the lead's zone is genuinely
 * unknown; the operator's zone is then used as the least-bad fallback.
 */
export function canSendNow(
  mailboxId: string,
  leadTimezone: string | null,
  opts: CanSendNowOptions = {}
): SendGate {
  const now = opts.now ?? Date.now()
  const pacing = getPacingConfig(opts.pacing)
  const random = opts.random ?? Math.random
  const recipientZone = leadTimezone?.trim() || pacing.operatorTimezone

  if (isStopFilePresent()) {
    return {
      ok: false,
      code: "stop_file",
      reason: `STOP file present at ${stopFilePath()} — everything halts`,
      retryAt: null,
    }
  }

  const breaker = getCircuitBreakerState()
  if (breaker) {
    return {
      ok: false,
      code: "circuit_breaker",
      reason: `circuit breaker "${breaker.breaker}" is tripped: ${breaker.reason}. Manual re-arm required.`,
      retryAt: null,
    }
  }

  const mailbox = getMailboxById(mailboxId)
  if (!mailbox) {
    return {
      ok: false,
      code: "mailbox_missing",
      reason: `mailbox ${mailboxId} does not exist`,
      retryAt: null,
    }
  }
  if (mailbox.status === "disabled") {
    return {
      ok: false,
      code: "mailbox_disabled",
      reason: `mailbox ${mailbox.email} is disabled (${mailbox.last_error ?? "no reason recorded"})`,
      retryAt: null,
    }
  }

  const pause = getMailboxPause(mailboxId)
  if (pause && pause.until > now) {
    return {
      ok: false,
      code: "mailbox_paused",
      reason: `mailbox ${mailbox.email} paused until ${new Date(pause.until).toISOString()}: ${pause.reason}`,
      retryAt: pause.until,
    }
  }
  if (pause && pause.until <= now) {
    clearMailboxPause(mailboxId)
  }

  // --- Catch-up suppression (spec §5) --------------------------------------
  // A task that came due while the laptop was asleep must NOT fire on wake.
  // Without this, a 6-hour sleep produces a burst of every overdue send the
  // instant the machine resumes.
  if (
    opts.taskRunAfter !== undefined &&
    opts.taskRunAfter !== null &&
    now - opts.taskRunAfter > pacing.catchUpGraceMs
  ) {
    // Reschedule FORWARD, never to `now`. On wake there are typically dozens
    // of overdue tasks; handing them all back `now` just re-fires the burst and
    // leans entirely on the jitter gap to absorb it. A jittered offset scatters
    // the backlog before the gap has to.
    return {
      ok: false,
      code: "catchup_suppressed",
      reason: `task was due ${Math.round((now - opts.taskRunAfter) / 60000)} min ago (grace ${Math.round(pacing.catchUpGraceMs / 60000)} min) — almost certainly a sleep/wake backlog; rescheduling forward instead of firing late`,
      retryAt: nextSendWindowStart(
        now + jitterMs(pacing, random),
        recipientZone,
        windowRules(pacing)
      ),
    }
  }

  // --- Send window, in the RECIPIENT's timezone -----------------------------
  if (!isWithinSendWindow(now, recipientZone, windowRules(pacing))) {
    return {
      ok: false,
      code: "outside_window",
      reason: `outside the ${pacing.windowStartHour}:00-${pacing.windowEndHour}:00 window in ${recipientZone}${pacing.weekdaysOnly ? " (weekdays only)" : ""}`,
      retryAt: nextSendWindowStart(now, recipientZone, windowRules(pacing)),
    }
  }
  if (isUsFederalHoliday(now, recipientZone)) {
    return {
      ok: false,
      code: "outside_window",
      reason: `US federal holiday in ${recipientZone}`,
      retryAt: nextSendWindowStart(now, recipientZone, windowRules(pacing)),
    }
  }

  // --- Daily cap, DERIVED, never a stored counter (spec §7) -----------------
  const midnight = localMidnightEpochMs(pacing.operatorTimezone, now)
  const sentToday = countSentToday(mailboxId, midnight)
  const configuredCap = Math.min(
    mailbox.daily_cap > 0 ? mailbox.daily_cap : pacing.emailsPerDay,
    pacing.emailsPerDay
  )
  const effectiveCap = warmupCap(mailboxId, pacing, configuredCap, now)

  if (sentToday >= effectiveCap) {
    const tomorrow = nextSendWindowStart(
      midnight + 24 * 60 * 60 * 1000 + 60_000,
      recipientZone,
      windowRules(pacing)
    )
    return {
      ok: false,
      code: effectiveCap < configuredCap ? "warmup_cap" : "daily_cap",
      reason:
        effectiveCap < configuredCap
          ? `warm-up cap reached: ${sentToday}/${effectiveCap} today (configured cap ${configuredCap}; ramp starts at ${pacing.warmupStartPerDay} and grows x${pacing.warmupGrowthPerActiveDay} per day WITH sending activity)`
          : `daily cap reached: ${sentToday}/${effectiveCap} today`,
      retryAt: tomorrow,
    }
  }

  // --- Jitter gap ------------------------------------------------------------
  // `SELECT max(sent_at)` per spec §5. This is the gate that survives a
  // suspended laptop, because it compares wall-clock instants recorded in the
  // database rather than trusting that a timer fired when it was supposed to.
  const last = lastSentAt(mailboxId)
  const minGapMs = Math.max(0, pacing.sendGapMinMinutes) * 60_000
  if (last !== null && now - last < minGapMs) {
    return {
      ok: false,
      code: "jitter_gap",
      reason: `only ${Math.round((now - last) / 1000)}s since the last send from this mailbox; minimum gap is ${pacing.sendGapMinMinutes} min`,
      retryAt: last + jitterMs(pacing, random),
    }
  }

  return {
    ok: true,
    reason: `within window in ${recipientZone}, ${sentToday}/${effectiveCap} sent today`,
    dailyCapInEffect: effectiveCap,
    sentToday,
  }
}

// ---------------------------------------------------------------------------
// Suppression helpers (shared with the inbound path)
// ---------------------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Suppresses an address permanently and cancels every pending task for the
 * lead in the SAME transaction (spec §7). Doing those two writes separately
 * leaves a window in which the suppression exists but the day-9 follow-up task
 * is still queued and about to fire.
 *
 * Safe to call inside an open transaction: pass `inTransaction: true` and the
 * caller owns BEGIN/COMMIT.
 */
export function suppressAddress(
  email: string,
  reason: string,
  opts: { leadId?: string | null; inTransaction?: boolean } = {}
): void {
  const db = getDb()
  const normalized = normalizeEmail(email)
  const run = (): void => {
    // An empty address would occupy the UNIQUE(email) slot and then match
    // nothing, so the suppression would look recorded while suppressing
    // nobody. Cancelling the lead's tasks still has to happen either way.
    if (normalized.length > 0) {
      db.prepare(
        `INSERT INTO suppressed (email, reason, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(email) DO NOTHING`
      ).run(normalized, reason.slice(0, 500), Date.now())
    }
    if (opts.leadId) {
      // A 'running' task is cancelled too. That does not stop the in-flight
      // handler — the TOCTOU re-check inside sendMessage does — but it stops
      // the lease reaper from resurrecting it afterwards.
      db.prepare(
        `UPDATE tasks SET status = 'cancelled', lease_until = NULL, worker_id = NULL
         WHERE lead_id = ? AND status IN ('pending', 'running')`
      ).run(opts.leadId)
      db.prepare(`UPDATE leads SET status = 'suppressed' WHERE id = ?`).run(
        opts.leadId
      )
    }
  }

  if (opts.inTransaction) {
    run()
  } else {
    db.exec("BEGIN IMMEDIATE")
    try {
      run()
      db.exec("COMMIT")
    } catch (err) {
      db.exec("ROLLBACK")
      throw err
    }
  }
  logEvent("suppressed", {
    leadId: opts.leadId ?? undefined,
    detail: { email: normalized, reason },
  })
}

// ---------------------------------------------------------------------------
// Reconciliation against [Gmail]/Sent Mail (spec §5)
// ---------------------------------------------------------------------------

export interface SentMailHit {
  outreachId: string
  /**
   * The Message-ID as it exists in Gmail's Sent Mail — the ONLY authoritative
   * one. See the note on `TransportSendResult.generatedMessageId`.
   */
  messageId: string | null
  gmThrid: string | null
  uid: number
  internalDate: number | null
}

/** Injectable so tests never open a socket. */
export interface SentMailSearcher {
  find(mailbox: MailboxRow, outreachId: string): Promise<SentMailHit | null>
  close?(): Promise<void>
}

export type ReconcileOutcome =
  /** It went out. The row is now `sent`, with the real Message-ID captured. */
  | { status: "sent"; hit: SentMailHit; rowId: string | null }
  /** It is not in Sent Mail. Exactly one resend is permitted. */
  | { status: "not_sent"; rowId: string | null; attemptsUsed: number }
  /** IMAP was unavailable. The row stays `sending`; DO NOT retry. */
  | { status: "unknown"; reason: string; rowId: string | null }

export interface ReconcileDeps {
  searcher?: SentMailSearcher
  now?: () => number
}

function findOutboundRowByOutreachId(
  outreachId: string
): MessageRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM messages WHERE outreach_id = ? AND direction = 'out' LIMIT 1`
    )
    .get(outreachId) as MessageRow | undefined
}

/**
 * Answers the one question that matters after an ambiguous SMTP failure: did
 * this message actually go out?
 *
 * IMAP-searches Gmail's Sent Mail for `HEADER X-Outreach-Id <uuid>`.
 *  - Found     -> the row becomes `sent`, and the REAL Message-ID and
 *                 X-GM-THRID are captured as the threading anchors.
 *  - Absent    -> the row becomes `retryable`; exactly one resend is allowed.
 *  - IMAP down -> nothing changes. The row stays `sending`, which no code path
 *                 is allowed to retry. A delayed email beats a duplicate one.
 *
 * This function is the only thing standing between the user and duplicate cold
 * emails. Nothing else may move a row out of `sending`.
 */
export async function reconcile(
  mailbox: MailboxRow,
  outreachId: string,
  deps: ReconcileDeps = {}
): Promise<ReconcileOutcome> {
  const now = deps.now ?? Date.now
  const row = findOutboundRowByOutreachId(outreachId)
  const rowId = row?.id ?? null

  const searcher = deps.searcher
  if (!searcher) {
    const reason =
      "no IMAP searcher available; cannot prove whether the message was delivered"
    logEvent("send.reconcile_unavailable", { detail: { outreachId, reason } })
    return { status: "unknown", reason, rowId }
  }

  let hit: SentMailHit | null
  try {
    hit = await searcher.find(mailbox, outreachId)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logEvent("send.reconcile_failed", { detail: { outreachId, reason } })
    return { status: "unknown", reason, rowId }
  }

  const db = getDb()
  if (hit) {
    if (rowId) {
      db.prepare(
        `UPDATE messages
         SET status = 'sent',
             sent_at = COALESCE(sent_at, ?),
             message_id = COALESCE(?, message_id),
             gm_thrid = COALESCE(?, gm_thrid)
         WHERE id = ?`
      ).run(hit.internalDate ?? now(), hit.messageId, hit.gmThrid, rowId)
    }
    logEvent("send.reconciled_found", {
      leadId: row?.lead_id,
      detail: { outreachId, messageId: hit.messageId, gmThrid: hit.gmThrid },
    })
    return { status: "sent", hit, rowId }
  }

  let attemptsUsed = 0
  if (row && rowId) {
    const record = readAttemptRecord(row)
    attemptsUsed = record.attempts
    db.prepare(
      `UPDATE messages SET status = 'retryable', error = ? WHERE id = ?`
    ).run(
      JSON.stringify({
        ...record,
        lastKind: record.lastKind ?? "post_data_ambiguous",
        lastDetail: "not present in Sent Mail; safe to resend once",
      } satisfies SendAttemptRecord),
      rowId
    )
  }
  logEvent("send.reconciled_absent", {
    leadId: row?.lead_id,
    detail: { outreachId, attemptsUsed },
  })
  return { status: "not_sent", rowId, attemptsUsed }
}

/**
 * Startup reconciliation (spec §9.5): every row left in `sending` by a crash
 * or a killed process. Until this runs, those (lead, step) pairs are blocked
 * from any further attempt — which is the correct, safe default.
 */
export async function reconcilePendingSends(
  mailbox: MailboxRow,
  deps: ReconcileDeps = {}
): Promise<{
  checked: number
  sent: number
  retryable: number
  unknown: number
}> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE direction = 'out' AND status = 'sending' AND mailbox_id = ?
         AND outreach_id IS NOT NULL
       ORDER BY created_at ASC`
    )
    .all(mailbox.id) as unknown as MessageRow[]

  let sent = 0
  let retryable = 0
  let unknown = 0
  for (const row of rows) {
    if (!row.outreach_id) continue
    const outcome = await reconcile(mailbox, row.outreach_id, deps)
    if (outcome.status === "sent") sent++
    else if (outcome.status === "not_sent") retryable++
    else unknown++
  }
  return { checked: rows.length, sent, retryable, unknown }
}

// ---------------------------------------------------------------------------
// sendMessage — the idempotency protocol (spec §5)
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  leadId: string
  mailboxId: string
  /** The lead's contact address. Re-checked against suppression at send time. */
  to: string
  subject: string
  text: string
  /**
   * The planned sequence step (0, 1, 2 ...). `UNIQUE(lead_id, sequence_step)`
   * is the structural guarantee that a lead cannot receive the same step
   * twice, so this must be non-null for every campaign email.
   *
   * Pass null ONLY for an off-sequence send (a template auto-reply), and then
   * `dedupeKey` becomes mandatory — the partial unique index does not cover
   * NULL steps, so without a key there is no structural protection at all.
   */
  sequenceStep: number | null
  /** Required when `sequenceStep` is null. */
  dedupeKey?: string
  isAutoReply?: boolean
  /** TRUE only if this recipient actually replied. Gates the `Re:` prefix. */
  recipientReplied?: boolean
  inReplyTo?: string | null
  references?: readonly string[]
  fromName?: string
  /** The recipient's IANA zone, for the send window. */
  leadTimezone?: string | null
  /**
   * The inbound message this send answers, if any. Re-run through
   * `bodyRequestsOptOut()` INSIDE the send transaction: a "not interested"
   * that arrived at 09:02 must stop a send queued for 09:05.
   */
  optOutCheck?: InboundMessage
  /** The `run_after` of the task driving this send (catch-up suppression). */
  taskRunAfter?: number | null
}

export type SendOutcome =
  | {
      status: "sent"
      outreachId: string
      rowId: string
      messageId: string | null
      dryRun: boolean
      artifactPath?: string
    }
  | { status: "duplicate"; reason: string; rowId: string | null }
  | { status: "suppressed"; reason: string }
  | {
      status: "blocked"
      code: SendGateCode | "needs_reconciliation" | "attempts_exhausted"
      reason: string
      retryAt: number | null
    }
  | {
      status: "failed"
      outreachId: string
      rowId: string
      classification: SmtpErrorClassification
      /** True when the outcome is still ambiguous after reconciliation. */
      unresolved: boolean
    }

export interface SendDeps {
  /** Defaults to `createTransport(mailbox)` — which is what reads SEND_ENABLED. */
  transport?: Transport
  /** Injected so an ambiguous failure can be settled immediately. */
  searcher?: SentMailSearcher
  now?: () => number
  random?: () => number
  pacing?: Partial<PacingConfig>
}

function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false
  const e = err as { errcode?: number; message?: string }
  // 2067 = SQLITE_CONSTRAINT_UNIQUE, 1555 = SQLITE_CONSTRAINT_PRIMARYKEY
  if (e.errcode === 2067 || e.errcode === 1555) return true
  return (
    typeof e.message === "string" && /UNIQUE constraint failed/i.test(e.message)
  )
}

/**
 * Whether a gate refusal is worth an `events` row. Pacing refusals are the
 * system working correctly and happen constantly; everything else means
 * something is wrong and a human should be able to find it.
 */
function isAbnormalGate(
  code: SendGateCode | "needs_reconciliation" | "attempts_exhausted"
): boolean {
  return (
    code !== "outside_window" &&
    code !== "jitter_gap" &&
    code !== "daily_cap" &&
    code !== "warmup_cap" &&
    code !== "catchup_suppressed"
  )
}

/**
 * A stable, unguessable id derived from a caller-supplied dedupe key.
 *
 * Off-sequence sends have `sequence_step IS NULL`, which the partial unique
 * index does not cover — so `UNIQUE(outreach_id)` is borrowed as the
 * structural guard instead. Deriving the id deterministically is what makes
 * that index fire on a genuine duplicate. It is a SHA-256 digest, so it leaks
 * nothing about the key even though it travels on the wire as a header.
 */
export function outreachIdForDedupeKey(dedupeKey: string): string {
  const digest = createHash("sha256")
    .update(`outreach:${dedupeKey}`)
    .digest("hex")
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-")
}

interface ClaimedRow {
  rowId: string
  outreachId: string
  attempts: number
}

type ClaimResult =
  | { kind: "claimed"; row: ClaimedRow }
  | { kind: "duplicate"; reason: string; rowId: string | null }
  | { kind: "suppressed"; reason: string }
  | {
      kind: "blocked"
      code: "needs_reconciliation" | "attempts_exhausted"
      reason: string
    }

/**
 * The real send already occupying the slot a rehearsal is about to write to,
 * if there is one.
 *
 * Both branches mirror the guard that governs the real path: a sequence step
 * is owned by `ux_msg_step`, and an off-sequence send by `UNIQUE(outreach_id)`
 * on the *unprefixed* id — the one a real send of the same dedupe key would
 * use, not the `dryrun:`-namespaced one this attempt is carrying.
 */
function findRealSendForRehearsal(
  db: ReturnType<typeof getDb>,
  input: SendMessageInput
): Pick<MessageRow, "id" | "status" | "sent_at"> | undefined {
  if (input.sequenceStep !== null) {
    return db
      .prepare(
        `SELECT id, status, sent_at FROM messages
         WHERE lead_id = ? AND sequence_step = ? AND direction = 'out'
           AND dry_run = 0 LIMIT 1`
      )
      .get(input.leadId, input.sequenceStep) as
      Pick<MessageRow, "id" | "status" | "sent_at"> | undefined
  }

  if (!input.dedupeKey) return undefined
  return db
    .prepare(
      `SELECT id, status, sent_at FROM messages
       WHERE outreach_id = ? AND direction = 'out' AND dry_run = 0 LIMIT 1`
    )
    .get(outreachIdForDedupeKey(input.dedupeKey)) as
    Pick<MessageRow, "id" | "status" | "sent_at"> | undefined
}

/**
 * Steps 2 + 3 of the protocol: the `messages` row is inserted with
 * `status='sending'` INSIDE a transaction, BEFORE any connection is opened,
 * and suppression is re-checked in that same transaction.
 *
 * The UNIQUE index is what structurally prevents double-sending, so the INSERT
 * is allowed to throw and the violation is interpreted rather than avoided by
 * a pre-check (a pre-check races; an index does not). The one pre-check in
 * here guards the dry-run path only, where a lost race is harmless.
 *
 * `dryRun` is decided by the caller from the transport it has already chosen,
 * because it is written on this row and the row exists before the transport is
 * used. It must never be inferred afterwards.
 */
function claimSendSlot(
  input: SendMessageInput,
  now: number,
  outreachId: string,
  dryRun: boolean
): ClaimResult {
  const db = getDb()
  const normalizedTo = normalizeEmail(input.to)

  db.exec("BEGIN IMMEDIATE")
  try {
    // --- TOCTOU re-check (spec §7) ----------------------------------------
    // Suppression is checked when the task is queued too, but a "not
    // interested" arriving at 09:02 must stop a send queued at 09:05, and the
    // only place that is guaranteed is inside the same transaction as the
    // insert.
    if (isSuppressed(normalizedTo)) {
      db.exec("ROLLBACK")
      return {
        kind: "suppressed",
        reason: `${normalizedTo} is on the suppression list (re-checked at send time)`,
      }
    }

    // The payload may carry the inbound message we are answering. Running the
    // opt-out detector again here closes the window between "reply arrives"
    // and "reply is processed".
    if (input.optOutCheck && bodyRequestsOptOut(input.optOutCheck)) {
      suppressAddress(
        normalizedTo,
        "opt-out detected in the message being answered",
        { leadId: input.leadId, inTransaction: true }
      )
      db.exec("COMMIT")
      return {
        kind: "suppressed",
        reason:
          "the message this send answers contains an opt-out; suppressed instead of replying",
      }
    }

    // Rehearsing something that already went out for real. The two indexes
    // cover disjoint row sets, so nothing structural stops this — the dry run
    // would write its own row and report a cheerful `sent`, with no hint that
    // the real email left days ago. A read-only pre-check is the right tool
    // here precisely because it is not a safety boundary: losing a race only
    // costs an extra `.eml` on disk, and no dry run can ever reach a stranger.
    if (dryRun) {
      const alreadyReal = findRealSendForRehearsal(db, input)
      if (alreadyReal) {
        db.exec("ROLLBACK")
        return {
          kind: "duplicate",
          reason:
            `this was already sent for real (row ${alreadyReal.id}, status "${alreadyReal.status}"` +
            `${alreadyReal.sent_at === null ? "" : ` at ${String(alreadyReal.sent_at)}`}); ` +
            "refusing to write a rehearsal over a real send",
          rowId: alreadyReal.id,
        }
      }
    }

    const rowId = randomUUID()
    try {
      db.prepare(
        `INSERT INTO messages
           (id, lead_id, mailbox_id, direction, sequence_step, subject, body,
            outreach_id, status, error, sent_at, created_at, dry_run)
         VALUES (?, ?, ?, 'out', ?, ?, ?, ?, 'sending', ?, NULL, ?, ?)`
      ).run(
        rowId,
        input.leadId,
        input.mailboxId,
        input.sequenceStep,
        input.subject,
        input.text,
        outreachId,
        JSON.stringify({
          attempts: 1,
          step: input.sequenceStep,
        } satisfies SendAttemptRecord),
        now,
        dryRun ? 1 : 0
      )
      db.exec("COMMIT")
      return { kind: "claimed", row: { rowId, outreachId, attempts: 1 } }
    } catch (err) {
      if (!isUniqueViolation(err)) {
        db.exec("ROLLBACK")
        throw err
      }

      // The index fired. Something already occupies this (lead, step) — or
      // this dedupe key. Interpret its state; never assume.
      const existing = (
        input.sequenceStep === null
          ? db
              .prepare(
                `SELECT * FROM messages WHERE outreach_id = ? AND direction = 'out' LIMIT 1`
              )
              .get(outreachId)
          : // Scoped to this attempt's own `dry_run` value, because rehearsals
            // and real sends are constrained by two different partial indexes
            // over disjoint rows. A lead can legitimately hold one of each for
            // a step; an unscoped LIMIT 1 would report whichever the planner
            // reached first, which is not necessarily the row that the index
            // actually fired on.
            db
              .prepare(
                `SELECT * FROM messages
                 WHERE lead_id = ? AND sequence_step = ? AND direction = 'out'
                   AND dry_run = ? LIMIT 1`
              )
              .get(input.leadId, input.sequenceStep, dryRun ? 1 : 0)
      ) as MessageRow | undefined

      if (!existing) {
        // A unique violation with nothing to point at: most likely a colliding
        // outreach_id belonging to a different lead. Refuse rather than guess.
        db.exec("ROLLBACK")
        return {
          kind: "duplicate",
          reason:
            "unique constraint fired but no matching row was found; refusing to send",
          rowId: null,
        }
      }

      if (existing.status === "sent") {
        db.exec("ROLLBACK")
        return {
          kind: "duplicate",
          reason: `step ${String(input.sequenceStep)} was already sent to this lead at ${existing.sent_at ?? "unknown time"}`,
          rowId: existing.id,
        }
      }

      if (existing.status === "sending") {
        // A previous attempt's outcome is unknown. Retrying here is exactly how
        // a duplicate cold email happens. Only `reconcile` may move a row out
        // of this state.
        db.exec("ROLLBACK")
        return {
          kind: "blocked",
          code: "needs_reconciliation",
          reason: `a previous attempt for this step is still unreconciled (row ${existing.id}, outreach id ${existing.outreach_id}). Run reconcile() against Sent Mail before any further attempt.`,
        }
      }

      const record = readAttemptRecord(existing)
      if (
        existing.status !== "retryable" ||
        record.attempts >= MAX_SEND_ATTEMPTS
      ) {
        db.exec("ROLLBACK")
        return {
          kind: "blocked",
          code: "attempts_exhausted",
          reason: `step ${String(input.sequenceStep)} is in state "${existing.status}" after ${record.attempts} attempt(s); no further attempts permitted`,
        }
      }

      // Take the existing row over rather than inserting a second one. The
      // outreach id is REUSED on purpose: if the earlier attempt did in fact
      // deliver despite being classified "not sent", reconciliation can still
      // find that copy under the same header and surface the mistake.
      const attempts = record.attempts + 1
      // `dry_run` is re-stamped: the takeover attempt may be running under a
      // different transport than the one that wrote the row (SEND_ENABLED
      // flipped, or the STOP file appeared between attempts), and the column
      // has to describe the attempt that is about to happen.
      db.prepare(
        `UPDATE messages
         SET status = 'sending', subject = ?, body = ?, error = ?, sent_at = NULL,
             dry_run = ?
         WHERE id = ?`
      ).run(
        input.subject,
        input.text,
        JSON.stringify({
          ...record,
          attempts,
          step: input.sequenceStep,
        } satisfies SendAttemptRecord),
        dryRun ? 1 : 0,
        existing.id
      )
      db.exec("COMMIT")
      return {
        kind: "claimed",
        row: {
          rowId: existing.id,
          outreachId: existing.outreach_id ?? outreachId,
          attempts,
        },
      }
    }
  } catch (err) {
    try {
      db.exec("ROLLBACK")
    } catch {
      /* already rolled back */
    }
    throw err
  }
}

function recordFailure(
  rowId: string,
  attempts: number,
  step: number | null,
  classification: SmtpErrorClassification,
  status: OutboundStatus
): void {
  getDb()
    .prepare(`UPDATE messages SET status = ?, error = ? WHERE id = ?`)
    .run(
      status,
      JSON.stringify({
        attempts,
        step,
        lastKind: classification.kind,
        lastDetail: classification.detail.slice(0, 800),
      } satisfies SendAttemptRecord),
      rowId
    )
}

/**
 * Sends one message, following spec §5 exactly.
 *
 * 1. Generate a UUID.
 * 2. Insert the `messages` row (`status='sending'`, `outreach_id=<uuid>`)
 *    inside a transaction, BEFORE opening any connection. The unique index is
 *    the structural guarantee; a violation means "already sent".
 * 3. Re-check suppression inside that same transaction.
 * 4. Set `X-Outreach-Id` plus the loop headers on the wire.
 * 5. Send; on success record `sent_at` and `status='sent'`.
 * 6. On an ambiguous failure, RECONCILE. Never blind-retry.
 */
export async function sendMessage(
  input: SendMessageInput,
  deps: SendDeps = {}
): Promise<SendOutcome> {
  const now = deps.now ?? Date.now
  const startedAt = now()

  if (input.sequenceStep === null && !input.dedupeKey) {
    throw new Error(
      "sendMessage: an off-sequence send (sequenceStep === null) requires a dedupeKey. " +
        "UNIQUE(lead_id, sequence_step) does not cover NULL steps, so without a key " +
        "nothing structurally prevents sending it twice."
    )
  }

  const mailbox = getMailboxById(input.mailboxId)
  if (!mailbox) {
    return {
      status: "blocked",
      code: "mailbox_missing",
      reason: `mailbox ${input.mailboxId} does not exist`,
      retryAt: null,
    }
  }

  // Breakers first: a tripped breaker must stop the send before any row is
  // written, and the scan itself can trip one.
  const breakerReport = checkCircuitBreakers({
    now: startedAt,
    pacing: deps.pacing,
  })
  if (breakerReport.tripped) {
    return {
      status: "blocked",
      code: "circuit_breaker",
      reason: `circuit breaker "${breakerReport.state?.breaker}" tripped: ${breakerReport.state?.reason}`,
      retryAt: null,
    }
  }

  const gate = canSendNow(input.mailboxId, input.leadTimezone ?? null, {
    now: startedAt,
    taskRunAfter: input.taskRunAfter,
    pacing: deps.pacing,
    random: deps.random,
  })
  if (!gate.ok) {
    // Only abnormal blocks get an event row. Routine pacing refusals
    // (outside_window, jitter_gap, daily_cap, warmup_cap, catchup_suppressed)
    // happen on every tick for every waiting task; logging them would bury the
    // dead-letter and breaker signals under tens of thousands of rows a day
    // and make the observability page useless.
    if (isAbnormalGate(gate.code)) {
      logEvent("send.blocked", {
        leadId: input.leadId,
        detail: { code: gate.code, reason: gate.reason, retryAt: gate.retryAt },
      })
    }
    return {
      status: "blocked",
      code: gate.code,
      reason: gate.reason,
      retryAt: gate.retryAt,
    }
  }

  // The transport is chosen BEFORE the row is claimed, because `dry_run` is a
  // column on that row and has to be correct at insert time. Inferring it
  // after the send is what put `{"dryRun":true}` into `error` and left the
  // uniqueness index unable to tell a dry run from a real one.
  //
  // Choosing a transport opens nothing — nodemailer dials on the first
  // `sendMail`, and this module never pools — so spec §5's "insert the row
  // before opening SMTP" ordering is intact.
  const transport = deps.transport ?? createTransport(mailbox)
  const dryRun = transport.kind === "file"
  const ownsTransport = deps.transport === undefined
  const releaseTransport = async (): Promise<void> => {
    if (ownsTransport) {
      await transport.close().catch(() => {
        /* closing a transport must never mask the send outcome */
      })
    }
  }

  // Step 1: the id that travels on the wire and anchors reconciliation.
  //
  // An off-sequence send is guarded by `UNIQUE(outreach_id)` rather than by
  // `ux_msg_step`, and that constraint has no dry-run exclusion to give it.
  // So the rehearsal gets its own key namespace instead: without the prefix a
  // rehearsed auto-reply occupies the real send's slot, and the real one is
  // later refused as a duplicate that "was already sent" — the same bug as the
  // sequence-step case, one constraint over.
  //
  // Safe because reconciliation is the only thing that looks an id up on the
  // wire, and it never runs for a dry run.
  const outreachId =
    input.sequenceStep === null && input.dedupeKey
      ? outreachIdForDedupeKey(
          dryRun ? `dryrun:${input.dedupeKey}` : input.dedupeKey
        )
      : randomUUID()

  // Steps 2 + 3.
  const claim = claimSendSlot(input, startedAt, outreachId, dryRun)
  if (claim.kind === "suppressed") {
    await releaseTransport()
    logEvent("send.suppressed_at_send", {
      leadId: input.leadId,
      detail: { reason: claim.reason },
    })
    return { status: "suppressed", reason: claim.reason }
  }
  if (claim.kind === "duplicate") {
    await releaseTransport()
    logEvent("send.duplicate", {
      leadId: input.leadId,
      detail: { reason: claim.reason, step: input.sequenceStep },
    })
    return { status: "duplicate", reason: claim.reason, rowId: claim.rowId }
  }
  if (claim.kind === "blocked") {
    await releaseTransport()
    logEvent("send.blocked", {
      leadId: input.leadId,
      detail: { code: claim.code, reason: claim.reason },
    })
    return {
      status: "blocked",
      code: claim.code,
      reason: claim.reason,
      retryAt: null,
    }
  }

  const { rowId, attempts } = claim.row

  // Step 4: X-Outreach-Id and the loop headers. buildMime throws rather than
  // producing a message missing either.
  const message = buildMime({
    from: mailbox.email,
    fromName: input.fromName,
    to: input.to,
    subject: input.subject,
    text: input.text,
    outreachId: claim.row.outreachId,
    isAutoReply: input.isAutoReply === true,
    recipientReplied: input.recipientReplied === true,
    inReplyTo: input.inReplyTo ?? null,
    references: input.references,
  })

  // Step 5.
  try {
    const result = await transport.send(message)
    const sentAt = now()
    getDb()
      .prepare(
        `UPDATE messages
         SET status = 'sent', sent_at = ?, message_id = ?, in_reply_to = ?,
             refs = ?, error = ?
         WHERE id = ?`
      )
      .run(
        sentAt,
        result.generatedMessageId,
        message.inReplyTo ?? null,
        message.references ?? null,
        JSON.stringify({
          attempts,
          step: input.sequenceStep,
        } satisfies SendAttemptRecord),
        rowId
      )

    logEvent(dryRun ? "send.dryrun" : "send.sent", {
      leadId: input.leadId,
      detail: {
        outreachId: claim.row.outreachId,
        step: input.sequenceStep,
        to: normalizeEmail(input.to),
        artifactPath: result.artifactPath,
      },
    })
    if (input.isAutoReply === true) {
      // Feeds the ">5 auto-replies in a rolling hour" breaker.
      logEvent("send.auto_reply", {
        leadId: input.leadId,
        detail: { outreachId: claim.row.outreachId },
      })
    }

    // The Message-ID nodemailer reports is NOT authoritative — Gmail may
    // rewrite it on submission. Read the real one back from Sent Mail when a
    // searcher is available; follow-ups thread on that value.
    let authoritativeMessageId = result.generatedMessageId
    if (!dryRun && deps.searcher) {
      const outcome = await reconcile(mailbox, claim.row.outreachId, {
        searcher: deps.searcher,
        now,
      })
      if (outcome.status === "sent" && outcome.hit.messageId) {
        authoritativeMessageId = outcome.hit.messageId
      }
    }

    return {
      status: "sent",
      outreachId: claim.row.outreachId,
      rowId,
      messageId: authoritativeMessageId,
      dryRun,
      ...(result.artifactPath ? { artifactPath: result.artifactPath } : {}),
    }
  } catch (err) {
    // Step 6.
    const classification = classifySmtpError(err)
    logEvent("send.failed", {
      leadId: input.leadId,
      detail: {
        outreachId: claim.row.outreachId,
        kind: classification.kind,
        action: classification.action,
        detail: classification.detail,
      },
    })

    switch (classification.action) {
      case "hard_stop_all_mailboxes":
        // Never retry. Every additional AUTH against a locked Google account
        // deepens the lockout.
        recordFailure(
          rowId,
          attempts,
          input.sequenceStep,
          classification,
          "retryable"
        )
        hardStopAllMailboxes(classification.detail)
        break

      case "pause_mailbox_24h":
        // A 5xx code carrying a TEMPORARY condition. The message is requeued
        // UNCHANGED — marking the lead dead here is the exact bug this case
        // exists to prevent.
        recordFailure(
          rowId,
          attempts,
          input.sequenceStep,
          classification,
          "retryable"
        )
        pauseMailbox(
          input.mailboxId,
          now() + classification.backoffMs,
          classification.detail
        )
        break

      case "backoff_and_trip_breaker":
        recordFailure(
          rowId,
          attempts,
          input.sequenceStep,
          classification,
          classification.requiresReconciliation ? "sending" : "retryable"
        )
        pauseMailbox(
          input.mailboxId,
          now() + classification.backoffMs,
          classification.detail
        )
        tripCircuitBreaker("rate_limit_response", classification.detail, {
          mailboxId: input.mailboxId,
        })
        break

      case "suppress_recipient":
        recordFailure(
          rowId,
          attempts,
          input.sequenceStep,
          classification,
          "failed"
        )
        suppressAddress(
          input.to,
          `SMTP rejected the address: ${classification.detail}`,
          { leadId: input.leadId }
        )
        break

      case "retry":
        // Positively not delivered. The row stays on this (lead, step) and is
        // marked `retryable`, so the next attempt takes it over instead of
        // inserting a second row.
        recordFailure(
          rowId,
          attempts,
          input.sequenceStep,
          classification,
          "retryable"
        )
        break

      case "reconcile": {
        // AMBIGUOUS. The row stays `sending` unless reconciliation settles it.
        recordFailure(
          rowId,
          attempts,
          input.sequenceStep,
          classification,
          "sending"
        )
        if (deps.searcher) {
          const outcome = await reconcile(mailbox, claim.row.outreachId, {
            searcher: deps.searcher,
            now,
          })
          if (outcome.status === "sent") {
            return {
              status: "sent",
              outreachId: claim.row.outreachId,
              rowId,
              messageId: outcome.hit.messageId,
              dryRun,
            }
          }
          return {
            status: "failed",
            outreachId: claim.row.outreachId,
            rowId,
            classification,
            unresolved: outcome.status !== "not_sent",
          }
        }
        return {
          status: "failed",
          outreachId: claim.row.outreachId,
          rowId,
          classification,
          unresolved: true,
        }
      }

      case "dead_letter":
        recordFailure(
          rowId,
          attempts,
          input.sequenceStep,
          classification,
          "failed"
        )
        break
    }

    return {
      status: "failed",
      outreachId: claim.row.outreachId,
      rowId,
      classification,
      unresolved: classification.requiresReconciliation,
    }
  } finally {
    await releaseTransport()
  }
}

// ---------------------------------------------------------------------------
// Bounce bookkeeping (used by the inbound path)
// ---------------------------------------------------------------------------

/**
 * Records a bounce against the originating message so the hard-bounce-rate
 * breaker can see it. `status` is left as `sent` on purpose: the message DID
 * leave, and flipping it would silently hand the mailbox back a slot in
 * today's derived daily count.
 */
export function markBounce(
  outreachId: string,
  hard: boolean,
  dsnStatus?: string
): boolean {
  const row = findOutboundRowByOutreachId(outreachId)
  if (!row) return false
  const record = readAttemptRecord(row)
  getDb()
    .prepare(`UPDATE messages SET error = ? WHERE id = ?`)
    .run(
      JSON.stringify({
        ...record,
        bounce: hard ? "hard" : "soft",
        ...(dsnStatus ? { bounceStatus: dsnStatus } : {}),
      } satisfies SendAttemptRecord),
      row.id
    )
  return true
}

// ---------------------------------------------------------------------------
// Dry-run bookkeeping
// ---------------------------------------------------------------------------

export function countDryRunMessages(): number {
  const row = getDb()
    .prepare(
      `SELECT count(*) AS n FROM messages
       WHERE direction = 'out' AND dry_run = 1`
    )
    .get() as { n: number | bigint }
  return Number(row.n)
}

/**
 * Deletes dry-run rows.
 *
 * No longer required for correctness — `ux_msg_step` skips them, so a real
 * send of a dry-run step goes through either way (migration 3). It is now for
 * tidying up: dry-run rows are counted by `countSentToday`, so leaving a large
 * rehearsal behind eats into the first real day's cap.
 */
export function clearDryRunMessages(): number {
  const result = getDb()
    .prepare(
      `DELETE FROM messages
       WHERE direction = 'out' AND dry_run = 1`
    )
    .run()
  const n = Number(result.changes)
  if (n > 0) logEvent("send.dryrun_cleared", { detail: { deleted: n } })
  return n
}
