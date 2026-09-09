/**
 * Tests for the outbound mail layer.
 *
 * INVARIANT FOR THIS FILE: no test may open a network connection or send mail.
 * Every send goes through `FileTransport`, which renders MIME with
 * nodemailer's `streamTransport` (no socket code path at all) and writes a
 * `.eml` to a temp directory. `SmtpTransport` is never constructed.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

// The database path must be redirected BEFORE anything calls getDb(). Nothing
// in the imported modules touches the database at load time, and every test
// body runs after this block, so setting it here is safe — but a stray real
// database would mean writing test rows into the user's live outreach data,
// so it is asserted rather than assumed.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-send-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")
process.env.OUTBOX_DRYRUN_DIR = path.join(TMP_ROOT, "outbox")
process.env.VENDING_STOP_FILE = path.join(TMP_ROOT, "STOP-does-not-exist")
delete process.env.SEND_ENABLED

import {
  buildMime,
  canSendNow,
  checkCircuitBreakers,
  classifySmtpError,
  clearDryRunMessages,
  countDryRunMessages,
  createTransport,
  FileTransport,
  getCircuitBreakerState,
  isSendEnabled,
  lastSentAt,
  rearmCircuitBreaker,
  reconcile,
  sendMessage,
  SmtpTransport,
  type PacingConfig,
  type SentMailHit,
  type SentMailSearcher,
  type Transport,
} from "./mail-send.ts"
import { getDb, getMailboxById, upsertMailbox, type MailboxRow } from "./db.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-send-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TZ = "America/New_York"

/** Tuesday 2025-03-11, 10:00 America/New_York (EDT, UTC-4). Not a holiday. */
const NOW = Date.parse("2025-03-11T14:00:00Z")

const PACING: Partial<PacingConfig> = {
  emailsPerDay: 25,
  sendGapMinMinutes: 6,
  sendGapMaxMinutes: 20,
  windowStartHour: 9,
  windowEndHour: 16,
  weekdaysOnly: true,
  operatorTimezone: TZ,
}

/** Pacing with the gap removed, for tests that need two sends back to back. */
const NO_GAP: Partial<PacingConfig> = { ...PACING, sendGapMinMinutes: 0 }

let leadCounter = 0

const MAILBOX_EMAIL = "sales@vendingco.example"

/** Idempotent: `upsertMailbox` keys on id, but `mailboxes.email` is UNIQUE. */
function seedMailbox(): MailboxRow {
  const existing = getDb()
    .prepare(`SELECT id FROM mailboxes WHERE email = ?`)
    .get(MAILBOX_EMAIL) as { id: string } | undefined
  return upsertMailbox({
    ...(existing ? { id: existing.id } : {}),
    email: MAILBOX_EMAIL,
    appPassword: "abcd efgh ijkl mnop",
    dailyCap: 25,
  })
}

