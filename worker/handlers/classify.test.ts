/**
 * Tests for the auto-reply action set — BUILD-SPEC §3.
 *
 * THE CENTRAL SAFETY PROPERTY UNDER TEST:
 *
 *   Zero LLM-authored bytes may ever reach a stranger automatically.
 *
 * The table test below feeds the SAME inbound reply for every intent and
 * changes only the label the model returns, so the switch is the only variable.
 * Two intents must produce complete silence — not a courtesy reply, not a
 * confirmation, no send call at all — and the `send_more_info` case asserts
 * that the bytes which do go out came from `FIXED_REPLY_TEMPLATES` and contain
 * nothing the model wrote.
 *
 * INVARIANT FOR THIS FILE: no network, no SMTP, no IMAP, no model.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-classify-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")
process.env.VENDING_STOP_FILE = path.join(TMP_ROOT, "STOP-does-not-exist")
delete process.env.SEND_ENABLED

import {
  enqueue,
  getDb,
  getLeadById,
  isSuppressed,
  type TaskRow,
} from "../../lib/db.ts"
import {
  FIXED_REPLY_TEMPLATES,
  REPLY_INTENTS,
  replyClassificationSchema,
  type ReplyClassification,
} from "../../lib/prompts.ts"
import type { SendMessageInput, SendOutcome } from "../../lib/mail-send.ts"
import {
  MAX_OOO_DEFER_MS,
  actionForIntent,
  actionSendsBytes,
  handleClassify,
  parseReturnDate,
  resolveOooDeferUntil,
  type ClassifyAction,
  type ClassifyDeps,
} from "./classify.ts"
import type { TaskLike } from "./common.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-classify-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = Date.now()

/**
 * One reply body, reused for every intent. Long enough not to be a "short
 * negative", and it carries a phrase the fake model can quote verbatim so
 * evidence grounding passes.
 */
const REPLY_BODY =
  "Thanks for reaching out about this. Could you tell me a bit more about " +
  "how the arrangement works before we decide anything either way?"

const EVIDENCE = "tell me a bit more about"

/** A marker only ever present in model-authored fields. */
const MODEL_MARKER = "MODEL-AUTHORED-PROSE-8f2a"

let counter = 0

interface Scenario {
  leadId: string
  leadEmail: string
  messageRowId: string
  mailboxId: string
  composeTaskId: string
  task: TaskLike
}

function seedScenario(
  overrides: { body?: string; leadStatus?: string } = {}
): Scenario {
  counter++
  const leadId = randomUUID()
  const leadEmail = `owner@lead${counter}.example`
  const messageRowId = randomUUID()
  const mailboxId = randomUUID()
  const db = getDb()

  db.prepare(
    `INSERT INTO mailboxes (id, email, app_password, daily_cap, status, created_at)
     VALUES (?, ?, 'app pw', 25, 'active', ?)`
  ).run(mailboxId, `sales${counter}@vendingco.example`, NOW)

  db.prepare(
    `INSERT INTO leads (id, name, email, timezone, status, score, created_at)
     VALUES (?, ?, ?, 'America/New_York', ?, 0, ?)`
  ).run(
    leadId,
    `Lead ${counter}`,
    leadEmail,
    overrides.leadStatus ?? "replied",
    NOW
  )

  db.prepare(
    `INSERT INTO messages
       (id, lead_id, mailbox_id, direction, sequence_step, subject, body,
        outreach_id, message_id, status, created_at)
     VALUES (?, ?, ?, 'in', NULL, ?, ?, ?, ?, 'triaged:classify', ?)`
  ).run(
    messageRowId,
    leadId,
    mailboxId,
    "Re: vending machine",
    overrides.body ?? REPLY_BODY,
    `in:${counter}:${randomUUID()}`,
    `<inbound-${counter}@lead.example>`,
    NOW
  )

  // A pending follow-up, so cancellation and deferral are observable.
  const composeTaskId = enqueue("compose", {
    leadId,
    runAfter: NOW + 4 * 24 * 60 * 60 * 1000,
    payload: { step: 4 },
  })

  return {
    leadId,
    leadEmail,
    messageRowId,
    mailboxId,
    composeTaskId,
    task: {
      id: randomUUID(),
      lead_id: leadId,
      kind: "classify",
      run_after: NOW,
      attempts: 1,
      payload_json: JSON.stringify({ messageRowId, mailboxId }),
    },
  }
}

