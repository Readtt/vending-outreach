/**
 * The tick: one pass over the task queue, and the handler map it dispatches
 * through.
 *
 * Everything expensive or dangerous lives one layer down (`lib/mail-send.ts`
 * owns the send gate, pacing, and idempotency; `lib/mail-receive.ts` owns
 * inbound; `lib/leads.ts` owns enrichment). This file is scheduling and
 * failure accounting, and it is deliberately boring.
 *
 * Node 24 runs it by stripping types: explicit `.ts` on relative imports, no
 * `@/` alias, no enums, `import type` for anything type-only.
 */

import {
  claimTask,
  completeTask,
  failTask,
  getDb,
  logEvent,
  reapExpiredLeases,
  renewSingletonLock,
  type TaskRow,
} from "../lib/db.ts"
import {
  MAX_SEND_ATTEMPTS,
  getCircuitBreakerState,
  getPacingConfig,
  isStopFilePresent,
  type CircuitBreakerState,
} from "../lib/mail-send.ts"
import { nextSendWindowStart } from "../lib/time.ts"
import {
  AmbiguousSendError,
  HOUR_MS,
  MINUTE_MS,
  type HandlerOutcome,
  type TaskHandler,
} from "./handlers/common.ts"
import { handleClassify } from "./handlers/classify.ts"
import { handleCompose } from "./handlers/compose.ts"
import { handleEnrich } from "./handlers/enrich.ts"
import { handleSend } from "./handlers/send.ts"

// ---------------------------------------------------------------------------
// Task kinds — exactly four
// ---------------------------------------------------------------------------

/**
 * There is deliberately no `followup` kind and no `callprep` kind.
 *
 * `callprep` is cut by spec §8 — the call list is a query over leads, run on
 * demand when the user opens one, not a queued artifact that goes stale.
 *
 * A follow-up is a `compose` task with `sequence_step` 4 or 9 and a future
 * `run_after`. That is the point: the day-4 email travels the same compose ->
 * validate -> send path as the first one, so there is no second, less-tested
 * code path with its own opinion about suppression.
 */
export const TASK_KINDS = ["enrich", "compose", "send", "classify"] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export function isTaskKind(kind: string): kind is TaskKind {
  return (TASK_KINDS as readonly string[]).includes(kind)
}

// ---------------------------------------------------------------------------
// Per-kind retry policy (spec §5)
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  maxAttempts: number
  /** Backoff per attempt number, ms. The last value repeats. */
  backoffMs: readonly number[]
  /** `send` only: an ambiguous failure must reconcile, never blind-retry. */
  requiresReconciliation: boolean
}

/**
 * One policy per kind, not one global rule (spec §5).
 *
 * The asymmetry is the whole point: retrying an `enrich` costs an HTTP request
 * and retrying a `classify` costs a model call, but retrying a `send` may put
 * a second copy of a cold email in a stranger's inbox. So `send` gets the
 * fewest attempts, the longest gap, and `requiresReconciliation`.
 */
export const RETRY_POLICIES: Record<TaskKind, RetryPolicy> = {
  enrich: {
    maxAttempts: 4,
    backoffMs: [60_000, 300_000, 1_200_000, 3_600_000],
    requiresReconciliation: false,
  },
  compose: {
    maxAttempts: 3,
    backoffMs: [60_000, 300_000, 1_200_000],
    requiresReconciliation: false,
  },
  send: {
    // Imported, not literal: "exactly one resend" is a property of the
    // idempotency protocol in mail-send.ts, and two copies of that number
    // drifting apart is how a lead gets emailed twice.
    maxAttempts: MAX_SEND_ATTEMPTS,
    backoffMs: [300_000],
    requiresReconciliation: true,
  },
  classify: {
    maxAttempts: 4,
    backoffMs: [60_000, 300_000, 1_200_000, 3_600_000],
    requiresReconciliation: false,
  },
}

