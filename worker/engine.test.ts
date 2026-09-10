/**
 * Tests for the tick loop.
 *
 * INVARIANT FOR THIS FILE: no network, no SMTP, no IMAP, no model. Every
 * handler is injected. The queue itself is real — `claimTask`, `failTask` and
 * the `tasks` table are what these tests are actually about, so stubbing them
 * would test the stubs.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// The database path must be redirected BEFORE anything calls getDb().
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-engine-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")
process.env.VENDING_STOP_FILE = path.join(TMP_ROOT, "STOP-does-not-exist")
delete process.env.SEND_ENABLED

import {
  enqueue,
  getDb,
  getLeadById,
  insertLead,
  updateLead,
  type TaskRow,
} from "../lib/db.ts"
import {
  DEFAULT_LEASE_MS,
  RETRY_POLICIES,
  TASK_KINDS,
  backoffFor,
  deferTask,
  formatTickResult,
  isTaskKind,
  resetTickGuardForTests,
  tick,
  type EngineDeps,
  type HandlerMap,
} from "./engine.ts"
import { AmbiguousSendError, done, type TaskLike } from "./handlers/common.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-engine-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The engine's clock is injectable, but `claimTask` reads the wall clock
 * itself and `db.ts` may not be edited. So `NOW` has to be the real present:
 * a fixed date in the past would make every backoff land in the past too, and
 * a requeued task would be immediately due again inside the same tick.
 */
const NOW = Date.now()

/**
 * Base deps: nothing reaches the filesystem, the breaker table, or the lock.
 * Handlers are supplied per test; anything unlisted would fall through to the
 * production handler, so every test that claims a task provides one.
 */
function baseDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    now: () => NOW,
    workerId: "test-worker",
    log: () => undefined,
    logEvent: () => undefined,
    isStopFilePresent: () => false,
    getCircuitBreakerState: () => null,
    renewLock: () => true,
    ...overrides,
  }
}

function clearTasks(): void {
  getDb().exec("DELETE FROM tasks")
}

function readTask(id: string): TaskRow {
  const row = getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    TaskRow | undefined
  assert.ok(row, `task ${id} vanished`)
  return row
}

/**
 * Makes a pending task due again without waiting out its real backoff.
 *
 * `claimTask` reads the wall clock internally and `db.ts` may not be edited,
 * so "time passed" is expressed by moving `run_after` rather than by faking
 * the clock. `attempts` is deliberately untouched — it is the thing under
 * test.
 */
function makeDue(id: string): void {
  getDb()
    .prepare(
      `UPDATE tasks SET run_after = 0 WHERE id = ? AND status = 'pending'`
    )
    .run(id)
}

function countPending(): number {
  const row = getDb()
    .prepare(`SELECT count(*) AS n FROM tasks WHERE status = 'pending'`)
    .get() as { n: number | bigint }
  return Number(row.n)
}

/** A handler map where every kind throws, so an unstubbed claim is loud. */
function handlersThatMustNotRun(): Partial<HandlerMap> {
  const boom = async (): Promise<never> => {
    throw new Error("handler must not have been called")
  }
  return { enrich: boom, compose: boom, send: boom, classify: boom }
}

// ---------------------------------------------------------------------------
// Task kinds and retry policies
// ---------------------------------------------------------------------------

test("there are exactly four task kinds, and no followup or callprep", () => {
  assert.deepEqual([...TASK_KINDS], ["enrich", "compose", "send", "classify"])
  assert.equal(isTaskKind("followup"), false)
  assert.equal(isTaskKind("callprep"), false)
  for (const kind of TASK_KINDS) {
    assert.ok(RETRY_POLICIES[kind], `no retry policy for ${kind}`)
  }
})