/** Each lead gets its own domain so the per-domain breaker never cross-talks. */
function seedLead(overrides: { email?: string; timezone?: string } = {}): {
  id: string
  email: string
} {
  leadCounter++
  const email = overrides.email ?? `owner@lead${leadCounter}.example`
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO leads (id, name, email, timezone, status, score, created_at)
       VALUES (?, ?, ?, ?, 'contacted', 0, ?)`
    )
    .run(id, `Lead ${leadCounter}`, email, overrides.timezone ?? TZ, NOW)
  return { id, email }
}

function resetGlobalState(): void {
  rearmCircuitBreaker("test reset")
  getDb().exec("DELETE FROM settings WHERE key LIKE 'mailbox_pause:%'")
  getDb().exec("UPDATE mailboxes SET status = 'active', last_error = NULL")
}

function fileTransport(): FileTransport {
  return new FileTransport(path.join(TMP_ROOT, "outbox", randomUUID()))
}

/**
 * A transport that reports `kind: "smtp"`, so the row it produces is a real
 * send (`dry_run = 0`), while still only writing an `.eml` to disk.
 *
 * `SmtpTransport` is never constructed here — that would open a socket and
 * break this file's invariant. But every dry-run rule keys off `kind`, so
 * testing them at all needs something that claims to be live and dials
 * nothing.
 */
function liveTransport(): Transport {
  const file = fileTransport()
  return {
    kind: "smtp",
    send: (message) => file.send(message),
    close: () => file.close(),
  }
}

function fakeSearcher(hit: SentMailHit | null): SentMailSearcher {
  return {
    async find(): Promise<SentMailHit | null> {
      return hit
    },
  }
}

// ---------------------------------------------------------------------------
// Transport selection (spec §0.1)
// ---------------------------------------------------------------------------

test("SEND_ENABLED defaults to false and the factory hands back FileTransport", () => {
  const mailbox = seedMailbox()
  assert.equal(isSendEnabled(), false)
  assert.equal(createTransport(mailbox).kind, "file")
})

test("SmtpTransport cannot be constructed outside the factory", () => {
  const mailbox = seedMailbox()
  // The unlock symbol is module-private, so this is the only shape a caller
  // could try. It must fail loudly rather than open a socket.
  const Unsafe = SmtpTransport as unknown as new (
    m: MailboxRow,
    u: symbol
  ) => unknown
  assert.throws(
    () => new Unsafe(mailbox, Symbol("not the real unlock")),
    /cannot be constructed directly/
  )
})

// ---------------------------------------------------------------------------
// buildMime
// ---------------------------------------------------------------------------

test("buildMime always carries X-Outreach-Id and X-Loop, and never an HTML part", () => {
  const message = buildMime({
    from: "sales@vendingco.example",
    to: "owner@acme.example",
    subject: "Vending machines for Acme",
    text: "Hi — quick question about your break room.",
    outreachId: "11111111-2222-3333-4444-555555555555",
    isAutoReply: false,
    recipientReplied: false,
  })
  assert.equal(
    message.headers["X-Outreach-Id"],
    "11111111-2222-3333-4444-555555555555"
  )
  assert.equal(message.headers["X-Loop"], "sales@vendingco.example")
  assert.equal(message.headers["Auto-Submitted"], undefined)
  assert.equal(message.envelopeFrom, "sales@vendingco.example")
  assert.ok(!("html" in message))
  assert.ok(!("attachments" in message))
})

test("auto-replies additionally carry Auto-Submitted: auto-replied", () => {
  const message = buildMime({
    from: "sales@vendingco.example",
    to: "owner@acme.example",
    subject: "More information",
    text: "Here is the one-pager.",
    outreachId: "11111111-2222-3333-4444-555555555555",
    isAutoReply: true,
    recipientReplied: true,
  })
  assert.equal(message.headers["Auto-Submitted"], "auto-replied")
})

test("Re: is absent on a follow-up the recipient never answered", () => {
  const followUp = buildMime({
    from: "sales@vendingco.example",
    to: "owner@acme.example",
    // The caller copied the previous step's subject, which already had a Re:.
    // A Re: on a message they never answered is a deceptive subject line under
    // CAN-SPAM, so it must be stripped, not passed through.
    subject: "Re: Vending machines for Acme",
    text: "Following up on my note last week.",
    outreachId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    isAutoReply: false,
    recipientReplied: false,
    // Threading headers are still set — only the visible Re: is gated.
    inReplyTo: "<step1@mail.example>",
    references: ["<step1@mail.example>"],
  })
  assert.equal(followUp.subject, "Vending machines for Acme")
  assert.equal(followUp.inReplyTo, "<step1@mail.example>")

  const realReply = buildMime({
    from: "sales@vendingco.example",
    to: "owner@acme.example",
    subject: "Vending machines for Acme",
    text: "Thanks for getting back to me.",
    outreachId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    isAutoReply: false,
    recipientReplied: true,
    inReplyTo: "<their-reply@acme.example>",
  })
  assert.equal(realReply.subject, "Re: Vending machines for Acme")
})

test("buildMime refuses header injection and an unusable X-Loop", () => {
  const base = {
    from: "sales@vendingco.example",
    to: "owner@acme.example",
    text: "hello",
    outreachId: "11111111-2222-3333-4444-555555555555",
    isAutoReply: false,
    recipientReplied: false,
  }
  assert.throws(
    () => buildMime({ ...base, subject: "hi\r\nBcc: victim@example.com" }),
    /header injection/
  )
  assert.throws(
    () => buildMime({ ...base, from: "   ", subject: "hi" }),
    /not a bare email address/
  )
  assert.throws(
    () =>
      buildMime({ ...base, subject: "hi", outreachId: "not a safe token!!" }),
    /not a safe token/
  )
})

// ---------------------------------------------------------------------------
// classifySmtpError — spec §5 table
// ---------------------------------------------------------------------------

test("classifySmtpError: 5xx at RCPT TO is a bad address — suppress, no retry", () => {
  const c = classifySmtpError({
    message: "Recipient address rejected",
    responseCode: 550,
    response:
      "550-5.1.1 The email account that you tried to reach does not exist.",
    command: "RCPT TO",
  })
  assert.equal(c.kind, "bad_recipient")
  assert.equal(c.retryable, false)
  assert.equal(c.action, "suppress_recipient")
  assert.equal(c.requiresReconciliation, false)
})

test("classifySmtpError: a socket error before DATA is a safe retry", () => {
  const c = classifySmtpError({
    message: "Connection closed unexpectedly",
    code: "ECONNRESET",
    command: "MAIL FROM",
  })
  assert.equal(c.kind, "pre_data_socket")
  assert.equal(c.retryable, true)
  assert.equal(c.action, "retry")
  assert.equal(c.requiresReconciliation, false)
})

test("classifySmtpError: a timeout after DATA is ambiguous — reconcile, never retry", () => {
  const c = classifySmtpError({
    message: "Timeout waiting for the server response",
    code: "ETIMEDOUT",
    command: "DATA",
  })
  assert.equal(c.kind, "post_data_ambiguous")
  assert.equal(c.action, "reconcile")
  // The whole point: nodemailer resolves after 250 OK, so this is
  // indistinguishable from a delivered message.
  assert.equal(c.retryable, false)
  assert.equal(c.requiresReconciliation, true)
})

test("classifySmtpError: 535-5.7.8 is a hard stop for EVERY mailbox, never a retry", () => {
  const c = classifySmtpError({
    message: "Invalid login",
    responseCode: 535,
    response:
      "535-5.7.8 Username and Password not accepted. Learn more at https://support.google.com/mail/?p=BadCredentials",
    command: "AUTH PLAIN",
    code: "EAUTH",
  })
  assert.equal(c.kind, "auth_revoked")
  assert.equal(c.action, "hard_stop_all_mailboxes")
  assert.equal(c.retryable, false)
})

test("classifySmtpError: 550 5.4.5 is a 5xx code for a TEMPORARY condition", () => {
  const c = classifySmtpError({
    message: "Daily user sending limit exceeded",
    responseCode: 550,
    response:
      "550 5.4.5 Daily user sending limit exceeded. For more information ...",
    command: "DATA",
  })
  assert.equal(c.kind, "daily_limit")
  // A naive "5xx means permanent" rule marks live leads dead forever. This
  // must requeue unchanged behind a 24h pause.
  assert.equal(c.retryable, true)
  assert.equal(c.action, "pause_mailbox_24h")
  assert.equal(c.backoffMs, 24 * 60 * 60 * 1000)
  assert.notEqual(c.action, "suppress_recipient")
})

test("classifySmtpError: 421 4.7.0 / unusual rate backs off AND trips the breaker", () => {
  for (const err of [
    {
      message: "Try again later",
      responseCode: 421,
      response: "421 4.7.0 Try again later, closing connection.",
    },
    {
      message: "unusual rate of messages",
      responseCode: 450,
      response:
        "450 4.2.1 The user you are trying to contact is receiving mail at an unusual rate.",
    },
  ]) {
    const c = classifySmtpError(err)
    assert.equal(c.kind, "rate_limit", JSON.stringify(err))
    assert.equal(c.action, "backoff_and_trip_breaker")
    assert.ok(c.backoffMs >= 60 * 60 * 1000)
  }
})

test("classifySmtpError: an unrecognised failure reconciles rather than retrying", () => {
  const c = classifySmtpError(new Error("something nobody has seen before"))
  assert.equal(c.kind, "unknown")
  assert.equal(c.action, "reconcile")
  assert.equal(c.retryable, false)
  assert.equal(c.requiresReconciliation, true)
})

test("classifySmtpError: an ordinary permanent 5xx dead-letters without suppressing", () => {
  const c = classifySmtpError({
    message: "Message rejected",
    responseCode: 554,
    response: "554 5.7.1 Message rejected by policy",
    command: "DATA",
  })
  assert.equal(c.kind, "permanent")
  assert.equal(c.action, "dead_letter")
})

// ---------------------------------------------------------------------------
// canSendNow — the authoritative rate limiter
// ---------------------------------------------------------------------------

test("canSendNow allows a send inside the window with nothing sent yet", () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const gate = canSendNow(mailbox.id, TZ, { now: NOW, pacing: PACING })
  assert.equal(gate.ok, true)
  if (gate.ok) {
    // Warm-up: no prior days with sending activity, so 5/day, not 25.
    assert.equal(gate.dailyCapInEffect, 5)
  }
})

test("canSendNow refuses inside the jitter gap", () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()
  getDb()
    .prepare(
      `INSERT INTO messages (id, lead_id, mailbox_id, direction, sequence_step,
                             outreach_id, status, sent_at, created_at)
       VALUES (?, ?, ?, 'out', 90, ?, 'sent', ?, ?)`
    )
    .run(randomUUID(), lead.id, mailbox.id, randomUUID(), NOW - 60_000, NOW)

  assert.equal(lastSentAt(mailbox.id), NOW - 60_000)

  const gate = canSendNow(mailbox.id, TZ, {
    now: NOW,
    pacing: PACING,
    random: () => 0,
  })
  assert.equal(gate.ok, false)
  if (!gate.ok) {
    assert.equal(gate.code, "jitter_gap")
    // Rescheduled to a full gap after the previous send, not to "now".
    assert.equal(gate.retryAt, NOW - 60_000 + 6 * 60_000)
  }

  // ...and it allows the send once the gap has actually elapsed.
  const later = canSendNow(mailbox.id, TZ, {
    now: NOW + 7 * 60_000,
    pacing: PACING,
    random: () => 0,
  })
  assert.equal(later.ok, true)

  getDb().exec("DELETE FROM messages")
})

test("canSendNow suppresses catch-up after a simulated 6-hour sleep", () => {
  resetGlobalState()
  const mailbox = seedMailbox()

  // The laptop slept from 04:00 to 10:00 local. `setTimeout` never fired, so on
  // wake this task is 6 hours overdue along with two dozen siblings. Firing
  // them all now is the burst pattern abuse detection exists to catch.
  const gate = canSendNow(mailbox.id, TZ, {
    now: NOW,
    taskRunAfter: NOW - 6 * 60 * 60 * 1000,
    pacing: PACING,
    random: () => 0,
  })
  assert.equal(gate.ok, false)
  if (!gate.ok) {
    assert.equal(gate.code, "catchup_suppressed")
    assert.ok(gate.retryAt !== null && gate.retryAt > NOW)
  }

  // A task only slightly late still fires — the grace is 45 minutes.
  const onTime = canSendNow(mailbox.id, TZ, {
    now: NOW,
    taskRunAfter: NOW - 10 * 60 * 1000,
    pacing: PACING,
  })
  assert.equal(onTime.ok, true)
})

test("canSendNow refuses outside the recipient's window and on weekends", () => {
  resetGlobalState()
  const mailbox = seedMailbox()

  // 10:00 in New York is 07:00 in Los Angeles — outside a 09:00-16:00 window
  // evaluated where the reader actually is.
  const pacific = canSendNow(mailbox.id, "America/Los_Angeles", {
    now: NOW,
    pacing: PACING,
  })
  assert.equal(pacific.ok, false)
  if (!pacific.ok) assert.equal(pacific.code, "outside_window")

  // Saturday 2025-03-15.
  const weekend = canSendNow(mailbox.id, TZ, {
    now: Date.parse("2025-03-15T14:00:00Z"),
    pacing: PACING,
  })
  assert.equal(weekend.ok, false)

  // US federal holiday: Thanksgiving, Thursday 2025-11-27, 10:00 EST.
  const holiday = canSendNow(mailbox.id, TZ, {
    now: Date.parse("2025-11-27T15:00:00Z"),
    pacing: PACING,
  })
  assert.equal(holiday.ok, false)
  if (!holiday.ok) assert.equal(holiday.code, "outside_window")
})

test("canSendNow enforces the warm-up cap derived from days WITH sending activity", () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const insert = getDb().prepare(
    `INSERT INTO messages (id, lead_id, mailbox_id, direction, sequence_step,
                           outreach_id, status, sent_at, created_at)
     VALUES (?, ?, ?, 'out', ?, ?, 'sent', ?, ?)`
  )

  // Five sends earlier today: the day-one warm-up cap is exactly 5.
  for (let i = 0; i < 5; i++) {
    insert.run(
      randomUUID(),
      lead.id,
      mailbox.id,
      1000 + i,
      randomUUID(),
      NOW - (i + 1) * 60 * 60 * 1000,
      NOW
    )
  }
  const capped = canSendNow(mailbox.id, TZ, { now: NOW, pacing: PACING })
  assert.equal(capped.ok, false)
  if (!capped.ok) assert.equal(capped.code, "warmup_cap")

  // Nine prior days that actually had sending activity lift the cap to the
  // configured 25. Calendar days alone must not: these are nine days on which
  // mail really went out.
  for (let day = 1; day <= 9; day++) {
    insert.run(
      randomUUID(),
      lead.id,
      mailbox.id,
      2000 + day,
      randomUUID(),
      NOW - day * 24 * 60 * 60 * 1000,
      NOW
    )
  }
  const ramped = canSendNow(mailbox.id, TZ, { now: NOW, pacing: PACING })
  assert.equal(ramped.ok, true)
  if (ramped.ok) assert.equal(ramped.dailyCapInEffect, 25)

  getDb().exec("DELETE FROM messages")
})

// ---------------------------------------------------------------------------
// sendMessage — the idempotency protocol
// ---------------------------------------------------------------------------

test("a send writes an .eml, records sent_at, and carries the required headers", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const transport = fileTransport()

  const outcome = await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Vending machines for your break room",
      text: "Hi — quick question about your break room.",
      sequenceStep: 0,
      leadTimezone: TZ,
    },
    { transport, now: () => NOW, pacing: NO_GAP }
  )

  assert.equal(outcome.status, "sent")
  if (outcome.status !== "sent") return
  assert.equal(outcome.dryRun, true)
  assert.ok(outcome.artifactPath)

  const eml = fs.readFileSync(outcome.artifactPath as string, "utf8")
  // Case-insensitive on purpose: nodemailer emits `X-Outreach-ID`, and header
  // names are case-insensitive everywhere they are read back (RFC 5322, IMAP
  // SEARCH, and every lookup in this codebase).
  assert.match(eml, new RegExp(`X-Outreach-Id: ${outcome.outreachId}`, "i"))
  assert.match(eml, /X-Loop: sales@vendingco\.example/)
  assert.doesNotMatch(eml, /text\/html/)
  assert.doesNotMatch(eml, /<img/i)

  const row = getDb()
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(outcome.rowId) as {
    status: string
    sent_at: number
    error: string
    dry_run: number
  }
  assert.equal(row.status, "sent")
  assert.equal(row.sent_at, NOW)
  // The dry run is recorded in its own column, not smuggled into `error`.
  // `error` is for real errors; overloading it is what made the uniqueness
  // index unable to tell a rehearsal from a real send.
  assert.equal(row.dry_run, 1)
  assert.doesNotMatch(row.error, /dryRun/)

  getDb().exec("DELETE FROM messages")
})

test("the unique index makes a second real send of the same step a no-op", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  const input = {
    leadId: lead.id,
    mailboxId: mailbox.id,
    to: lead.email,
    subject: "Vending machines for your break room",
    text: "Hi — quick question about your break room.",
    sequenceStep: 1,
    leadTimezone: TZ,
  }
  const deps = { transport: liveTransport(), now: () => NOW, pacing: NO_GAP }

  const first = await sendMessage(input, deps)
  assert.equal(first.status, "sent")

  // The same task runs twice — a duplicate queue entry, a crashed worker, a
  // second process. UNIQUE(lead_id, sequence_step) is what stops this being a
  // second cold email; the violation is interpreted as "already sent".
  const second = await sendMessage(input, deps)
  assert.equal(second.status, "duplicate")
  if (second.status === "duplicate") {
    assert.match(second.reason, /already sent/)
  }

  const count = getDb()
    .prepare(
      `SELECT count(*) AS n FROM messages WHERE lead_id = ? AND direction = 'out'`
    )
    .get(lead.id) as { n: number }
  assert.equal(Number(count.n), 1)

  getDb().exec("DELETE FROM messages")
})

test("a dry run does not consume the real send of that step", async () => {
  // The bug this proves gone: `ux_msg_step` used to cover dry-run rows, so
  // rehearsing a step permanently blocked the real email for that lead.
  // Dry-running the first 200 leads silently burned all 200.
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  const input = {
    leadId: lead.id,
    mailboxId: mailbox.id,
    to: lead.email,
    subject: "Vending machines for your break room",
    text: "Hi — quick question about your break room.",
    sequenceStep: 1,
    leadTimezone: TZ,
  }

  const rehearsal = await sendMessage(input, {
    transport: fileTransport(),
    now: () => NOW,
    pacing: NO_GAP,
  })
  assert.equal(rehearsal.status, "sent")
  if (rehearsal.status !== "sent") return
  assert.equal(rehearsal.dryRun, true)

  const real = await sendMessage(input, {
    transport: liveTransport(),
    now: () => NOW,
    pacing: NO_GAP,
  })
  assert.equal(real.status, "sent")
  if (real.status !== "sent") return
  assert.equal(real.dryRun, false)
  assert.notEqual(real.rowId, rehearsal.rowId)

  const rows = getDb()
    .prepare(
      `SELECT dry_run FROM messages WHERE lead_id = ? AND direction = 'out'
       ORDER BY dry_run DESC`
    )
    .all(lead.id) as unknown as { dry_run: number }[]
  assert.deepEqual(
    rows.map((row) => row.dry_run),
    [1, 0]
  )

  getDb().exec("DELETE FROM messages")
  getDb().exec("DELETE FROM events")
})

test("a real send is still blocked once a real send of that step exists", async () => {
  // The other half of the same index: excluding dry runs must not have
  // loosened the guarantee for the sends that actually reach a stranger.
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  const input = {
    leadId: lead.id,
    mailboxId: mailbox.id,
    to: lead.email,
    subject: "Vending machines for your break room",
    text: "Hi — quick question about your break room.",
    sequenceStep: 2,
    leadTimezone: TZ,
  }

  assert.equal(
    (
      await sendMessage(input, {
        transport: fileTransport(),
        now: () => NOW,
        pacing: NO_GAP,
      })
    ).status,
    "sent"
  )
  assert.equal(
    (
      await sendMessage(input, {
        transport: liveTransport(),
        now: () => NOW,
        pacing: NO_GAP,
      })
    ).status,
    "sent"
  )

  // A dry-run row and a real row now both sit on (lead, step 2). The duplicate
  // lookup must find the real one — it is the row the index fired on — and
  // report it as already sent rather than picking the rehearsal.
  const third = await sendMessage(input, {
    transport: liveTransport(),
    now: () => NOW,
    pacing: NO_GAP,
  })
  assert.equal(third.status, "duplicate")
  if (third.status !== "duplicate") return
  assert.match(third.reason, /already sent/)

  const real = getDb()
    .prepare(
      `SELECT id FROM messages
       WHERE lead_id = ? AND sequence_step = 2 AND dry_run = 0`
    )
    .get(lead.id) as { id: string }
  assert.equal(third.rowId, real.id)

  getDb().exec("DELETE FROM messages")
  getDb().exec("DELETE FROM events")
})

test("two dry runs of the same step do NOT collide — a known fidelity gap", async () => {
  // Documenting a consequence of the index, not endorsing it. Because
  // `ux_msg_step` skips `dry_run = 1` entirely, dry runs no longer dedupe
  // against each other, so rehearsing the same step twice writes two rows and
  // consumes two slots of the derived daily count. Nothing is sent either way.
  //
  // If a future migration adds a matching `WHERE ... dry_run = 1` index to
  // restore that, this test is the one that will tell you.
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  const input = {
    leadId: lead.id,
    mailboxId: mailbox.id,
    to: lead.email,
    subject: "Vending machines for your break room",
    text: "Hi — quick question about your break room.",
    sequenceStep: 3,
    leadTimezone: TZ,
  }
  const deps = { transport: fileTransport(), now: () => NOW, pacing: NO_GAP }

  assert.equal((await sendMessage(input, deps)).status, "sent")
  assert.equal((await sendMessage(input, deps)).status, "sent")

  const count = getDb()
    .prepare(
      `SELECT count(*) AS n FROM messages WHERE lead_id = ? AND dry_run = 1`
    )
    .get(lead.id) as { n: number }
  assert.equal(Number(count.n), 2)
  assert.equal(countDryRunMessages(), 2)

  // The tidy-up path keys off the column now, not a substring of `error`.
  assert.equal(clearDryRunMessages(), 2)
  assert.equal(countDryRunMessages(), 0)

  getDb().exec("DELETE FROM messages")
  getDb().exec("DELETE FROM events")
})

test("an off-sequence send without a dedupe key is refused outright", async () => {
  const mailbox = seedMailbox()
  const lead = seedLead()
  await assert.rejects(
    () =>
      sendMessage(
        {
          leadId: lead.id,
          mailboxId: mailbox.id,
          to: lead.email,
          subject: "More information",
          text: "Attached.",
          sequenceStep: null,
        },
        { transport: fileTransport(), now: () => NOW, pacing: NO_GAP }
      ),
    /requires a dedupeKey/
  )
})

test("an off-sequence send is deduped by its key", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const input = {
    leadId: lead.id,
    mailboxId: mailbox.id,
    to: lead.email,
    subject: "The one-pager you asked for",
    text: "Here it is.",
    sequenceStep: null,
    dedupeKey: `send_more_info:${lead.id}`,
    isAutoReply: true,
  }
  const deps = { transport: fileTransport(), now: () => NOW, pacing: NO_GAP }

  assert.equal((await sendMessage(input, deps)).status, "sent")
  assert.equal((await sendMessage(input, deps)).status, "duplicate")

  getDb().exec("DELETE FROM messages")
  getDb().exec("DELETE FROM events")
})

test("suppression added after the task was queued still stops the send (TOCTOU)", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  // The "not interested" arrived at 09:02; this send was queued for 09:05.
  getDb()
    .prepare(
      `INSERT INTO suppressed (email, reason, created_at) VALUES (?, 'not interested', ?)`
    )
    .run(lead.email, NOW)

  const outcome = await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Following up",
      text: "Just checking in.",
      sequenceStep: 2,
      leadTimezone: TZ,
    },
    { transport: fileTransport(), now: () => NOW, pacing: NO_GAP }
  )
  assert.equal(outcome.status, "suppressed")

  // Nothing was written: the row is inserted inside the same transaction as the
  // re-check, so a suppressed send leaves no trace of an attempt.
  const count = getDb()
    .prepare(`SELECT count(*) AS n FROM messages WHERE lead_id = ?`)
    .get(lead.id) as { n: number }
  assert.equal(Number(count.n), 0)

  getDb().exec("DELETE FROM suppressed")
})

test("a tripped circuit breaker blocks every send until it is re-armed", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  // Six auto-replies inside the rolling hour.
  const insertEvent = getDb().prepare(
    `INSERT INTO events (lead_id, type, detail_json, created_at) VALUES (?, 'send.auto_reply', NULL, ?)`
  )
  for (let i = 0; i < 6; i++) insertEvent.run(lead.id, NOW - i * 60_000)

  const report = checkCircuitBreakers({ now: NOW, pacing: PACING })
  assert.equal(report.tripped, true)
  assert.equal(report.state?.breaker, "auto_reply_burst")

  const outcome = await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Hello",
      text: "Hi.",
      sequenceStep: 3,
      leadTimezone: TZ,
    },
    { transport: fileTransport(), now: () => NOW, pacing: NO_GAP }
  )
  assert.equal(outcome.status, "blocked")
  if (outcome.status === "blocked")
    assert.equal(outcome.code, "circuit_breaker")

  rearmCircuitBreaker("test")
  assert.equal(getCircuitBreakerState(), null)
  getDb().exec("DELETE FROM events")
})

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

test("reconcile: found in Sent Mail marks the row sent and captures the REAL Message-ID", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const outreachId = randomUUID()
  const rowId = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO messages (id, lead_id, mailbox_id, direction, sequence_step,
                             outreach_id, message_id, status, created_at)
       VALUES (?, ?, ?, 'out', 4, ?, ?, 'sending', ?)`
    )
    .run(
      rowId,
      lead.id,
      mailbox.id,
      outreachId,
      "<nodemailer-generated@vendingco.example>",
      NOW
    )

  const outcome = await reconcile(mailbox, outreachId, {
    now: () => NOW,
    searcher: fakeSearcher({
      outreachId,
      // Gmail rewrote it. THIS is the value follow-ups must thread on.
      messageId: "<CAF=rewritten-by-gmail@mail.gmail.com>",
      gmThrid: "1798000000000000000",
      uid: 42,
      internalDate: NOW - 1000,
    }),
  })

  assert.equal(outcome.status, "sent")
  const row = getDb()
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(rowId) as { status: string; message_id: string; gm_thrid: string }
  assert.equal(row.status, "sent")
  assert.equal(row.message_id, "<CAF=rewritten-by-gmail@mail.gmail.com>")
  assert.equal(row.gm_thrid, "1798000000000000000")

  getDb().exec("DELETE FROM messages")
})