function classificationFor(intent: string): ReplyClassification {
  return {
    intent: intent as ReplyClassification["intent"],
    ready_to_talk: false,
    evidence_span: EVIDENCE,
    // Model-authored prose. Nothing from these two fields may ever reach the
    // recipient.
    reason: `${MODEL_MARKER} the sender says ${intent}`,
  }
}

interface Recorder {
  sends: SendMessageInput[]
  deps: ClassifyDeps
}

/**
 * Deps with a fake model and a fake transport. `suppressAddress`,
 * `updateLead`, `cancelPendingTasksForLead` and the message/task queries are
 * all REAL — the point of most of these tests is the database state they
 * leave behind.
 */
function recorder(
  intent: string,
  overrides: Partial<ClassifyDeps> = {},
  classificationOverrides: Partial<ReplyClassification> = {}
): Recorder {
  const sends: SendMessageInput[] = []
  return {
    sends,
    deps: {
      now: () => NOW,
      logEvent: () => undefined,
      hasTriageModel: () => true,
      classifyReply: async () => ({
        object: { ...classificationFor(intent), ...classificationOverrides },
      }),
      loadSenderInfo: () => ({
        sender: {
          name: "Dana Vend",
          company: "Vend Co",
          address: "1 Main St, Columbus, OH 43215",
        },
        missing: [],
      }),
      sendMessage: async (input: SendMessageInput): Promise<SendOutcome> => {
        sends.push(input)
        return {
          status: "sent",
          outreachId: randomUUID(),
          rowId: randomUUID(),
          messageId: "<sent@vendingco.example>",
          dryRun: true,
        }
      },
      ...overrides,
    },
  }
}

function readTask(id: string): TaskRow {
  const row = getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | TaskRow
    | undefined
  assert.ok(row, `task ${id} vanished`)
  return row
}

function messageStatus(rowId: string): string {
  const row = getDb()
    .prepare(`SELECT status FROM messages WHERE id = ?`)
    .get(rowId) as { status: string }
  return row.status
}

// ---------------------------------------------------------------------------
// The switch itself
// ---------------------------------------------------------------------------

test("the action table covers every declared intent and defaults to escalate", () => {
  const expected: Record<string, ClassifyAction> = {
    not_interested: "silence",
    already_have_vending: "silence",
    wrong_person: "escalate",
    out_of_office: "no_reply_defer",
    send_more_info: "fixed_reply",
    ready_to_talk: "escalate",
    other: "escalate",
  }

  // Every intent the schema can produce is accounted for, so none can fall
  // through to the default by accident.
  for (const intent of REPLY_INTENTS) {
    assert.equal(actionForIntent(intent), expected[intent], intent)
  }

  // And anything the schema cannot produce escalates rather than acting. This
  // is what makes the switch safe for intents that do not exist yet.
  for (const junk of [
    "",
    "SILENCE",
    "not_interested ",
    "send_more_info; DROP TABLE",
    "ready_to_talk_now",
    "__proto__",
    "constructor",
  ]) {
    assert.equal(actionForIntent(junk), "escalate", `junk intent: "${junk}"`)
  }
})

test("exactly one action is capable of sending bytes", () => {
  const actions: ClassifyAction[] = [
    "silence",
    "escalate",
    "no_reply_defer",
    "fixed_reply",
  ]
  assert.deepEqual(
    actions.filter(actionSendsBytes),
    ["fixed_reply"],
    "only the fixed-template action may send anything"
  )
})

test("the classification schema has no confidence field to gate on", () => {
  // Spec §3: self-reported confidence is uncalibrated and trivially set by
  // injected text, so it was removed from the schema entirely. If it ever
  // comes back, this test is the reminder that it must not become an
  // authorization boundary.
  const shape = Object.keys(replyClassificationSchema.shape)
  assert.deepEqual(shape.includes("confidence"), false)
  assert.deepEqual(shape.sort(), [
    "evidence_span",
    "intent",
    "ready_to_talk",
    "reason",
  ])
})