test("only `send` requires reconciliation", () => {
  assert.equal(RETRY_POLICIES.send.requiresReconciliation, true)
  assert.equal(RETRY_POLICIES.enrich.requiresReconciliation, false)
  assert.equal(RETRY_POLICIES.compose.requiresReconciliation, false)
  assert.equal(RETRY_POLICIES.classify.requiresReconciliation, false)
  // Spec §5: "exactly one resend", imported from mail-send.ts rather than
  // written twice.
  assert.equal(RETRY_POLICIES.send.maxAttempts, 2)
})

test("backoff selection is table-driven and the last value repeats", () => {
  const cases: Array<{
    policy: keyof typeof RETRY_POLICIES
    attempt: number
    expected: number
  }> = [
    { policy: "enrich", attempt: 1, expected: 60_000 },
    { policy: "enrich", attempt: 2, expected: 300_000 },
    { policy: "enrich", attempt: 3, expected: 1_200_000 },
    { policy: "enrich", attempt: 4, expected: 3_600_000 },
    // Past the end of the table: the last value repeats rather than
    // returning undefined, which would land in run_after as NaN.
    { policy: "enrich", attempt: 9, expected: 3_600_000 },
    { policy: "compose", attempt: 1, expected: 60_000 },
    { policy: "compose", attempt: 3, expected: 1_200_000 },
    { policy: "compose", attempt: 7, expected: 1_200_000 },
    { policy: "send", attempt: 1, expected: 300_000 },
    { policy: "send", attempt: 2, expected: 300_000 },
    { policy: "classify", attempt: 2, expected: 300_000 },
    // Defensive: a nonsensical attempt number still yields a usable delay.
    { policy: "classify", attempt: 0, expected: 60_000 },
  ]

  for (const c of cases) {
    assert.equal(
      backoffFor(RETRY_POLICIES[c.policy], c.attempt),
      c.expected,
      `${c.policy} attempt ${c.attempt}`
    )
  }
})

// ---------------------------------------------------------------------------
// Halting
// ---------------------------------------------------------------------------

test("the STOP file halts the tick before anything is claimed", async () => {
  clearTasks()
  const id = enqueue("enrich", { runAfter: 0 })

  const result = await tick(
    baseDeps({
      isStopFilePresent: () => true,
      handlers: handlersThatMustNotRun(),
    })
  )

  assert.equal(result.halted, "stop_file")
  assert.equal(result.claimed, 0)
  // Untouched: still pending, still never attempted.
  assert.equal(readTask(id).status, "pending")
  assert.equal(readTask(id).attempts, 0)
})

test("a tripped circuit breaker halts the tick before anything is claimed", async () => {
  clearTasks()
  const id = enqueue("enrich", { runAfter: 0 })

  const result = await tick(
    baseDeps({
      getCircuitBreakerState: () => ({
        breaker: "hard_bounce_rate",
        reason: "8% of the last 50 sends hard-bounced",
        trippedAt: NOW,
        detail: {},
      }),
      handlers: handlersThatMustNotRun(),
    })
  )

  assert.equal(result.halted, "circuit_breaker")
  assert.equal(result.claimed, 0)
  assert.equal(readTask(id).attempts, 0)
})

// ---------------------------------------------------------------------------
// Catch-up suppression (spec §5)
// ---------------------------------------------------------------------------

test("a send task 3 hours overdue does not send and is rescheduled into the next window", async () => {
  clearTasks()
  const threeHoursAgo = NOW - 3 * 60 * 60 * 1000
  const id = enqueue("send", { runAfter: threeHoursAgo })
  const nextWindow = NOW + 20 * 60 * 60 * 1000 // tomorrow 09:00-ish

  let sendCalls = 0
  const result = await tick(
    baseDeps({
      catchUpGraceMs: 45 * 60 * 1000,
      nextWindowStart: () => nextWindow,
      handlers: {
        send: async () => {
          sendCalls++
          return done()
        },
      },
    })
  )

  assert.equal(sendCalls, 0, "the send handler must never have been reached")
  assert.equal(result.claimed, 1)
  assert.equal(result.deferred, 1)

  const task = readTask(id)
  assert.equal(task.status, "pending")
  assert.equal(task.run_after, nextWindow)
  assert.match(task.last_error ?? "", /catch-up suppressed/)
  // A deferral attempted nothing, so the claim-time increment is given back.
  // Otherwise a laptop that sleeps twice exhausts MAX_SEND_ATTEMPTS without
  // ever opening a socket.
  assert.equal(task.attempts, 0)
})

