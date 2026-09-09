/**
 * Tests for the inbound mail layer.
 *
 * INVARIANT FOR THIS FILE: no test may open a network connection. `ImapFlow` is
 * imported by the module under test but never constructed here — every test
 * drives `handleInboundMessage` with a raw message string, or the pure sync
 * planner, both of which are the parts that make decisions.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-recv-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")
process.env.VENDING_STOP_FILE = path.join(TMP_ROOT, "STOP-does-not-exist")
delete process.env.SEND_ENABLED

import {
  applySyncPlan,
  extractTextBody,
  handleInboundMessage,
  INBOX_PATH,
  loadFolderState,
  parseHeaderBlock,
  parseRawMessage,
  planMailboxSync,
  saveFolderState,
  shouldSkipByWatermark,
  SPAM_PATH,
  type InboundRecord,
} from "./mail-receive.ts"
import { getCircuitBreakerState, rearmCircuitBreaker } from "./mail-send.ts"
import { enqueue, getDb, upsertMailbox, type MailboxRow } from "./db.ts"
import { NON_ENGAGEMENT_MESSAGE_STATUSES } from "../worker/handlers/common.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-recv-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OUR_MAILBOX = "sales@vendingco.example"
const NOW = Date.parse("2025-03-11T14:00:00Z")

let counter = 0

function seedMailbox(): MailboxRow {
  const existing = getDb()
    .prepare(`SELECT id FROM mailboxes WHERE email = ?`)
    .get(OUR_MAILBOX) as { id: string } | undefined
  return upsertMailbox({
    ...(existing ? { id: existing.id } : {}),
    email: OUR_MAILBOX,
    appPassword: "abcd efgh ijkl mnop",
    dailyCap: 25,
  })
}

function seedLead(): { id: string; email: string } {
  counter++
  const email = `owner@lead${counter}.example`
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO leads (id, name, email, timezone, status, score, created_at)
       VALUES (?, ?, ?, 'America/New_York', 'contacted', 0, ?)`
    )
    .run(id, `Lead ${counter}`, email, NOW)
  return { id, email }
}

/** Seeds an outbound message so bounces and threading have something to match. */
function seedOutbound(
  leadId: string,
  mailboxId: string,
  step: number
): { outreachId: string; messageId: string } {
  const outreachId = randomUUID()
  const messageId = `<step${step}-${outreachId}@vendingco.example>`
  getDb()
    .prepare(
      `INSERT INTO messages (id, lead_id, mailbox_id, direction, sequence_step,
                             outreach_id, message_id, status, sent_at, created_at)
       VALUES (?, ?, ?, 'out', ?, ?, ?, 'sent', ?, ?)`
    )
    .run(
      randomUUID(),
      leadId,
      mailboxId,
      step,
      outreachId,
      messageId,
      NOW - 86_400_000,
      NOW - 86_400_000
    )
  return { outreachId, messageId }
}