// ---------------------------------------------------------------------------
// THE TABLE — one case per intent
// ---------------------------------------------------------------------------

test("not_interested: complete silence, suppressed, sequence stopped", async () => {
  const s = seedScenario()
  const r = recorder("not_interested")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  // The property that matters: nothing was sent. Not a courtesy reply, not a
  // confirmation — no send call happened at all.
  assert.equal(r.sends.length, 0, "a send happened on a silence intent")
  assert.equal(getLeadById(s.leadId)?.status, "suppressed")
  assert.equal(isSuppressed(s.leadEmail), true)
  // Suppression and task cancellation happen in ONE transaction (spec §7), so
  // there is no window in which the day-9 follow-up is still queued.
  assert.equal(readTask(s.composeTaskId).status, "cancelled")
  assert.equal(messageStatus(s.messageRowId), "classified:not_interested")
})

test("already_have_vending: complete silence, suppressed, sequence stopped", async () => {
  const s = seedScenario()
  const r = recorder("already_have_vending")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0, "a send happened on a silence intent")
  assert.equal(getLeadById(s.leadId)?.status, "suppressed")
  assert.equal(isSuppressed(s.leadEmail), true)
  assert.equal(readTask(s.composeTaskId).status, "cancelled")
})

test("wrong_person: escalate, and never ask who to talk to instead", async () => {
  const s = seedScenario()
  const r = recorder("wrong_person")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0)
  assert.equal(getLeadById(s.leadId)?.status, "hot")
  assert.equal(isSuppressed(s.leadEmail), false)
})

test("out_of_office: no reply, follow-up deferred, and it is not a reply", async () => {
  const s = seedScenario({
    body:
      "I am out of the office until 2026-11-20 with limited access to email. " +
      "Please tell me a bit more about it when I return.",
  })
  const r = recorder("out_of_office")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0)
  // Spec §3: an out-of-office does not count as a reply. The lead goes back to
  // `contacted`, or an autoresponder would silently end the sequence.
  assert.equal(getLeadById(s.leadId)?.status, "contacted")
  assert.equal(isSuppressed(s.leadEmail), false)

  const compose = readTask(s.composeTaskId)
  assert.equal(compose.status, "pending", "the follow-up must survive")
  assert.ok(
    compose.run_after > NOW + 4 * 24 * 60 * 60 * 1000,
    "the follow-up should have been pushed out to the return date"
  )
  assert.ok(
    compose.run_after <= NOW + MAX_OOO_DEFER_MS,
    "an out-of-office may never defer further than 30 days"
  )
  // Stamped so `hasEverReplied` does not count it as engagement.
  assert.equal(messageStatus(s.messageRowId), "classified:out_of_office")
})

test("send_more_info: sends the FIXED template, and none of the model's words", async () => {
  const s = seedScenario()
  const r = recorder("send_more_info")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 1, "exactly one reply")

  const sent = r.sends[0]

  // THE SAFETY PROPERTY: the bytes came from the human-written template, and
  // nothing the model authored appears in them.
  assert.equal(
    sent.text.includes(MODEL_MARKER),
    false,
    "model-authored prose reached the outgoing message"
  )
  assert.equal(sent.text.includes(EVIDENCE), false)
  // A distinctive, non-spintax fragment of the fixed template.
  assert.ok(FIXED_REPLY_TEMPLATES.send_more_info.includes("no cost to you"))
  assert.ok(
    sent.text.includes("no cost to you"),
    "the fixed template text is missing from the reply"
  )
  assert.ok(sent.text.includes("Dana Vend"), "sender name not substituted")
  assert.ok(
    sent.text.includes("1 Main St, Columbus, OH 43215"),
    "the CAN-SPAM postal address is missing"
  )

  // Amendment A9: `isAutoReply` is what makes `buildMime` emit
  // `Auto-Submitted: auto-replied` alongside `X-Loop`, which is what stops the
  // two-robot loop.
  assert.equal(sent.isAutoReply, true)
  // Off-sequence, so UNIQUE(lead_id, sequence_step) does not cover it and a
  // dedupe key is mandatory.
  assert.equal(sent.sequenceStep, null)
  assert.ok(sent.dedupeKey?.includes(s.messageRowId))
  // They really did reply, so `Re:` is honest here — unlike anywhere in the
  // outbound sequence.
  assert.equal(sent.recipientReplied, true)
  assert.equal(sent.to, s.leadEmail)
  assert.equal(sent.mailboxId, s.mailboxId)

  assert.equal(isSuppressed(s.leadEmail), false)
})