test("an enrich task 3 hours overdue runs normally — it touches no one's inbox", async () => {
  clearTasks()
  const id = enqueue("enrich", { runAfter: NOW - 3 * 60 * 60 * 1000 })

  let enrichCalls = 0
  const result = await tick(
    baseDeps({
      handlers: {
        enrich: async () => {
          enrichCalls++
          return done()
        },
      },
    })
  )

  assert.equal(enrichCalls, 1)
  assert.equal(result.ok, 1)
  assert.equal(readTask(id).status, "done")
})

test("a send task inside the grace period is not suppressed", async () => {
  clearTasks()
  enqueue("send", { runAfter: NOW - 10 * 60 * 1000 })

  let sendCalls = 0
  await tick(
    baseDeps({
      catchUpGraceMs: 45 * 60 * 1000,
      handlers: {
        send: async () => {
          sendCalls++
          return done()
        },
      },
    })
  )

  assert.equal(sendCalls, 1)
})

// ---------------------------------------------------------------------------
// Failure accounting
// ---------------------------------------------------------------------------

test("a handler that always throws dead-letters after exactly maxAttempts claims", async () => {
  clearTasks()
  const id = enqueue("compose", { runAfter: 0, payload: { step: 1 } })
  const maxAttempts = RETRY_POLICIES.compose.maxAttempts
  assert.equal(maxAttempts, 3)

  let calls = 0
  const deps = baseDeps({
    handlers: {
      compose: async () => {
        calls++
        throw new Error("compose exploded")
      },
    },
  })

  for (let i = 0; i < maxAttempts; i++) {
    await tick(deps)
    makeDue(id)
  }

  assert.equal(calls, maxAttempts, "claimed more or fewer times than allowed")

  const task = readTask(id)
  assert.equal(task.status, "failed", "must end up in the dead-letter queue")
  assert.equal(task.attempts, maxAttempts)
  // Spec §9.4: a task that fails and vanishes silently is how you find out it
  // has been broken for a week. The reason has to survive.
  assert.match(task.last_error ?? "", /compose exploded/)

  // And it is not claimed again, even once it is due.
  makeDue(id)
  const after = await tick(deps)
  assert.equal(after.claimed, 0)
  assert.equal(calls, maxAttempts)
})

test("an unknown task kind is dead-lettered rather than re-claimed forever", async () => {
  clearTasks()
  const id = enqueue("followup", { runAfter: 0 })

  const result = await tick(baseDeps({ handlers: handlersThatMustNotRun() }))

  assert.equal(result.deadLettered, 1)
  const task = readTask(id)
  assert.equal(task.status, "failed")
  assert.match(task.last_error ?? "", /unknown task kind "followup"/)
})

test("an ambiguous send failure is never blind-retried", async () => {
  clearTasks()
  const id = enqueue("send", {
    runAfter: NOW - 1000,
    payload: { step: 1, subject: "s", body: "b" },
  })

  const events: string[] = []
  const result = await tick(
    baseDeps({
      logEvent: (type) => events.push(type),
      handlers: {
        send: async () => {
          throw new AmbiguousSendError("timeout after DATA", "abc-123")
        },
      },
    })
  )

  // Attempt 1 of 2 — the backoff would normally requeue it. It must not.
  assert.equal(result.failed, 0)
  assert.equal(result.deadLettered, 1)
  const task = readTask(id)
  assert.equal(task.status, "failed")
  assert.match(task.last_error ?? "", /needs reconciliation, not a retry/)
  assert.ok(events.includes("task.needs_reconciliation"))
})