function rawMessage(headers: Record<string, string>, body: string): string {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`)
  return `${lines.join("\r\n")}\r\n\r\n${body}`
}

function record(
  mailbox: MailboxRow,
  raw: string,
  overrides: Partial<InboundRecord> = {}
): InboundRecord {
  counter++
  return {
    mailboxId: mailbox.id,
    mailboxEmail: mailbox.email,
    folder: INBOX_PATH,
    uidValidity: 1,
    uid: 1000 + counter,
    internalDate: NOW,
    gmThrid: null,
    raw,
    ...overrides,
  }
}

const DEPS = { now: () => NOW, ourMailboxes: [OUR_MAILBOX] }

function reset(): void {
  rearmCircuitBreaker("test reset")
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test("header parsing is multi-valued and unfolds continuation lines", () => {
  const headers = parseHeaderBlock(
    [
      "From: Dana Owner <dana@acme.example>",
      "Received: from a",
      "Received: from b",
      "List-Unsubscribe: <mailto:stop@acme.example>,",
      "\t<https://acme.example/stop>",
    ].join("\r\n")
  )
  assert.equal(headers["From"], "Dana Owner <dana@acme.example>")
  assert.deepEqual(headers["Received"], ["from a", "from b"])
  assert.equal(
    headers["List-Unsubscribe"],
    "<mailto:stop@acme.example>, <https://acme.example/stop>"
  )
})

test("quoted-printable soft line breaks are joined before the opt-out scan", () => {
  // Without soft-break handling, "remove=\r\nme" never matches the opt-out
  // regex and a real opt-out is missed.
  const raw = rawMessage(
    {
      From: "owner@acme.example",
      "Content-Type": 'text/plain; charset="utf-8"',
      "Content-Transfer-Encoding": "quoted-printable",
    },
    "Please remo=\r\nve me from your list. Thanks =E2=80=94 Dana"
  )
  const parsed = parseRawMessage(raw)
  assert.match(parsed.body, /remove me from your list/)
  assert.match(parsed.body, /—/)
})

test("multipart/alternative yields the text/plain part", () => {
  const raw = [
    "From: owner@acme.example",
    'Content-Type: multipart/alternative; boundary="bnd1"',
    "",
    "--bnd1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Plain text body here.",
    "--bnd1",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>HTML body here.</p>",
    "--bnd1--",
  ].join("\r\n")
  assert.match(parseRawMessage(raw).body, /Plain text body here/)
})

test("a multipart/report body is kept whole so triage can read the DSN status", () => {
  // Reducing a DSN to its human-readable part would drop `Status: 5.1.1`, and
  // every bounce would then default to soft — dead addresses would keep
  // receiving follow-ups.
  const headers = parseHeaderBlock(
    'Content-Type: multipart/report; report-type=delivery-status; boundary="b"'
  )
  const body = [
    "--b",
    "Content-Type: text/plain",
    "",
    "Delivery to the following recipient failed permanently.",
    "--b",
    "Content-Type: message/delivery-status",
    "",
    "Final-Recipient: rfc822; owner@acme.example",
    "Status: 5.1.1",
    "--b--",
  ].join("\r\n")
  const extracted = extractTextBody(headers, body)
  assert.match(extracted, /message\/delivery-status/)
  assert.match(extracted, /Status: 5\.1\.1/)
})

// ---------------------------------------------------------------------------
// UIDVALIDITY (spec §6)
// ---------------------------------------------------------------------------

test("a UIDVALIDITY change does NOT reprocess the mailbox", () => {
  const mailbox = seedMailbox()
  const folder = SPAM_PATH
  const earlier = NOW - 30 * 86_400_000

  // We had walked this folder up to uid 100 under UIDVALIDITY 1.
  saveFolderState(mailbox.id, folder, {
    uidValidity: 1,
    lastUid: 100,
    watermarkAt: earlier,
  })

  // The server comes back with a different UIDVALIDITY. Every stored UID is
  // now meaningless, and the new generation's UID space restarts low.
  const plan = planMailboxSync(
    loadFolderState(mailbox.id, folder),
    { uidValidity: 2, uidNext: 7 },
    NOW
  )
  assert.equal(plan.mode, "uidvalidity_reset")
  assert.equal(plan.fromUid, 7)
  assert.equal(plan.uidValidity, 2)
  // The watermark moves forward to the reset instant and never backwards.
  assert.equal(plan.watermarkAt, NOW)

  const state = applySyncPlan(mailbox.id, folder, plan)
  assert.equal(state.lastUid, 6)
  assert.equal(state.watermarkAt, NOW)

  // The protection that matters: old mail that survived into the new
  // generation with a low UID is refused by the date watermark, so none of it
  // is replayed through the handler.
  assert.equal(shouldSkipByWatermark(state, earlier), true)
  assert.equal(shouldSkipByWatermark(state, NOW - 1), true)
  assert.equal(shouldSkipByWatermark(state, NOW + 1000), false)
  // A message with no internal date is handled rather than silently dropped.
  assert.equal(shouldSkipByWatermark(state, null), false)

  // And a subsequent connect with the SAME uidvalidity just resumes.
  const resume = planMailboxSync(
    loadFolderState(mailbox.id, folder),
    { uidValidity: 2, uidNext: 12 },
    NOW + 60_000
  )
  assert.equal(resume.mode, "resume")
  assert.equal(resume.fromUid, 7)
  assert.equal(resume.watermarkAt, NOW)
})

test("the first connect to a folder starts at uidNext and backfills nothing", () => {
  const mailbox = seedMailbox()
  const plan = planMailboxSync(
    { uidValidity: null, lastUid: null, watermarkAt: null },
    { uidValidity: 9, uidNext: 5000 },
    NOW
  )
  assert.equal(plan.mode, "initial")
  assert.equal(plan.fromUid, 5000)
  assert.equal(plan.watermarkAt, NOW)
  assert.equal(applySyncPlan(mailbox.id, "INBOX-first", plan).lastUid, 4999)
})

// ---------------------------------------------------------------------------
// THE REQUIRED FIX
// ---------------------------------------------------------------------------

test("list-stamped + 'remove me' from the lead's own address is SUPPRESSED", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()

  // The day-9 follow-up is already queued. It must not survive this message.
  const taskId = enqueue("send", {
    leadId: lead.id,
    runAfter: NOW + 9 * 86_400_000,
  })

  // triage() returns `ignore` here: the List-Unsubscribe header matches rule 4,
  // which sits ABOVE the opt-out rule in the spec's first-match-wins order.
  // `ignore` stops the reply but NOT the follow-up — the exact per-email
  // CAN-SPAM violation. The override in handleInboundMessage is what closes it.
  const raw = rawMessage(
    {
      From: `Dana Owner <${lead.email}>`,
      To: OUR_MAILBOX,
      Subject: "Re: Vending machines for your break room",
      "Message-ID": "<optout-1@lead.example>",
      "List-Unsubscribe": "<mailto:unsubscribe@lead.example>",
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "Please remove me from your list. We are not interested."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)

  assert.equal(result.action, "suppress")
  assert.equal(result.suppressed, true)
  // The verdict triage actually returned is preserved for observability, and
  // proves the override — not a change to triage — is what did the work.
  assert.equal(result.verdict?.action, "ignore")
  assert.match(result.reason, /opt-out from the lead's own address/)

  const suppressed = getDb()
    .prepare(`SELECT count(*) AS n FROM suppressed WHERE email = ?`)
    .get(lead.email) as { n: number }
  assert.equal(Number(suppressed.n), 1)

  // The queued follow-up is cancelled in the same transaction as the
  // suppression write.
  const task = getDb()
    .prepare(`SELECT status FROM tasks WHERE id = ?`)
    .get(taskId) as { status: string }
  assert.equal(task.status, "cancelled")

  const leadRow = getDb()
    .prepare(`SELECT status FROM leads WHERE id = ?`)
    .get(lead.id) as { status: string }
  assert.equal(leadRow.status, "suppressed")
})

test("the same words in a newsletter footer from a THIRD party do not suppress the lead", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()

  // Every newsletter footer on earth contains "unsubscribe". Scoping the
  // override to the lead's own contact address is what stops this from
  // suppressing a live lead the moment any bulk mail arrives.
  const raw = rawMessage(
    {
      From: "Industry Weekly <news@someothernewsletter.example>",
      To: OUR_MAILBOX,
      Subject: "This week in vending",
      "Message-ID": "<newsletter-1@someothernewsletter.example>",
      "List-Id": "<news.someothernewsletter.example>",
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "Top stories this week...\n\nTo unsubscribe from this list, click here."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  // Nothing links it to a lead, so it is escalated rather than acted on.
  assert.equal(result.action, "unmatched")
  assert.equal(result.suppressed, false)

  const suppressed = getDb()
    .prepare(`SELECT count(*) AS n FROM suppressed WHERE email = ?`)
    .get(lead.email) as { n: number }
  assert.equal(Number(suppressed.n), 0)
})

// ---------------------------------------------------------------------------
// Verdict handling
// ---------------------------------------------------------------------------

test("a plain human reply is the ONLY thing that enqueues a classify task", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const out = seedOutbound(lead.id, mailbox.id, 0)

  const raw = rawMessage(
    {
      From: lead.email,
      To: OUR_MAILBOX,
      Subject: "Re: Vending machines for your break room",
      "Message-ID": "<human-reply-1@lead.example>",
      "In-Reply-To": out.messageId,
      References: out.messageId,
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "Sounds interesting. Could you send over pricing and what the installation timeline looks like for our two facilities in Dublin and Hilliard?"
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.equal(result.action, "classify")
  assert.ok(result.taskId)

  const task = getDb()
    .prepare(`SELECT kind, lead_id, status FROM tasks WHERE id = ?`)
    .get(result.taskId as string) as {
    kind: string
    lead_id: string
    status: string
  }
  assert.equal(task.kind, "classify")
  assert.equal(task.lead_id, lead.id)
})

test("an autoresponder is ignored and enqueues nothing", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  seedOutbound(lead.id, mailbox.id, 0)

  const before = getDb().prepare(`SELECT count(*) AS n FROM tasks`).get() as {
    n: number
  }

  const raw = rawMessage(
    {
      From: lead.email,
      To: OUR_MAILBOX,
      Subject: "Automatic reply: Vending machines",
      "Message-ID": "<ooo-1@lead.example>",
      "Auto-Submitted": "auto-replied",
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "I am out of the office until Monday."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.equal(result.action, "ignore")
  assert.equal(result.taskId, undefined)

  const after = getDb().prepare(`SELECT count(*) AS n FROM tasks`).get() as {
    n: number
  }
  assert.equal(Number(after.n), Number(before.n))
})

test("a hard bounce is recorded and suppressed, and never replied to", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const out = seedOutbound(lead.id, mailbox.id, 0)

  const raw = [
    "Return-Path: <>",
    "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    `To: ${OUR_MAILBOX}`,
    "Subject: Delivery Status Notification (Failure)",
    "Message-ID: <dsn-1@googlemail.com>",
    'Content-Type: multipart/report; report-type=delivery-status; boundary="bnd"',
    "",
    "--bnd",
    "Content-Type: text/plain",
    "",
    "Address not found. Your message was not delivered.",
    "--bnd",
    "Content-Type: message/delivery-status",
    "",
    `Final-Recipient: rfc822; ${lead.email}`,
    "Action: failed",
    "Status: 5.1.1",
    "--bnd",
    "Content-Type: message/rfc822",
    "",
    // The bounce quotes our original headers, which is how the outreach id
    // travels back to us.
    `X-Outreach-Id: ${out.outreachId}`,
    `X-Loop: ${OUR_MAILBOX}`,
    "Subject: Vending machines for your break room",
    "--bnd--",
  ].join("\r\n")

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.equal(result.action, "bounce")
  assert.equal(result.suppressed, true)

  const suppressed = getDb()
    .prepare(`SELECT count(*) AS n FROM suppressed WHERE email = ?`)
    .get(lead.email) as { n: number }
  assert.equal(Number(suppressed.n), 1)

  // The bounce is attributed to the originating message so the hard-bounce-rate
  // breaker can see it.
  const row = getDb()
    .prepare(`SELECT error FROM messages WHERE outreach_id = ?`)
    .get(out.outreachId) as { error: string }
  assert.match(row.error, /"bounce":"hard"/)

  // A bounce quotes our own X-Loop header. That must NOT be read as a live
  // mail loop, or every hard bounce would halt the whole app.
  assert.equal(getCircuitBreakerState(), null)
})

// ---------------------------------------------------------------------------
// Dedupe and own-mail
// ---------------------------------------------------------------------------

test("the same message is handled once, by UID and again by Message-ID", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  seedOutbound(lead.id, mailbox.id, 0)

  const raw = rawMessage(
    {
      From: lead.email,
      To: OUR_MAILBOX,
      Subject: "Re: Vending machines",
      "Message-ID": "<dupe-1@lead.example>",
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "Thanks for reaching out, please send pricing details for both of our sites."
  )

  const rec = record(mailbox, raw)
  assert.equal(handleInboundMessage(rec, DEPS).action, "classify")

  // Same UID again — an IDLE re-drain after a reconnect.
  assert.equal(handleInboundMessage(rec, DEPS).action, "duplicate")

  // Different UID, different folder, same Message-ID: this is the Spam copy of
  // a message we already handled from INBOX.
  const spamCopy = handleInboundMessage(
    { ...rec, folder: SPAM_PATH, uid: rec.uid + 9999, uidValidity: 77 },
    DEPS
  )
  assert.equal(spamCopy.action, "duplicate")
  assert.match(spamCopy.reason, /Message-ID/)
})

test("mail whose From is one of our own mailboxes is dropped and alarms", () => {
  reset()
  const mailbox = seedMailbox()

  const raw = rawMessage(
    {
      From: OUR_MAILBOX,
      To: OUR_MAILBOX,
      Subject: "Vending machines for your break room",
      "Message-ID": "<ourown-1@vendingco.example>",
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "Hi — quick question about your break room."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.equal(result.action, "dropped_own_mail")
  assert.ok(result.loopAlarm)
  // Our own message arriving in INBOX is the first half of a robot mail loop.
  assert.equal(getCircuitBreakerState()?.breaker, "auto_reply_burst")
  reset()
})

test("an inbound message with our X-Loop header as a top-level header halts", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  seedOutbound(lead.id, mailbox.id, 0)

  const raw = rawMessage(
    {
      From: lead.email,
      To: OUR_MAILBOX,
      Subject: "Re: Vending machines",
      "Message-ID": "<loop-1@lead.example>",
      // Our own marker came back at the top level: our message is being echoed
      // back at us as a message, not merely quoted inside one.
      "X-Loop": OUR_MAILBOX,
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "Hi — quick question about your break room."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.ok(result.loopAlarm)
  assert.equal(result.action, "escalate")
  assert.ok(getCircuitBreakerState() !== null)
  reset()
})

test("a reply from a third party is escalated, never auto-handled", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const out = seedOutbound(lead.id, mailbox.id, 0)

  const raw = rawMessage(
    {
      From: "someone.else@bigcorp.example",
      To: OUR_MAILBOX,
      Subject: "Fwd: Vending machines",
      "Message-ID": "<forwarded-1@bigcorp.example>",
      "In-Reply-To": out.messageId,
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "My colleague forwarded me your note, I handle facilities for the group now."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.equal(result.action, "escalate")
  assert.equal(result.taskId, undefined)
})

// ---------------------------------------------------------------------------
// Escalation lands where /inbox can actually see it (review findings 3 and 4)
// ---------------------------------------------------------------------------

test("an escalated reply moves the lead to hot, not replied", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const out = seedOutbound(lead.id, mailbox.id, 0)

  const raw = rawMessage(
    {
      From: "someone.else@bigcorp.example",
      To: OUR_MAILBOX,
      Subject: "Fwd: Vending machines",
      "Message-ID": "<escalate-status-1@bigcorp.example>",
      "In-Reply-To": out.messageId,
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "Forwarding to the person who handles this."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.equal(result.action, "escalate")

  // `listInboxThreads` selects on `hot`. Writing `replied` here put the lead
  // in a status the inbox query excludes, so escalated replies landed nowhere
  // and the inbox reported that nothing needed attention.
  const row = getDb()
    .prepare(`SELECT status FROM leads WHERE id = ?`)
    .get(lead.id) as { status: string }
  assert.equal(row.status, "hot")
})

test("a subject-only out-of-office does not count as the lead replying", () => {
  reset()
  const mailbox = seedMailbox()
  const lead = seedLead()
  const out = seedOutbound(lead.id, mailbox.id, 0)

  const raw = rawMessage(
    {
      From: lead.email,
      To: OUR_MAILBOX,
      Subject: "Automatic reply: Vending machines",
      "Message-ID": "<ooo-subject-1@lead.example>",
      "In-Reply-To": out.messageId,
      Date: "Tue, 11 Mar 2025 10:00:00 -0400",
    },
    "I am out of the office until Monday with limited access to email."
  )

  const result = handleInboundMessage(record(mailbox, raw), DEPS)
  assert.equal(result.action, "escalate")

  // Triage rule 13 catches this by subject alone, so it never reaches a model
  // and never gets the `classified:out_of_office` stamp. Without its own
  // status it counted as a genuine reply and permanently cancelled the
  // sequence — a vacation responder killing the lead outright (spec §3 says an
  // out-of-office does not count as engagement).
  const row = getDb()
    .prepare(`SELECT status FROM messages WHERE id = ?`)
    .get(result.messageRowId) as { status: string }
  assert.equal(row.status, "triaged:escalate:autoresponder")
  assert.ok(
    NON_ENGAGEMENT_MESSAGE_STATUSES.includes(row.status),
    "an autoresponder must not be treated as the lead engaging"
  )
})