test("an intent the schema cannot produce escalates and sends nothing", async () => {
  const s = seedScenario()
  const r = recorder("something_the_model_invented")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0)
  assert.equal(getLeadById(s.leadId)?.status, "hot")
})

test("every intent either sends the fixed template or sends nothing", async () => {
  // The whole table in one sweep, asserted as a property rather than per case:
  // for any label the model can return, the outgoing byte count is either zero
  // or one message whose text is the fixed template.
  for (const intent of [...REPLY_INTENTS, "garbage", ""]) {
    const s = seedScenario()
    const r = recorder(intent)
    await handleClassify(s.task, r.deps)

    if (intent === "send_more_info") {
      assert.equal(r.sends.length, 1, intent)
      assert.equal(r.sends[0].text.includes(MODEL_MARKER), false, intent)
      assert.ok(r.sends[0].text.includes("no cost to you"), intent)
    } else {
      assert.equal(r.sends.length, 0, `intent "${intent}" sent something`)
    }
  }
})

// ---------------------------------------------------------------------------
// Grounding, narrowing, and the one-auto-reply rule
// ---------------------------------------------------------------------------

test("an ungrounded evidence_span escalates and never replies", async () => {
  const s = seedScenario()
  // The model asks for the fixed reply but quotes something that is not in the
  // source — the signature of a hallucination or an injection.
  const r = recorder("send_more_info", {}, {
    evidence_span: "please send me your pricing sheet immediately",
  })

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0, "replied on an ungrounded classification")
  assert.equal(getLeadById(s.leadId)?.status, "hot")
  assert.equal(messageStatus(s.messageRowId), "classified:ungrounded")
})

test("a truncated reply escalates — the classifier saw less than arrived", async () => {
  const s = seedScenario({ body: `${"padding words ".repeat(400)} remove me` })
  const r = recorder("send_more_info")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0)
  assert.equal(getLeadById(s.leadId)?.status, "hot")
  assert.equal(messageStatus(s.messageRowId), "classified:truncated")
})

test("ready_to_talk narrows a fixed reply into an escalation", async () => {
  const s = seedScenario()
  const r = recorder("send_more_info", {}, { ready_to_talk: true })

  await handleClassify(s.task, r.deps)

  // A person asking to move forward is closed by a human, not a template.
  // This narrowing can only ever remove an automatic send.
  assert.equal(r.sends.length, 0)
  assert.equal(getLeadById(s.leadId)?.status, "hot")
})

test("only one auto-reply per thread, ever — the second escalates", async () => {
  const s = seedScenario()

  // An off-sequence outbound row: the shape an auto-reply leaves behind.
  getDb()
    .prepare(
      `INSERT INTO messages
         (id, lead_id, mailbox_id, direction, sequence_step, subject, body,
          outreach_id, status, sent_at, created_at)
       VALUES (?, ?, ?, 'out', NULL, 'Re: vending', 'earlier fixed reply', ?, 'sent', ?, ?)`
    )
    .run(randomUUID(), s.leadId, s.mailboxId, randomUUID(), NOW, NOW)

  const r = recorder("send_more_info")
  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0, "a second automatic reply is a loop risk")
  assert.equal(getLeadById(s.leadId)?.status, "hot")
})