/**
 * The backoff for the attempt that just failed. `attemptNumber` is 1-based and
 * is the value `claimTask` already wrote to `tasks.attempts`.
 *
 * The last entry repeats, so a policy with more attempts than backoff values
 * degrades to a constant delay rather than `undefined` (which would land in
 * `run_after` as NaN and make the task due forever).
 */
export function backoffFor(policy: RetryPolicy, attemptNumber: number): number {
  const index = Math.min(
    Math.max(0, Math.trunc(attemptNumber) - 1),
    policy.backoffMs.length - 1
  )
  return policy.backoffMs[index] ?? policy.backoffMs[0] ?? MINUTE_MS
}

// ---------------------------------------------------------------------------
// Deferral — a claim that attempted nothing
// ---------------------------------------------------------------------------

/**
 * Pushes a task's `run_after` out and gives back the attempt that `claimTask`
 * charged for it.
 *
 * `db.ts` has no helper for this and may not be edited, so this is the one
 * `getDb()` query the engine owns. It exists because `attempts` is incremented
 * at claim time (spec §7, correctly — a crash mid-task must not retry
 * forever), while several outcomes involve claiming a task and attempting
 * nothing at all:
 *
 *   - a `send` outside the send window, or inside the jitter gap,
 *   - a `send` whose lead is `held` for approval,
 *   - catch-up suppression after the laptop woke up.
 *
 * With `send` allowed only `MAX_SEND_ATTEMPTS` (2) attempts, charging those
 * would dead-letter every email queued outside business hours before it was
 * ever tried. `MAX(attempts - 1, 0)` is exact rather than approximate: it
 * undoes precisely the increment this claim made.
 *
 * `last_error` is written too. A deferral is not an error, but it is the only
 * explanation the user gets for why a task in the UI has a `run_after` an hour
 * out, and a silent one is the "broken for a week" failure of spec §9.4.
 */