test("a retryable failure is requeued with the policy's backoff", async () => {
  clearTasks()
  const id = enqueue("enrich", { runAfter: 0 })

  const result = await tick(
    baseDeps({
      handlers: {
        enrich: async () => {
          throw new Error("overpass timed out")
        },
      },
    })
  )

  assert.equal(result.failed, 1)
  assert.equal(result.deadLettered, 0)
  const task = readTask(id)
  assert.equal(task.status, "pending")
  assert.equal(task.attempts, 1)
  assert.equal(task.run_after, NOW + RETRY_POLICIES.enrich.backoffMs[0])
})

test("a handler throwing does not stop the tick from processing later tasks", async () => {
  clearTasks()
  const first = enqueue("enrich", { runAfter: 1 })
  const second = enqueue("enrich", { runAfter: 2 })
  const third = enqueue("enrich", { runAfter: 3 })

  const seen: string[] = []
  const result = await tick(
    baseDeps({
      handlers: {
        enrich: async (task: TaskLike) => {
          seen.push(task.id)
          if (task.id === first) throw new Error("first one exploded")
          return done()
        },
      },
    })
  )

  assert.deepEqual(seen, [first, second, third])
  assert.equal(result.claimed, 3)
  assert.equal(result.ok, 2)
  assert.equal(result.failed, 1)
  assert.equal(readTask(second).status, "done")
  assert.equal(readTask(third).status, "done")
})

// ---------------------------------------------------------------------------
// Re-entrancy
// ---------------------------------------------------------------------------

test("two overlapping tick() calls do not double-run a task", async () => {
  clearTasks()
  resetTickGuardForTests()
  enqueue("enrich", { runAfter: 0 })

  let calls = 0
  // Declared as a no-op rather than as `null`: TypeScript does not narrow a
  // variable assigned only inside a callback, so `null` would leave it `never`
  // at the call site below.
  let release: () => void = () => undefined
  const blocked = new Promise<void>((resolve) => {
    release = () => resolve()
  })

  const deps = baseDeps({
    handlers: {
      enrich: async () => {
        calls++
        await blocked
        return done()
      },
    },
  })

  const first = tick(deps)
  // Second caller arrives while the first is still inside the handler.
  const second = await tick(deps)

  assert.equal(second.halted, "already_running")
  assert.equal(second.claimed, 0)

  release()
  const firstResult = await first
  assert.equal(firstResult.claimed, 1)
  assert.equal(calls, 1, "the task ran twice")
})

// ---------------------------------------------------------------------------
// Bounds and bookkeeping
// ---------------------------------------------------------------------------

test("a tick claims at most maxTasksPerTick, so a backlog cannot starve the beat", async () => {
  clearTasks()
  for (let i = 0; i < 8; i++) enqueue("enrich", { runAfter: i + 1 })

  const result = await tick(
    baseDeps({
      maxTasksPerTick: 3,
      handlers: { enrich: async () => done() },
    })
  )

  assert.equal(result.claimed, 3)
  assert.equal(countPending(), 5, "the rest must wait for the next tick")
})

test("expired leases are reclaimed before new work is claimed", async () => {
  clearTasks()
  const id = enqueue("enrich", { runAfter: 0 })
  // Simulate a worker that claimed this task and then died.
  getDb()
    .prepare(
      `UPDATE tasks SET status = 'running', lease_until = ?, worker_id = 'dead-worker'
       WHERE id = ?`
    )
    .run(Date.now() - 1000, id)

  let calls = 0
  const result = await tick(
    baseDeps({
      now: () => Date.now(),
      handlers: {
        enrich: async () => {
          calls++
          return done()
        },
      },
    })
  )

  assert.equal(result.reaped, 1)
  assert.equal(calls, 1, "the reclaimed task should run in the same pass")
  assert.equal(readTask(id).status, "done")
})