test("a blocked fixed reply defers instead of dropping the reply", async () => {
  const s = seedScenario()
  const retryAt = NOW + 3 * 60 * 60 * 1000
  const r = recorder("send_more_info", {
    sendMessage: async (): Promise<SendOutcome> => ({
      status: "blocked",
      code: "outside_window",
      reason: "outside the 9:00-16:00 window",
      retryAt,
    }),
  })

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "deferred")
  if (outcome.status === "deferred") {
    assert.equal(outcome.runAfter, retryAt)
  }
  // The label is recorded, so resuming does not pay for a second model call.
  assert.equal(messageStatus(s.messageRowId), "classified:send_more_info")
})

test("a resumed send_more_info task does not call the model again", async () => {
  const s = seedScenario()
  getDb()
    .prepare(`UPDATE messages SET status = 'classified:send_more_info' WHERE id = ?`)
    .run(s.messageRowId)

  let modelCalls = 0
  const r = recorder("send_more_info", {
    classifyReply: async () => {
      modelCalls++
      return { object: classificationFor("send_more_info") }
    },
  })

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(modelCalls, 0, "the recorded label should have been reused")
  assert.equal(r.sends.length, 1)
})

test("a lead already suppressed is left alone", async () => {
  const s = seedScenario({ leadStatus: "suppressed" })
  const r = recorder("send_more_info")

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0)
})

test("a payload without messageRowId is dead-lettered, not retried", async () => {
  const s = seedScenario()
  const r = recorder("other")
  const outcome = await handleClassify(
    { ...s.task, payload_json: JSON.stringify({ mailboxId: s.mailboxId }) },
    r.deps
  )
  assert.equal(outcome.status, "dead_letter")
  assert.equal(r.sends.length, 0)
})

test("a missing sender address escalates rather than sending a defective email", async () => {
  const s = seedScenario()
  const r = recorder("send_more_info", {
    loadSenderInfo: () => ({
      missing: ["About you -> Business address (required by CAN-SPAM)"],
    }),
  })

  const outcome = await handleClassify(s.task, r.deps)

  assert.equal(outcome.status, "done")
  assert.equal(r.sends.length, 0)
  assert.equal(getLeadById(s.leadId)?.status, "hot")
})

// ---------------------------------------------------------------------------
// Out-of-office return dates
// ---------------------------------------------------------------------------

test("return dates are parsed from the common out-of-office shapes", () => {
  const base = Date.UTC(2026, 8, 9) // 2026-09-09

  const cases: Array<{ text: string; expected: number | null }> = [
    { text: "I'll be back on 2026-09-15.", expected: Date.UTC(2026, 8, 15) },
    { text: "Out until September 15", expected: Date.UTC(2026, 8, 15) },
    { text: "Away until Sept 15, 2026", expected: Date.UTC(2026, 8, 15) },
    { text: "Returning 15 September 2026", expected: Date.UTC(2026, 8, 15) },
    { text: "Back 9/15", expected: Date.UTC(2026, 8, 15) },
    { text: "Back 9/15/2026", expected: Date.UTC(2026, 8, 15) },
    // No year, and the date has already passed this year -> next year.
    { text: "Back on January 5", expected: Date.UTC(2027, 0, 5) },
    // Deliberately not parsed: resolving it needs their timezone and week
    // convention, and a wrong date is worse than a flat week.
    { text: "I'm back next Monday", expected: null },
    { text: "no date here at all", expected: null },
  ]

  for (const c of cases) {
    assert.equal(parseReturnDate(c.text, base), c.expected, c.text)
  }
})

test("an out-of-office defer is floored at a day and capped at 30 days", () => {
  const base = Date.UTC(2026, 8, 9)

  // Far future -> capped.
  assert.equal(
    resolveOooDeferUntil("back on 2027-06-01", base),
    base + MAX_OOO_DEFER_MS
  )
  // Today or in the past -> floored at +1 day, never immediate.
  assert.ok(resolveOooDeferUntil("back on 2026-09-09", base) >= base + 86_400_000)
  assert.ok(resolveOooDeferUntil("back on 2020-01-01", base) >= base + 86_400_000)
  // Unparseable -> the flat fallback, still inside the cap.
  const fallback = resolveOooDeferUntil("back soon", base)
  assert.ok(fallback > base && fallback <= base + MAX_OOO_DEFER_MS)
})