export function deferTask(id: string, runAfter: number, reason: string): void {
  getDb()
    .prepare(
      `UPDATE tasks
       SET status = 'pending',
           run_after = ?,
           attempts = MAX(attempts - 1, 0),
           lease_until = NULL,
           worker_id = NULL,
           last_error = ?
       WHERE id = ?`
    )
    .run(runAfter, reason.slice(0, 500), id)
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export type HandlerMap = Record<TaskKind, TaskHandler>

/**
 * Production handlers, each bound with its own default dependencies. Tests
 * pass their own map through `EngineDeps.handlers`, which is why nothing in
 * this file reaches for a network, a model, or SMTP.
 */
export function defaultHandlers(): HandlerMap {
  return {
    enrich: (task) => handleEnrich(task),
    compose: (task) => handleCompose(task),
    send: (task) => handleSend(task),
    classify: (task) => handleClassify(task),
  }
}

// ---------------------------------------------------------------------------
// tick
// ---------------------------------------------------------------------------

/** At most this many tasks per pass, so one backlog cannot starve the beat. */
export const DEFAULT_MAX_TASKS_PER_TICK = 20

/** Comfortably longer than the slowest handler (a model call plus SMTP). */
export const DEFAULT_LEASE_MS = 5 * MINUTE_MS

export interface EngineDeps {
  now?: () => number
  workerId?: string
  /** Partial: unlisted kinds fall back to the production handler. */
  handlers?: Partial<HandlerMap>
  maxTasksPerTick?: number
  leaseMs?: number
  /** Defaults to the pacing config's `catchUpGraceMs` (45 min). */
  catchUpGraceMs?: number
  log?: (line: string) => void
  isStopFilePresent?: () => boolean
  getCircuitBreakerState?: () => CircuitBreakerState | null
  claimTask?: (workerId: string, leaseMs: number) => TaskRow | undefined
  completeTask?: (id: string) => void
  failTask?: (id: string, error: string, nextRunAfter: number | null) => void
  deferTask?: (id: string, runAfter: number, reason: string) => void
  reapExpiredLeases?: (now: number) => TaskRow[]
  logEvent?: (
    type: string,
    options?: { leadId?: string; detail?: unknown }
  ) => void
  /** Renews the singleton heartbeat. False means we no longer hold the lock. */
  renewLock?: () => boolean
  /** Where a catch-up-suppressed send gets rescheduled to. */
  nextWindowStart?: (from: number) => number
}

export interface TickResult {
  claimed: number
  ok: number
  failed: number
  deadLettered: number
  deferred: number
  reaped: number
  /** False when the singleton heartbeat could not be renewed. */
  lockOk: boolean
  /** Set when the pass declined to do any work, and why. */
  halted?: "stop_file" | "circuit_breaker" | "already_running"
}

function emptyResult(): TickResult {
  return {
    claimed: 0,
    ok: 0,
    failed: 0,
    deadLettered: 0,
    deferred: 0,
    reaped: 0,
    lockOk: true,
  }
}

/** One line, in the order a human reads it. Written for the dev terminal. */
export function formatTickResult(result: TickResult): string {
  if (result.halted !== undefined) {
    return `tick halted: ${result.halted}`
  }
  const parts = [
    `claimed ${result.claimed}`,
    `ok ${result.ok}`,
    `failed ${result.failed}`,
    `dead-lettered ${result.deadLettered}`,
    `deferred ${result.deferred}`,
  ]
  if (result.reaped > 0) parts.push(`reaped ${result.reaped}`)
  if (!result.lockOk) parts.push("LOCK LOST")
  return `tick: ${parts.join(" / ")}`
}

/**
 * The re-entrancy guard, at module scope.
 *
 * It lives here rather than in `main.ts` because "never run concurrently with
 * itself" is a property of the queue, not of the caller: `main.ts` schedules
 * ticks, but a signal handler, a startup pass, and a timer can all reach
 * `tick()`, and two passes overlapping means two workers claiming the same
 * lease window.
 *
 * `claimTask` is itself atomic (`BEGIN IMMEDIATE` + `RETURNING`), so a double
 * claim of one row is impossible even without this. The guard prevents the
 * softer version: the same lead's tasks being processed out of order by two
 * interleaved passes.
 */
let ticking = false

export function isTicking(): boolean {
  return ticking
}

/** Test-only escape hatch for a guard left set by a thrown test double. */
export function resetTickGuardForTests(): void {
  ticking = false
}

/**
 * Whether the STOP file / breaker halt has already been logged, so a halted
 * engine says so once instead of every 60 seconds forever. Reset when the
 * condition clears, so the *next* halt is announced again.
 */
let haltLogged: string | null = null

/**
 * One pass. Safe to call repeatedly; never runs concurrently with itself.
 *
 * A handler throwing is contained per task: the loop keeps going, because one
 * lead with a malformed website must not stop every other lead in the queue.
 */
export async function tick(deps: EngineDeps = {}): Promise<TickResult> {
  if (ticking) {
    return { ...emptyResult(), halted: "already_running" }
  }
  ticking = true
  try {
    return await runTick(deps)
  } finally {
    ticking = false
  }
}

async function runTick(deps: EngineDeps): Promise<TickResult> {
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((line: string) => console.log(line))
  const emit = deps.logEvent ?? logEvent
  const result = emptyResult()

  // --- 1. The kill switch ---------------------------------------------------
  // First, and before anything reads the database, because the user needs a
  // halt that works when the app itself is the broken thing.
  const stopFilePresent = (deps.isStopFilePresent ?? isStopFilePresent)()
  if (stopFilePresent) {
    if (haltLogged !== "stop_file") {
      haltLogged = "stop_file"
      log("STOP file present — the engine is halted. Delete it to resume.")
      emit("engine.halted", { detail: { reason: "stop_file" } })
    }
    return { ...result, halted: "stop_file" }
  }

  // --- 2. Circuit breakers --------------------------------------------------
  // Nothing is claimed while one is tripped. Re-arming is manual, from the UI:
  // every breaker fires on evidence that the campaign itself is misbehaving,
  // and auto-resuming is how a misbehaving campaign burns a domain overnight.
  const breaker = (deps.getCircuitBreakerState ?? getCircuitBreakerState)()
  if (breaker) {
    if (haltLogged !== "circuit_breaker") {
      haltLogged = "circuit_breaker"
      log(
        `circuit breaker "${breaker.breaker}" is tripped: ${breaker.reason} — ` +
          "re-arm it from the UI to resume."
      )
      emit("engine.halted", {
        detail: { reason: "circuit_breaker", breaker: breaker.breaker },
      })
    }
    return { ...result, halted: "circuit_breaker" }
  }
  haltLogged = null

  // --- 3. Reclaim what a dead worker was holding ----------------------------
  try {
    const reaped = (deps.reapExpiredLeases ?? reapExpiredLeases)(now())
    result.reaped = reaped.length
    if (reaped.length > 0) {
      emit("task.leases_reaped", {
        detail: { count: reaped.length, ids: reaped.map((t) => t.id) },
      })
    }
  } catch (err) {
    log(`lease reaper failed: ${messageOf(err)}`)
  }

  // --- 4. Claim and run due tasks ------------------------------------------
  const workerId = deps.workerId ?? `pid:${process.pid}`
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS
  const budget = deps.maxTasksPerTick ?? DEFAULT_MAX_TASKS_PER_TICK
  const claim = deps.claimTask ?? claimTask

  for (let i = 0; i < budget; i++) {
    let task: TaskRow | undefined
    try {
      task = claim(workerId, leaseMs)
    } catch (err) {
      log(`claim failed: ${messageOf(err)}`)
      break
    }
    if (!task) break
    result.claimed++
    await runOneTask(task, deps, result, log, emit)
  }

  // --- 5. Heartbeat ---------------------------------------------------------
  try {
    const renew = deps.renewLock ?? (() => renewSingletonLock(process.pid))
    result.lockOk = renew()
  } catch (err) {
    log(`heartbeat failed: ${messageOf(err)}`)
    result.lockOk = false
  }

  return result
}

async function runOneTask(
  task: TaskRow,
  deps: EngineDeps,
  result: TickResult,
  log: (line: string) => void,
  emit: (type: string, options?: { leadId?: string; detail?: unknown }) => void
): Promise<void> {
  const now = deps.now ?? Date.now
  const complete = deps.completeTask ?? completeTask
  const fail = deps.failTask ?? failTask
  const defer = deps.deferTask ?? deferTask

  const deadLetter = (reason: string): void => {
    fail(task.id, reason, null)
    result.deadLettered++
    // Spec §9.4: tasks that fail repeatedly and vanish silently are how you
    // find out it has been broken for a week. This event is what the
    // observability page reads.
    emit("task_dead_letter", {
      ...(task.lead_id ? { leadId: task.lead_id } : {}),
      detail: {
        taskId: task.id,
        kind: task.kind,
        attempts: task.attempts,
        reason,
      },
    })
    log(`dead-lettered ${task.kind} ${task.id}: ${reason}`)
  }

  if (!isTaskKind(task.kind)) {
    // An unknown kind can never succeed, so retrying it just re-claims it
    // every tick forever. Dead-letter keeps it visible instead.
    deadLetter(`unknown task kind "${task.kind}"`)
    return
  }
  const kind: TaskKind = task.kind
  const policy = RETRY_POLICIES[kind]

  // --- Catch-up suppression (spec §5) --------------------------------------
  // Windows laptops sleep, `setTimeout` does not fire while suspended, and on
  // wake every overdue task is due at once. Without this, a six-hour sleep
  // sends 25 emails in 30 seconds — exactly the burst pattern abuse detection
  // exists to catch.
  //
  // `send` only. `enrich`, `compose`, and `classify` touch no one's inbox, so
  // running them late is not merely harmless, it is what catching up means.
  //
  // `canSendNow` enforces the same rule inside the send path, from the same
  // `catchUpGraceMs`, and IT is the authoritative one. This check is here so
  // that an overdue send is rescheduled without a lead read, a mailbox scan,
  // or a `messages` row being claimed first.
  if (kind === "send") {
    const grace = deps.catchUpGraceMs ?? pacingCatchUpGraceMs()
    const overdueBy = now() - task.run_after
    if (overdueBy > grace) {
      const nextWindow =
        deps.nextWindowStart ?? ((from: number) => defaultNextWindowStart(from))
      const runAfter = nextWindow(now())
      const reason =
        `catch-up suppressed: due ${Math.round(overdueBy / MINUTE_MS)} min ago ` +
        `(grace ${Math.round(grace / MINUTE_MS)} min) — almost certainly a ` +
        `sleep/wake backlog; rescheduled to ${new Date(runAfter).toISOString()}`
      defer(task.id, runAfter, reason)
      result.deferred++
      emit("task.catchup_suppressed", {
        ...(task.lead_id ? { leadId: task.lead_id } : {}),
        detail: { taskId: task.id, overdueByMs: overdueBy, runAfter },
      })
      return
    }
  }

  const handler = deps.handlers?.[kind] ?? defaultHandlers()[kind]

  let outcome: HandlerOutcome
  try {
    outcome = await handler(task)
  } catch (err) {
    // A handler throwing must never kill the loop.
    const reason = messageOf(err)

    if (policy.requiresReconciliation && err instanceof AmbiguousSendError) {
      // Spec §5: reconcile, never blind-resend. A retry here is a coin flip on
      // whether a stranger receives the same cold email twice. The `messages`
      // row stays `sending`, which no code path retries, and startup
      // reconciliation against Sent Mail settles it.
      deadLetter(`needs reconciliation, not a retry: ${reason}`)
      emit("task.needs_reconciliation", {
        ...(task.lead_id ? { leadId: task.lead_id } : {}),
        detail: { taskId: task.id, outreachId: err.outreachId, reason },
      })
      return
    }

    if (task.attempts >= policy.maxAttempts) {
      deadLetter(reason)
      return
    }
    fail(task.id, reason, now() + backoffFor(policy, task.attempts))
    result.failed++
    log(
      `${kind} ${task.id} failed (attempt ${task.attempts}/${policy.maxAttempts}), ` +
        `retrying: ${reason}`
    )
    return
  }

  switch (outcome.status) {
    case "done":
      complete(task.id)
      result.ok++
      return
    case "deferred":
      defer(task.id, outcome.runAfter, outcome.reason)
      result.deferred++
      return
    case "dead_letter":
      deadLetter(outcome.reason)
      return
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** The grace period, read from the same settings the send gate reads. */
function pacingCatchUpGraceMs(): number {
  try {
    return getPacingConfig().catchUpGraceMs
  } catch {
    return 45 * MINUTE_MS
  }
}

/**
 * The next valid send window, in the operator's zone.
 *
 * The recipient's zone is the right one for an individual send and
 * `canSendNow` uses it. Here there is no lead in hand yet — the point of the
 * catch-up check is to reschedule before reading anything — so the operator's
 * zone is the available approximation, and the authoritative per-recipient
 * check still runs when the task comes back around.
 */
function defaultNextWindowStart(from: number): number {
  try {
    const pacing = getPacingConfig()
    return nextSendWindowStart(from, pacing.operatorTimezone, {
      startHour: pacing.windowStartHour,
      endHour: pacing.windowEndHour,
      weekdaysOnly: pacing.weekdaysOnly,
    })
  } catch {
    return from + HOUR_MS
  }
}