test("reconcile: absent from Sent Mail permits exactly one resend", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const outreachId = randomUUID()
  const rowId = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO messages (id, lead_id, mailbox_id, direction, sequence_step,
                             outreach_id, status, error, created_at)
       VALUES (?, ?, ?, 'out', 5, ?, 'sending', ?, ?)`
    )
    .run(
      rowId,
      lead.id,
      mailbox.id,
      outreachId,
      JSON.stringify({ attempts: 1, step: 5 }),
      NOW
    )

  const outcome = await reconcile(mailbox, outreachId, {
    now: () => NOW,
    searcher: fakeSearcher(null),
  })
  assert.equal(outcome.status, "not_sent")

  const afterReconcile = getDb()
    .prepare(`SELECT status FROM messages WHERE id = ?`)
    .get(rowId) as { status: string }
  assert.equal(afterReconcile.status, "retryable")

  // The retry takes the SAME row over rather than inserting a second one, so
  // the (lead, step) pair still holds exactly one message. It runs on a live
  // transport because the attempt being retried was a real one — `ux_msg_step`
  // only covers `dry_run = 0`, so a dry run would sidestep the takeover
  // entirely and write its own row.
  const retry = await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Second attempt",
      text: "Body.",
      sequenceStep: 5,
      leadTimezone: TZ,
    },
    { transport: liveTransport(), now: () => NOW, pacing: NO_GAP }
  )
  assert.equal(retry.status, "sent")
  if (retry.status === "sent") assert.equal(retry.rowId, rowId)

  const count = getDb()
    .prepare(
      `SELECT count(*) AS n FROM messages WHERE lead_id = ? AND sequence_step = 5`
    )
    .get(lead.id) as { n: number }
  assert.equal(Number(count.n), 1)

  getDb().exec("DELETE FROM messages")
})

test("an unreconciled 'sending' row blocks any further attempt at that step", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()
  getDb()
    .prepare(
      `INSERT INTO messages (id, lead_id, mailbox_id, direction, sequence_step,
                             outreach_id, status, error, created_at)
       VALUES (?, ?, ?, 'out', 6, ?, 'sending', ?, ?)`
    )
    .run(
      randomUUID(),
      lead.id,
      mailbox.id,
      randomUUID(),
      JSON.stringify({ attempts: 1, step: 6 }),
      NOW
    )

  // This is the case that would produce a duplicate cold email if the row were
  // simply retried: the previous attempt may well have been delivered. Live
  // transport, because only a real send can produce that duplicate — a dry run
  // is outside `ux_msg_step` and writes its own row without being blocked.
  const outcome = await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Retry",
      text: "Body.",
      sequenceStep: 6,
      leadTimezone: TZ,
    },
    { transport: liveTransport(), now: () => NOW, pacing: NO_GAP }
  )
  assert.equal(outcome.status, "blocked")
  if (outcome.status === "blocked") {
    assert.equal(outcome.code, "needs_reconciliation")
  }

  getDb().exec("DELETE FROM messages")
})

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

class ThrowingTransport extends FileTransport {
  readonly error: unknown
  constructor(error: unknown) {
    super(path.join(TMP_ROOT, "never-written"))
    this.error = error
  }
  override async send(): Promise<never> {
    throw this.error
  }
}

test("550 5.4.5 pauses the mailbox and leaves the message retryable, not dead", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  const outcome = await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Hello",
      text: "Hi.",
      sequenceStep: 7,
      leadTimezone: TZ,
    },
    {
      transport: new ThrowingTransport({
        message: "Daily user sending limit exceeded",
        responseCode: 550,
        response: "550 5.4.5 Daily user sending limit exceeded",
        command: "DATA",
      }),
      now: () => NOW,
      pacing: NO_GAP,
    }
  )

  assert.equal(outcome.status, "failed")
  if (outcome.status === "failed") {
    assert.equal(outcome.classification.kind, "daily_limit")
  }

  // The lead is NOT dead and the row is NOT permanently failed.
  const row = getDb()
    .prepare(
      `SELECT status FROM messages WHERE lead_id = ? AND sequence_step = 7`
    )
    .get(lead.id) as { status: string }
  assert.equal(row.status, "retryable")

  const gate = canSendNow(mailbox.id, TZ, { now: NOW, pacing: NO_GAP })
  assert.equal(gate.ok, false)
  if (!gate.ok) assert.equal(gate.code, "mailbox_paused")

  resetGlobalState()
  getDb().exec("DELETE FROM messages")
})

test("535-5.7.8 disables every mailbox and halts the app", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Hello",
      text: "Hi.",
      sequenceStep: 8,
      leadTimezone: TZ,
    },
    {
      transport: new ThrowingTransport({
        message: "Invalid login",
        responseCode: 535,
        response: "535-5.7.8 Username and Password not accepted",
        command: "AUTH PLAIN",
        code: "EAUTH",
      }),
      now: () => NOW,
      pacing: NO_GAP,
    }
  )

  const after = getMailboxById(mailbox.id)
  assert.equal(after?.status, "disabled")
  assert.equal(getCircuitBreakerState()?.breaker, "auth_revoked")

  resetGlobalState()
  getDb().exec("DELETE FROM messages")
})

test("a 5xx at RCPT TO suppresses the address and never retries", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Hello",
      text: "Hi.",
      sequenceStep: 9,
      leadTimezone: TZ,
    },
    {
      transport: new ThrowingTransport({
        message: "Recipient address rejected",
        responseCode: 550,
        response:
          "550-5.1.1 The email account that you tried to reach does not exist.",
        command: "RCPT TO",
      }),
      now: () => NOW,
      pacing: NO_GAP,
    }
  )

  const suppressed = getDb()
    .prepare(`SELECT count(*) AS n FROM suppressed WHERE email = ?`)
    .get(lead.email) as { n: number }
  assert.equal(Number(suppressed.n), 1)

  const row = getDb()
    .prepare(
      `SELECT status FROM messages WHERE lead_id = ? AND sequence_step = 9`
    )
    .get(lead.id) as { status: string }
  assert.equal(row.status, "failed")

  getDb().exec("DELETE FROM suppressed")
  getDb().exec("DELETE FROM messages")
})

test("an ambiguous failure with no reconciler leaves the row unresolved, never retried", async () => {
  resetGlobalState()
  const mailbox = seedMailbox()
  const lead = seedLead()

  const outcome = await sendMessage(
    {
      leadId: lead.id,
      mailboxId: mailbox.id,
      to: lead.email,
      subject: "Hello",
      text: "Hi.",
      sequenceStep: 10,
      leadTimezone: TZ,
    },
    {
      transport: new ThrowingTransport({
        message: "Timeout",
        code: "ETIMEDOUT",
        command: "DATA",
      }),
      now: () => NOW,
      pacing: NO_GAP,
    }
  )

  assert.equal(outcome.status, "failed")
  if (outcome.status === "failed") assert.equal(outcome.unresolved, true)

  const row = getDb()
    .prepare(
      `SELECT status FROM messages WHERE lead_id = ? AND sequence_step = 10`
    )
    .get(lead.id) as { status: string }
  // Still `sending`: nothing but reconciliation may move it.
  assert.equal(row.status, "sending")

  getDb().exec("DELETE FROM messages")
})