test("a lost singleton heartbeat is reported rather than ignored", async () => {
  clearTasks()
  const result = await tick(baseDeps({ renewLock: () => false }))
  assert.equal(result.lockOk, false)
  assert.match(formatTickResult(result), /LOCK LOST/)
})

test("deferTask gives back exactly one attempt and never goes negative", () => {
  clearTasks()
  const id = enqueue("send", { runAfter: 0 })
  getDb().prepare(`UPDATE tasks SET attempts = 3 WHERE id = ?`).run(id)

  deferTask(id, 12345, "waiting for the send window")
  let task = readTask(id)
  assert.equal(task.attempts, 2)
  assert.equal(task.run_after, 12345)
  assert.equal(task.status, "pending")

  getDb().prepare(`UPDATE tasks SET attempts = 0 WHERE id = ?`).run(id)
  deferTask(id, 999, "again")
  task = readTask(id)
  assert.equal(task.attempts, 0, "must clamp at zero, not wrap to -1")
})

test("the default lease comfortably exceeds the slowest handler", () => {
  // A compose is a model call; a send is a model-free SMTP round trip. Five
  // minutes is the brief's figure and the reaper depends on it being longer
  // than any real handler.
  assert.equal(DEFAULT_LEASE_MS, 5 * 60 * 1000)
})

test("the tick summary line names every count a human needs", () => {
  const line = formatTickResult({
    claimed: 4,
    ok: 2,
    failed: 1,
    deadLettered: 1,
    deferred: 0,
    reaped: 0,
    lockOk: true,
  })
  assert.match(line, /claimed 4/)
  assert.match(line, /ok 2/)
  assert.match(line, /failed 1/)
  assert.match(line, /dead-lettered 1/)
})

// ---------------------------------------------------------------------------
// A dead-lettered enrich must not strand its lead
// ---------------------------------------------------------------------------

test("a lead is not left saying 'Researching' forever when enrich dead-letters", async () => {
  // What happened on real data: the model provider was not logged in, every
  // attempt threw, the task dead-lettered after four tries — and the lead sat
  // at `enriching` with no task left to move it. The Leads page said
  // "Researching" indefinitely, and nothing would ever pick it up again.
  clearTasks()
  const lead = insertLead({
    name: "Storwell Self Storage",
    type: "storage",
    source: "osm",
  })
  updateLead(lead.id, { status: "enriching" })
  const id = enqueue("enrich", { leadId: lead.id, runAfter: 0 })

  const maxAttempts = RETRY_POLICIES.enrich.maxAttempts
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    makeDue(id)
    await tick(
      baseDeps({
        handlers: {
          enrich: async () => {
            throw new Error("Not logged in to anthropic")
          },
        },
      })
    )
  }

  assert.equal(
    readTask(id).status,
    "failed",
    "the task should be dead-lettered"
  )
  assert.equal(
    getLeadById(lead.id)?.status,
    "new",
    "a dead-lettered lead has to come back to something a retry can pick up"
  )
})

test("dead-lettering does not drag a lead back out of a settled state", async () => {
  // The reset is only for the transient working state. A lead that finished
  // enrichment and then had some later task dead-letter must keep its result.
  clearTasks()
  const lead = insertLead({
    name: "Guildwood Fitness",
    type: "gym",
    source: "osm",
  })
  updateLead(lead.id, { status: "contacted" })
  const id = enqueue("enrich", { leadId: lead.id, runAfter: 0 })

  for (
    let attempt = 0;
    attempt < RETRY_POLICIES.enrich.maxAttempts;
    attempt++
  ) {
    makeDue(id)
    await tick(
      baseDeps({
        handlers: {
          enrich: async () => {
            throw new Error("boom")
          },
        },
      })
    )
  }

  assert.equal(readTask(id).status, "failed")
  assert.equal(getLeadById(lead.id)?.status, "contacted")
})
