/**
 * Tests for the enrich, compose and send handlers.
 *
 * INVARIANT FOR THIS FILE: no network, no SMTP, no IMAP, no model. `enrichLead`
 * and `generateGuarded` are injected stubs, and `sendMessage` is a recorder —
 * so `lib/leads.ts` not existing yet does not stop any of this from running.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-handlers-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")
process.env.VENDING_STOP_FILE = path.join(TMP_ROOT, "STOP-does-not-exist")
delete process.env.SEND_ENABLED

import {
  enqueue,
  getDb,
  getLeadById,
  type EnqueueOptions,
  type LeadRow,
  type LeadStatus,
  type MailboxRow,
  type TaskRow,
} from "../../lib/db.ts"
import {
  suppressAddress,
  type SendGate,
  type SendMessageInput,
  type SendOutcome,
} from "../../lib/mail-send.ts"
import { tick } from "../engine.ts"
import { AmbiguousSendError, DAY_MS, type TaskLike } from "./common.ts"
import { handleEnrich, type EnrichOutcome } from "./enrich.ts"
import {
  buildSubject,
  handleCompose,
  validateDraft,
  type ComposeDeps,
} from "./compose.ts"
import { HELD_RECHECK_MS, NEXT_STEP, handleSend, type SendHandlerDeps } from "./send.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-handlers-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = Date.now()
const BUSINESS = "Northside Auto Repair"

/** A body that satisfies every rule in `validateDraft` for step 1. */
const GOOD_BODY_STEP_1 =
  `Hi there - I noticed ${BUSINESS} has been open since 1994, which is a long ` +
  "run for a shop on that stretch. I place vending machines in local " +
  "businesses at no cost to the owner: we own the machine, stock it, and " +
  "service it, and you get a share of what it sells. Nothing for you to " +
  "manage and no fees. If it is not a fit, just reply and I will leave you " +
  "alone.\n\nDana Vend\nVend Co\n1 Main St, Columbus, OH 43215"

const GOOD_BODY_FOLLOWUP =
  `Following up on my earlier note about ${BUSINESS} - no worries if now is ` +
  "not the time, just reply and I will leave you alone.\n\nDana Vend\n" +
  "1 Main St, Columbus, OH 43215"

const SENDER = {
  sender: {
    name: "Dana Vend",
    company: "Vend Co",
    address: "1 Main St, Columbus, OH 43215",
  },
  missing: [] as string[],
}

let counter = 0

interface Seeded {
  leadId: string
  email: string
  mailbox: MailboxRow
}

function seedLead(
  overrides: { status?: LeadStatus; name?: string | null; email?: string | null } = {}
): Seeded {
  counter++
  const leadId = randomUUID()
  const email = overrides.email === null ? null : (overrides.email ?? `owner@lead${counter}.example`)
  const mailboxId = randomUUID()
  const db = getDb()

  db.prepare(
    `INSERT INTO mailboxes (id, email, app_password, daily_cap, status, created_at)
     VALUES (?, ?, 'app pw', 25, 'active', ?)`
  ).run(mailboxId, `sales${counter}@vendingco.example`, NOW)

  db.prepare(
    `INSERT INTO leads (id, name, email, timezone, status, score,
                        personalization_fact, fact_category, created_at)
     VALUES (?, ?, ?, 'America/New_York', ?, 0, ?, 'years in business', ?)`
  ).run(
    leadId,
    overrides.name === null ? null : (overrides.name ?? BUSINESS),
    email,
    overrides.status ?? "ready",
    "open since 1994",
    NOW
  )

  const mailbox = db
    .prepare(`SELECT * FROM mailboxes WHERE id = ?`)
    .get(mailboxId) as unknown as MailboxRow

  return { leadId, email: email ?? "", mailbox }
}

function taskFor(
  leadId: string,
  kind: string,
  payload: unknown,
  runAfter = NOW
): TaskLike {
  return {
    id: randomUUID(),
    lead_id: leadId,
    kind,
    run_after: runAfter,
    attempts: 1,
    payload_json: JSON.stringify(payload),
  }
}

function readTask(id: string): TaskRow {
  const row = getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | TaskRow
    | undefined
  assert.ok(row, `task ${id} vanished`)
  return row
}

interface Enqueued {
  kind: string
  options: EnqueueOptions
}

function enqueueRecorder(): { calls: Enqueued[]; fn: typeof enqueue } {
  const calls: Enqueued[] = []
  return {
    calls,
    fn: ((kind: string, options: EnqueueOptions = {}) => {
      calls.push({ kind, options })
      return randomUUID()
    }) as typeof enqueue,
  }
}

const OPEN_GATE: SendGate = {
  ok: true,
  reason: "test gate",
  dailyCapInEffect: 25,
  sentToday: 0,
}

function sendDepsFor(
  seeded: Seeded,
  overrides: Partial<SendHandlerDeps> = {}
): { sends: SendMessageInput[]; enqueued: Enqueued[]; deps: SendHandlerDeps } {
  const sends: SendMessageInput[] = []
  const rec = enqueueRecorder()
  return {
    sends,
    enqueued: rec.calls,
    deps: {
      now: () => NOW,
      logEvent: () => undefined,
      listMailboxes: () => [seeded.mailbox],
      getMailboxPause: () => null,
      canSendNow: () => OPEN_GATE,
      checkCircuitBreakers: () => ({ tripped: false, state: null, findings: [] }),
      loadSenderInfo: () => SENDER,
      enqueue: rec.fn,
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

function composeDepsFor(
  overrides: Partial<ComposeDeps> = {},
  body = GOOD_BODY_STEP_1
): { enqueued: Enqueued[]; prompts: string[]; deps: ComposeDeps } {
  const rec = enqueueRecorder()
  const prompts: string[] = []
  return {
    enqueued: rec.calls,
    prompts,
    deps: {
      now: () => NOW,
      logEvent: () => undefined,
      loadSenderInfo: () => SENDER,
      hasWriterModel: () => true,
      enqueue: rec.fn,
      // Deterministic: spintax would otherwise vary the subject per run.
      expandSpintax: (text: string) => text.replace(/\{([^{}]*)\}/g, (_m, g: string) => g.split("|")[0]),
      generateText: async (params) => {
        prompts.push(params.prompt)
        return { text: body }
      },
      ...overrides,
    },
  }
}

// ---------------------------------------------------------------------------
// enrich
// ---------------------------------------------------------------------------

test("enrich: a ready lead enqueues compose step 1", async () => {
  const s = seedLead()
  const rec = enqueueRecorder()
  const outcome = await handleEnrich(taskFor(s.leadId, "enrich", null), {
    now: () => NOW,
    logEvent: () => undefined,
    enqueue: rec.fn,
    enrichLead: async (): Promise<EnrichOutcome> => ({
      status: "ready",
      email: s.email,
      fact: "open since 1994",
      factCategory: "years_in_business",
      score: 72,
    }),
  })

  assert.equal(outcome.status, "done")
  assert.equal(rec.calls.length, 1)
  assert.equal(rec.calls[0].kind, "compose")
  assert.deepEqual(rec.calls[0].options.payload, { step: 1 })
  assert.equal(rec.calls[0].options.leadId, s.leadId)
  assert.equal(rec.calls[0].options.runAfter, NOW)
})

test("enrich: a held lead ALSO composes — it is the send that waits", async () => {
  const s = seedLead({ status: "held" })
  const rec = enqueueRecorder()
  const outcome = await handleEnrich(taskFor(s.leadId, "enrich", null), {
    now: () => NOW,
    logEvent: () => undefined,
    enqueue: rec.fn,
    enrichLead: async (): Promise<EnrichOutcome> => ({
      status: "held",
      email: s.email,
      fact: "open since 1994",
      factCategory: "years_in_business",
      score: 64,
    }),
  })

  assert.equal(outcome.status, "done")
  assert.equal(rec.calls.length, 1, "a held lead must still be composed")
  assert.deepEqual(rec.calls[0].options.payload, { step: 1 })
})

test("enrich: an unqualified lead schedules nothing", async () => {
  const s = seedLead()
  const rec = enqueueRecorder()
  const outcome = await handleEnrich(taskFor(s.leadId, "enrich", null), {
    now: () => NOW,
    logEvent: () => undefined,
    enqueue: rec.fn,
    enrichLead: async (): Promise<EnrichOutcome> => ({
      status: "unqualified",
      reason: "no website to scrape an address from",
    }),
  })

  assert.equal(outcome.status, "done")
  assert.equal(rec.calls.length, 0)
})

test("enrich: a suppressed lead is not enriched at all", async () => {
  const s = seedLead({ status: "suppressed" })
  let calls = 0
  const outcome = await handleEnrich(taskFor(s.leadId, "enrich", null), {
    now: () => NOW,
    logEvent: () => undefined,
    enrichLead: async () => {
      calls++
      throw new Error("must not fetch a suppressed lead's website")
    },
  })

  assert.equal(outcome.status, "done")
  assert.equal(calls, 0)
})

test("enrich: a transient failure propagates so the engine can retry it", async () => {
  const s = seedLead()
  await assert.rejects(
    handleEnrich(taskFor(s.leadId, "enrich", null), {
      now: () => NOW,
      logEvent: () => undefined,
      enrichLead: async () => {
        throw new Error("overpass 504")
      },
    }),
    /overpass 504/
  )
})

// ---------------------------------------------------------------------------
// compose — validation
// ---------------------------------------------------------------------------

test("validateDraft rejects everything the prompt already forbade", () => {
  const ok = validateDraft({
    step: 1,
    subject: `Quick question about ${BUSINESS}`,
    body: GOOD_BODY_STEP_1,
    businessName: BUSINESS,
  })
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.ok, true)

  const cases: Array<{ label: string; draft: Parameters<typeof validateDraft>[0]; match: RegExp }> = [
    {
      label: "a URL in the body",
      draft: {
        step: 1,
        subject: `Quick question about ${BUSINESS}`,
        body: `${GOOD_BODY_STEP_1}\nSee vendco.com for details.`,
        businessName: BUSINESS,
      },
      match: /URL or email/,
    },
    {
      label: "the business name missing",
      draft: {
        step: 1,
        subject: "Quick question",
        body: GOOD_BODY_STEP_1.replaceAll(BUSINESS, "your business"),
        businessName: BUSINESS,
      },
      match: /never mentions the business name/,
    },
    {
      label: "an unfilled placeholder",
      draft: {
        step: 1,
        subject: `Quick question about ${BUSINESS}`,
        body: `Hi {{owner_name}}, ${GOOD_BODY_STEP_1}`,
        businessName: BUSINESS,
      },
      match: /unresolved \{\{ \}\}/,
    },
    {
      label: "a Re: prefix on step 1",
      draft: {
        step: 1,
        subject: `Re: ${BUSINESS}`,
        body: GOOD_BODY_STEP_1,
        businessName: BUSINESS,
      },
      match: /deceptive subject line/,
    },
    {
      label: "a body that is far too short",
      draft: {
        step: 1,
        subject: `Quick question about ${BUSINESS}`,
        body: `Hi ${BUSINESS}, call me.`,
        businessName: BUSINESS,
      },
      match: /under the 150 minimum/,
    },
    {
      label: "a follow-up that turned into a wall of text",
      draft: {
        step: 4,
        subject: `Quick question about ${BUSINESS}`,
        body: `${BUSINESS} ${"padding ".repeat(400)}`,
        businessName: BUSINESS,
      },
      match: /over the 1200 maximum/,
    },
  ]

  for (const c of cases) {
    const result = validateDraft(c.draft)
    assert.equal(result.ok, false, c.label)
    assert.ok(
      result.problems.some((p) => c.match.test(p)),
      `${c.label}: got ${JSON.stringify(result.problems)}`
    )
  }
})

test("the step-1 subject carries the business name and never a Re:", () => {
  const subject = buildSubject(1, BUSINESS, null, (t) =>
    t.replace(/\{([^{}]*)\}/g, (_m, g: string) => g.split("|")[0])
  )
  assert.ok(subject.includes(BUSINESS))
  assert.equal(/^re:/i.test(subject), false)
})

test("follow-ups inherit the original subject so the thread holds together", () => {
  const subject = buildSubject(4, BUSINESS, "Quick question about Northside Auto Repair")
  assert.equal(subject, "Quick question about Northside Auto Repair")
})

// ---------------------------------------------------------------------------
// compose — abandonment
// ---------------------------------------------------------------------------

test("compose: abandons on a suppressed lead without calling a model", async () => {
  const s = seedLead()
  let modelCalls = 0
  const c = composeDepsFor({
    isSuppressed: () => true,
    generateText: async () => {
      modelCalls++
      return { text: GOOD_BODY_STEP_1 }
    },
  })

  const outcome = await handleCompose(taskFor(s.leadId, "compose", { step: 1 }), c.deps)

  assert.equal(outcome.status, "done")
  assert.match(outcome.status === "done" ? (outcome.reason ?? "") : "", /suppression list/)
  assert.equal(modelCalls, 0)
  assert.equal(c.enqueued.length, 0)
})

test("compose: abandons on a terminal lead status", async () => {
  for (const status of ["suppressed", "dead", "won", "unqualified"] as LeadStatus[]) {
    const s = seedLead({ status })
    const c = composeDepsFor({ isSuppressed: () => false })
    const outcome = await handleCompose(
      taskFor(s.leadId, "compose", { step: 1 }),
      c.deps
    )
    assert.equal(outcome.status, "done", status)
    assert.equal(c.enqueued.length, 0, status)
  }
})

test("compose: steps 4 and 9 abandon once the lead has ever replied", async () => {
  for (const step of [4, 9]) {
    const s = seedLead({ status: "contacted" })
    let modelCalls = 0
    const c = composeDepsFor({
      isSuppressed: () => false,
      hasEverReplied: () => true,
      generateText: async () => {
        modelCalls++
        return { text: GOOD_BODY_FOLLOWUP }
      },
    })

    const outcome = await handleCompose(
      taskFor(s.leadId, "compose", { step }),
      c.deps
    )

    assert.equal(outcome.status, "done", `step ${step}`)
    assert.match(
      outcome.status === "done" ? (outcome.reason ?? "") : "",
      /has replied/,
      `step ${step}`
    )
    assert.equal(modelCalls, 0, `step ${step}: paid for a model call anyway`)
    assert.equal(c.enqueued.length, 0, `step ${step}: queued a send anyway`)
  }
})

test("compose: step 1 is NOT cancelled by the replied check", async () => {
  // A reply cancels the follow-ups. Step 1 has, by definition, not been sent
  // yet, so there is nothing for a reply to have been a reply to.
  const s = seedLead()
  const c = composeDepsFor({ isSuppressed: () => false, hasEverReplied: () => true })

  const outcome = await handleCompose(taskFor(s.leadId, "compose", { step: 1 }), c.deps)

  assert.equal(outcome.status, "done")
  assert.equal(c.enqueued.length, 1)
})

// ---------------------------------------------------------------------------
// compose — the happy path and the escalation path
// ---------------------------------------------------------------------------

test("compose: a valid draft rides in the send task's payload", async () => {
  const s = seedLead()
  const c = composeDepsFor({ isSuppressed: () => false, hasEverReplied: () => false })

  const outcome = await handleCompose(taskFor(s.leadId, "compose", { step: 1 }), c.deps)

  assert.equal(outcome.status, "done")
  assert.equal(c.enqueued.length, 1)
  const queued = c.enqueued[0]
  assert.equal(queued.kind, "send")
  assert.equal(queued.options.runAfter, NOW, "step 1 sends as soon as pacing allows")

  const payload = queued.options.payload as {
    step: number
    subject: string
    body: string
  }
  assert.equal(payload.step, 1)
  assert.equal(payload.body, GOOD_BODY_STEP_1)
  assert.ok(payload.subject.includes(BUSINESS))

  // The grounded fact reaches the model inside a nonce fence, because a
  // scraped page is untrusted no matter what has been validated about it.
  assert.match(c.prompts[0], /<untrusted_data id="[0-9a-f]{32}"/)
  assert.match(c.prompts[0], /open since 1994/)
})

test("compose: an invalid draft is regenerated exactly once", async () => {
  const s = seedLead()
  let attempt = 0
  const c = composeDepsFor({
    isSuppressed: () => false,
    hasEverReplied: () => false,
    generateText: async (params) => {
      attempt++
      c.prompts.push(params.prompt)
      // First attempt smuggles in a URL; second is clean.
      return {
        text: attempt === 1 ? `${GOOD_BODY_STEP_1}\nvendco.com` : GOOD_BODY_STEP_1,
      }
    },
  })

  const outcome = await handleCompose(taskFor(s.leadId, "compose", { step: 1 }), c.deps)

  assert.equal(outcome.status, "done")
  assert.equal(attempt, 2, "should have regenerated exactly once")
  assert.equal(c.enqueued.length, 1)
  // The retry tells the model what was wrong rather than hoping for a different
  // sample.
  assert.match(c.prompts[1], /rejected for these reasons/)
})

test("compose: two failed validations escalate the lead instead of sending", async () => {
  const s = seedLead()
  const patched: Array<{ id: string; status: unknown }> = []
  const c = composeDepsFor(
    {
      isSuppressed: () => false,
      hasEverReplied: () => false,
      updateLead: ((id: string, patch: { status?: unknown }) => {
        patched.push({ id, status: patch.status })
        return {} as LeadRow
      }) as ComposeDeps["updateLead"],
    },
    // Always carries a URL.
    `${GOOD_BODY_STEP_1}\nvendco.com`
  )

  const outcome = await handleCompose(taskFor(s.leadId, "compose", { step: 1 }), c.deps)

  assert.equal(outcome.status, "done")
  assert.equal(c.enqueued.length, 0, "nothing unvalidated may be queued to send")
  assert.deepEqual(patched, [{ id: s.leadId, status: "hot" }])
})

test("compose: missing sender details dead-letter with the Settings field named", async () => {
  const s = seedLead()
  const c = composeDepsFor({
    isSuppressed: () => false,
    loadSenderInfo: () => ({
      missing: ["About you -> Business address (required by CAN-SPAM)"],
    }),
  })

  const outcome = await handleCompose(taskFor(s.leadId, "compose", { step: 1 }), c.deps)

  assert.equal(outcome.status, "dead_letter")
  if (outcome.status === "dead_letter") {
    assert.match(outcome.reason, /Settings ->/)
    assert.match(outcome.reason, /Business address/)
  }
  assert.equal(c.enqueued.length, 0)
})

test("compose: a malformed payload dead-letters rather than retrying forever", async () => {
  const s = seedLead()
  const c = composeDepsFor()
  for (const payload of [null, { step: 2 }, { step: "1" }, {}]) {
    const outcome = await handleCompose(
      taskFor(s.leadId, "compose", payload),
      c.deps
    )
    assert.equal(outcome.status, "dead_letter", JSON.stringify(payload))
  }
})

// ---------------------------------------------------------------------------
// send — the held lead (approval queue)
// ---------------------------------------------------------------------------

test("send: a held lead is not sent and its task stays pending as an approval item", async () => {
  const s = seedLead({ status: "held" })
  const d = sendDepsFor(s, { isSuppressed: () => false })

  const outcome = await handleSend(
    taskFor(s.leadId, "send", {
      step: 1,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_STEP_1,
    }),
    d.deps
  )

  assert.equal(d.sends.length, 0, "a held lead must never be sent")
  assert.equal(outcome.status, "deferred")
  if (outcome.status === "deferred") {
    assert.equal(outcome.runAfter, NOW + HELD_RECHECK_MS)
    assert.match(outcome.reason, /held for approval/)
  }
})

test("send: through the engine, a held lead's task survives as pending with no attempt spent", async () => {
  const s = seedLead({ status: "held" })
  const d = sendDepsFor(s, { isSuppressed: () => false })
  const taskId = enqueue("send", {
    leadId: s.leadId,
    runAfter: 0,
    payload: {
      step: 1,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_STEP_1,
    },
  })

  const result = await tick({
    now: () => NOW,
    log: () => undefined,
    logEvent: () => undefined,
    isStopFilePresent: () => false,
    getCircuitBreakerState: () => null,
    renewLock: () => true,
    // The engine's catch-up check would otherwise fire on `runAfter: 0`.
    catchUpGraceMs: Number.MAX_SAFE_INTEGER,
    handlers: { send: (task) => handleSend(task, d.deps) },
  })

  assert.equal(result.deferred, 1)
  assert.equal(d.sends.length, 0)

  const task = readTask(taskId)
  assert.equal(task.status, "pending", "the draft the UI reviews must not vanish")
  assert.equal(task.attempts, 0, "an approval wait must not burn a send attempt")
  assert.equal(
    JSON.parse(task.payload_json ?? "{}").body,
    GOOD_BODY_STEP_1,
    "the draft body must survive the deferral intact"
  )
})

// ---------------------------------------------------------------------------
// send — TOCTOU
// ---------------------------------------------------------------------------

test("send: suppression arriving between compose and send cancels the send", async () => {
  const s = seedLead({ status: "contacted" })
  // The realistic sequence: the compose handler queued this send, and then a
  // "not interested" arrived. `suppressAddress` writes the suppression and
  // cancels the lead's pending tasks in ONE transaction (spec §7).
  suppressAddress(s.email, "reply classified not_interested", { leadId: s.leadId })

  const d = sendDepsFor(s)
  const outcome = await handleSend(
    taskFor(s.leadId, "send", {
      step: 4,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_FOLLOWUP,
    }),
    d.deps
  )

  assert.equal(d.sends.length, 0, "sent to a suppressed address")
  assert.equal(outcome.status, "done")
  assert.equal(getLeadById(s.leadId)?.status, "suppressed")
})

test("send: a suppression-list hit stops the send even while the lead looks contacted", async () => {
  // The narrower TOCTOU window: the address is suppressed (an imported CSV, a
  // sibling address at the same domain) while the lead row still says
  // `contacted`. The list is checked here, not just the lead's status.
  const s = seedLead({ status: "contacted" })
  getDb()
    .prepare(
      `INSERT INTO suppressed (email, reason, created_at) VALUES (?, 'imported', ?)`
    )
    .run(s.email.toLowerCase(), NOW)

  const d = sendDepsFor(s)
  const outcome = await handleSend(
    taskFor(s.leadId, "send", {
      step: 1,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_STEP_1,
    }),
    d.deps
  )

  assert.equal(d.sends.length, 0)
  assert.equal(outcome.status, "done")
  assert.match(outcome.status === "done" ? (outcome.reason ?? "") : "", /suppression list/)
})

test("send: a reply arriving before a follow-up cancels it", async () => {
  const s = seedLead({ status: "replied" })
  const d = sendDepsFor(s, { isSuppressed: () => false, hasEverReplied: () => true })

  const outcome = await handleSend(
    taskFor(s.leadId, "send", {
      step: 9,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_FOLLOWUP,
    }),
    d.deps
  )

  assert.equal(d.sends.length, 0)
  assert.equal(outcome.status, "done")
})

// ---------------------------------------------------------------------------
// send — the sequence
// ---------------------------------------------------------------------------

test("send: a sent step 1 marks the lead contacted and schedules step 4 at +4 days", async () => {
  const s = seedLead({ status: "ready" })
  const d = sendDepsFor(s, { isSuppressed: () => false, hasEverReplied: () => false })

  const outcome = await handleSend(
    taskFor(s.leadId, "send", {
      step: 1,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_STEP_1,
    }),
    d.deps
  )

  assert.equal(outcome.status, "done")
  assert.equal(d.sends.length, 1)
  assert.equal(d.sends[0].sequenceStep, 1)
  // CAN-SPAM: never a `Re:` on a message they have not answered.
  assert.equal(d.sends[0].recipientReplied, false)
  assert.equal(d.sends[0].taskRunAfter, NOW, "the send gate needs the task's run_after")
  assert.equal(getLeadById(s.leadId)?.status, "contacted")

  assert.equal(d.enqueued.length, 1)
  assert.equal(d.enqueued[0].kind, "compose")
  assert.deepEqual(d.enqueued[0].options.payload, { step: 4 })
  assert.equal(d.enqueued[0].options.runAfter, NOW + 4 * DAY_MS)
})

test("send: step 9 ends the sequence", async () => {
  assert.equal(NEXT_STEP[9], null)
  const s = seedLead({ status: "contacted" })
  const d = sendDepsFor(s, { isSuppressed: () => false, hasEverReplied: () => false })

  await handleSend(
    taskFor(s.leadId, "send", {
      step: 9,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_FOLLOWUP,
    }),
    d.deps
  )

  assert.equal(d.sends.length, 1)
  assert.equal(d.enqueued.length, 0, "nothing follows step 9")
})

test("send: a sent step does not stamp `contacted` over a reply that just landed", async () => {
  const s = seedLead({ status: "ready" })
  let reads = 0
  const d = sendDepsFor(s, {
    isSuppressed: () => false,
    hasEverReplied: () => false,
    getLeadById: (id: string) => {
      reads++
      const lead = getLeadById(id)
      if (!lead) return undefined
      // The second read is the post-send one: by then they have replied.
      return reads === 1 ? lead : { ...lead, status: "replied" as LeadStatus }
    },
  })

  await handleSend(
    taskFor(s.leadId, "send", {
      step: 1,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_STEP_1,
    }),
    d.deps
  )

  assert.equal(d.sends.length, 1)
  assert.notEqual(getLeadById(s.leadId)?.status, "contacted")
})

// ---------------------------------------------------------------------------
// send — failure mapping
// ---------------------------------------------------------------------------

test("send: an ambiguous failure throws AmbiguousSendError, never a plain retry", async () => {
  const s = seedLead({ status: "ready" })
  const d = sendDepsFor(s, {
    isSuppressed: () => false,
    hasEverReplied: () => false,
    sendMessage: async (): Promise<SendOutcome> => ({
      status: "failed",
      outreachId: "abc-123",
      rowId: randomUUID(),
      unresolved: true,
      classification: {
        kind: "post_data_ambiguous",
        retryable: false,
        action: "reconcile",
        requiresReconciliation: true,
        backoffMs: 300_000,
        detail: "socket timed out after DATA",
      },
    }),
  })

  await assert.rejects(
    handleSend(
      taskFor(s.leadId, "send", {
        step: 1,
        subject: `Quick question about ${BUSINESS}`,
        body: GOOD_BODY_STEP_1,
      }),
      d.deps
    ),
    (err: unknown) => err instanceof AmbiguousSendError
  )
})

test("send: a daily-limit 5xx requeues unchanged instead of burning the lead", async () => {
  const s = seedLead({ status: "ready" })
  const d = sendDepsFor(s, {
    isSuppressed: () => false,
    hasEverReplied: () => false,
    sendMessage: async (): Promise<SendOutcome> => ({
      status: "failed",
      outreachId: "abc-124",
      rowId: randomUUID(),
      unresolved: false,
      classification: {
        kind: "daily_limit",
        retryable: true,
        action: "pause_mailbox_24h",
        requiresReconciliation: false,
        backoffMs: 24 * 60 * 60 * 1000,
        detail: "550 5.4.5 Daily user sending limit exceeded",
      },
    }),
  })

  const outcome = await handleSend(
    taskFor(s.leadId, "send", {
      step: 1,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_STEP_1,
    }),
    d.deps
  )

  // A deferral, not a failure: the message is fine, the mailbox is not. Spec §5
  // is explicit that a naive "5xx = permanent" rule burns live leads forever.
  assert.equal(outcome.status, "deferred")
  assert.equal(d.enqueued.length, 0)
})

test("send: a closed send window defers to the gate's own retryAt", async () => {
  const s = seedLead({ status: "ready" })
  const retryAt = NOW + 17 * 60 * 60 * 1000
  const d = sendDepsFor(s, {
    isSuppressed: () => false,
    hasEverReplied: () => false,
    canSendNow: () => ({
      ok: false,
      code: "outside_window",
      reason: "outside the 9:00-16:00 window in America/New_York",
      retryAt,
    }),
  })

  const outcome = await handleSend(
    taskFor(s.leadId, "send", {
      step: 1,
      subject: `Quick question about ${BUSINESS}`,
      body: GOOD_BODY_STEP_1,
    }),
    d.deps
  )

  assert.equal(d.sends.length, 0)
  assert.equal(outcome.status, "deferred")
  if (outcome.status === "deferred") {
    assert.equal(outcome.runAfter, retryAt, "the gate decides when, not the handler")
  }
})

test("send: a malformed payload dead-letters", async () => {
  const s = seedLead({ status: "ready" })
  const d = sendDepsFor(s, { isSuppressed: () => false })
  for (const payload of [
    null,
    { step: 1 },
    { step: 1, subject: "", body: "x" },
    { step: 3, subject: "s", body: "b" },
  ]) {
    const outcome = await handleSend(taskFor(s.leadId, "send", payload), d.deps)
    assert.equal(outcome.status, "dead_letter", JSON.stringify(payload))
    assert.equal(d.sends.length, 0)
  }
})
