/**
 * The engine process. `pnpm worker` runs this; `pnpm dev` runs it alongside
 * `next dev` under `concurrently`.
 *
 * WHY THIS IS NOT `instrumentation.ts` (spec §1): Next's `register()` fires in
 * both the `nodejs` and `edge` runtimes, and HMR resets module state while the
 * old timers keep running — the observed symptom is `tick()` executing four
 * times per interval after a few saves. Long SMTP and model calls also have no
 * business on a request path. A separate process makes the lifetime explicit
 * and the kill switch a real one.
 *
 * Node 24 runs this file directly by stripping types, so: explicit `.ts` on
 * relative imports, no `@/` alias, no enums, `import type` for types.
 */

import { pathToFileURL } from "node:url"
import {
  acquireSingletonLock,
  closeDb,
  getDb,
  listMailboxes,
  logEvent,
  reapExpiredLeases,
  renewSingletonLock,
  type MailboxRow,
} from "../lib/db.ts"
import {
  confirmSentMessageIds,
  reconcilePendingSends,
  tripCircuitBreaker,
  type SentMailSearcher,
} from "../lib/mail-send.ts"
import {
  MailWatcher,
  createImapSentMailSearcher,
  type InboundRecord,
  type InboundResult,
} from "../lib/mail-receive.ts"
import { formatTickResult, tick, type TickResult } from "./engine.ts"

/** Spec §8: 60s, not 30s. IMAP is IDLE-driven, so the tick is not a poller. */
export const TICK_INTERVAL_MS = 60 * 1000

/**
 * How long to wait before retrying the single-instance lock.
 *
 * A stale lock clears after roughly three minutes, so this retries a handful
 * of times across that window rather than spinning.
 */
export const LOCK_RETRY_MS = 15 * 1000

/**
 * How often to reconcile locally-generated Message-IDs against Sent Mail.
 *
 * Five minutes is far more often than needed — the value is consumed by the
 * day-4 follow-up — but the pass is a single IMAP scan that does nothing at
 * all when there is nothing unconfirmed, so there is no reason to be stingy.
 */
export const CONFIRM_INTERVAL_MS = 5 * 60 * 1000

function stamp(): string {
  return new Date().toISOString().slice(11, 19)
}

function defaultLog(line: string): void {
  console.log(`[${stamp()}] ${line}`)
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}

/**
 * Who currently holds the single-instance lock.
 *
 * `acquireSingletonLock` returns only a boolean, and "another instance is
 * already running" is useless without the pid — the user's next action is to
 * decide whether to kill it. `db.ts` may not be edited, so this is a local
 * `getDb()` read, which is what the conventions allow it for.
 */
export function readLockHolderPid(): number | null {
  try {
    const row = getDb()
      .prepare(`SELECT owner_pid FROM singleton_lock WHERE id = 1`)
      .get() as { owner_pid: number | null } | undefined
    return row?.owner_pid ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export interface WorkerDeps {
  pid?: number
  log?: (line: string) => void
  /** Called instead of `process.exit`, so a test is not killed by one. */
  exit?: (code: number) => void
  intervalMs?: number
  tick?: () => Promise<TickResult>
  acquireLock?: (pid: number) => boolean
  readLockHolderPid?: () => number | null
  renewLock?: (pid: number) => boolean
  reapExpiredLeases?: (now: number) => unknown[]
  listMailboxes?: () => MailboxRow[]
  reconcilePendingSends?: typeof reconcilePendingSends
  createSearcher?: () => SentMailSearcher
  /** Returns something with `start`/`stop`, so tests need no IMAP. */
  createWatcher?: (
    onResult: (result: InboundResult, record: InboundRecord) => void
  ) => { start: () => void; stop: () => Promise<void> }
  tripCircuitBreaker?: typeof tripCircuitBreaker
  closeDb?: () => void
  logEvent?: typeof logEvent
  /** False in tests: process-wide handlers must not leak between them. */
  registerProcessHandlers?: boolean
  /** False in tests that only want one deterministic tick. */
  scheduleTicks?: boolean
  /** False in tests: no IMAP, no reconciliation. */
  startWatcher?: boolean
  /** Lock retry interval. `0` restores exit-on-contention, for tests. */
  lockRetryMs?: number
  /** Injectable so a test does not spend real seconds waiting. */
  sleep?: (ms: number) => Promise<void>
  /** False in tests: no IMAP, so no Message-ID confirmation pass. */
  confirmMessageIds?: boolean
  confirmSentMessageIds?: typeof confirmSentMessageIds
}

export interface WorkerHandle {
  /** Runs one tick now, outside the timer. Used by startup and by tests. */
  runTickNow: () => Promise<void>
  stop: () => Promise<void>
}

/**
 * Boots the engine, waiting for the single-instance lock if another process
 * holds it.
 *
 * Resolves to null only when `lockRetryMs` is 0 or less and the lock is held —
 * the one-shot behaviour tests use — in which case it has already logged why
 * and called `exit(0)`.
 */
export async function startWorker(
  deps: WorkerDeps = {}
): Promise<WorkerHandle | null> {
  const pid = deps.pid ?? process.pid
  const log = deps.log ?? defaultLog
  const exit = deps.exit ?? ((code: number) => process.exit(code))
  const emit = deps.logEvent ?? logEvent
  const intervalMs = deps.intervalMs ?? TICK_INTERVAL_MS
  const trip = deps.tripCircuitBreaker ?? tripCircuitBreaker

  // --- The single-instance lock -------------------------------------------
  // Two terminals running `pnpm dev` must not both drive the engine: they
  // would each claim tasks, each renew leases, and each send.
  const acquire = deps.acquireLock ?? acquireSingletonLock
  const lockRetryMs = deps.lockRetryMs ?? LOCK_RETRY_MS
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // Wait for the lock rather than exiting.
  //
  // Exiting here is worse than it looks: `pnpm dev` runs this under
  // `concurrently -k`, so one process quitting kills the dev server too. After
  // any hard kill the lock stays held until its heartbeat goes stale (~3
  // minutes), which meant a crashed worker left the user with no engine AND no
  // UI, and a message telling them to wait. Waiting is something this process
  // can do by itself.
  //
  // `lockRetryMs <= 0` keeps the old exit-immediately behaviour for tests and
  // one-shot runs.
  let announced = false
  while (!acquire(pid)) {
    if (!announced) {
      const holder = (deps.readLockHolderPid ?? readLockHolderPid)()
      log(
        `another worker holds the engine lock` +
          (holder === null ? "" : ` (pid ${holder})`) +
          `. Waiting for it to finish or go stale — the UI keeps working. ` +
          `This is normal right after a hard kill, or if \`pnpm dev\` is ` +
          `already running in another terminal.`
      )
      announced = true
    }
    if (lockRetryMs <= 0) {
      exit(0)
      return null
    }
    await sleep(lockRetryMs)
  }
  if (announced) log("engine lock acquired")
  log(`engine started (pid ${pid}), tick every ${intervalMs / 1000}s`)
  emit("engine.started", { detail: { pid, intervalMs } })

  const renew = deps.renewLock ?? renewSingletonLock
  const runTick = deps.tick ?? (() => tick({ renewLock: () => renew(pid) }))

  let timer: NodeJS.Timeout | null = null
  let stopping = false
  let inflight: Promise<TickResult> | null = null

  const schedule = (): void => {
    if (stopping || deps.scheduleTicks === false) return
    // Self-rescheduling `setTimeout`, not `setInterval`: `setInterval` does
    // not await, so a tick that takes longer than the interval overlaps with
    // the next one.
    timer = setTimeout(() => void runTickGuarded(), intervalMs)
    // Deliberately NOT unref'd.
    //
    // This timer is what holds the event loop open. An earlier version
    // unref'd it on the theory that the IMAP connections keep the process
    // alive — but there are no IMAP connections until a mailbox is
    // configured, which is exactly the state on first run. The worker
    // therefore exited straight after its first tick, and because
    // `concurrently -k` kills siblings, `pnpm dev` appeared to start and
    // immediately die.
    //
    // Even with mailboxes it was wrong: an IMAP drop plus reconnect backoff
    // leaves a window with no open sockets, and the process would exit
    // mid-backoff. `stop()` clears this timer, so a prompt shutdown never
    // depended on unref in the first place.
  }

  // --- Message-ID confirmation --------------------------------------------
  //
  // Nodemailer reports the Message-ID it generated, but a submission server
  // may replace it, and Gmail is widely reported to. If it does, the day-4
  // follow-up threads on an ID that never existed and bounce attribution
  // fails — both silently. So the copy in Sent Mail is read back and treated
  // as the truth, whichever way Gmail behaves.
  //
  // Its own connection, reused across passes: `find()` opens one per call, and
  // a login per message is how an account earns `454 Too many login attempts`.
  let confirmSearcher: SentMailSearcher | null = null
  let lastConfirmAt = 0

  const runConfirmationPass = async (): Promise<void> => {
    if (deps.confirmMessageIds === false) return
    const nowMs = Date.now()
    if (nowMs - lastConfirmAt < CONFIRM_INTERVAL_MS) return
    lastConfirmAt = nowMs

    const mailboxes = (deps.listMailboxes ?? listMailboxes)().filter(
      (m) => m.status !== "disabled"
    )
    if (mailboxes.length === 0) return

    const confirm = deps.confirmSentMessageIds ?? confirmSentMessageIds
    try {
      confirmSearcher ??= (deps.createSearcher ?? createImapSentMailSearcher)()
    } catch (err) {
      log(`message-id confirmation unavailable: ${messageOf(err)}`)
      return
    }

    for (const mailbox of mailboxes) {
      try {
        const r = await confirm(mailbox, { searcher: confirmSearcher })
        if (r.confirmed > 0 || r.incomplete > 0) {
          log(
            `message-ids for ${mailbox.email}: ${r.confirmed}/${r.checked} confirmed` +
              (r.rewritten > 0 ? `, ${r.rewritten} rewritten by Gmail` : "") +
              (r.incomplete > 0 ? `, ${r.incomplete} still unreadable` : "")
          )
        }
      } catch (err) {
        // Threading is worth repairing, never worth stopping the loop for.
        log(`message-id confirmation for ${mailbox.email}: ${messageOf(err)}`)
      }
    }
  }

  const runTickGuarded = async (): Promise<void> => {
    // The re-entrancy flag. `tick()` has its own guard at module scope, which
    // is the authoritative one; this avoids even queueing an overlapping call.
    if (inflight !== null) return
    let promise: Promise<TickResult> | null = null
    try {
      promise = runTick()
      inflight = promise
      const result = await promise
      log(formatTickResult(result))
      if (!result.lockOk) {
        // Another process took the lock over as stale, which means it is now
        // also claiming tasks. Two engines is worse than none.
        log(
          "lost the singleton lock — another engine took over. Shutting down."
        )
        emit("engine.lock_lost", { detail: { pid } })
        inflight = null
        await stop()
        exit(0)
        return
      }
    } catch (err) {
      // A tick must never be the reason the loop stops.
      log(`tick threw (the loop continues): ${messageOf(err)}`)
    } finally {
      if (inflight === promise) inflight = null
    }
    await runConfirmationPass()
    schedule()
  }

  // --- Inbound ------------------------------------------------------------
  const onResult = (result: InboundResult, record: InboundRecord): void => {
    log(
      `inbound [${record.folder}] ${result.action}: ${result.reason}` +
        (result.leadId ? ` (lead ${result.leadId})` : "")
    )
    if (result.loopAlarm !== undefined) {
      // Amendment A5: the alarm is raised independently of the triage verdict,
      // because several `ignore` rules sit above loop detection and would
      // otherwise swallow it. No loop can actually run — every outbound
      // message carries `X-Loop` — but a misconfiguration would loop silently
      // forever, so this halts everything and demands a human.
      log(`!! LOOP ALARM: ${result.loopAlarm}`)
      emit("engine.loop_alarm", {
        ...(result.leadId ? { leadId: result.leadId } : {}),
        detail: { alarm: result.loopAlarm, folder: record.folder },
      })
      trip("auto_reply_burst", `LOOP ALARM: ${result.loopAlarm}`, {
        folder: record.folder,
        leadId: result.leadId,
      })
    }
  }

  const watcher =
    deps.startWatcher === false
      ? null
      : (deps.createWatcher ?? ((cb) => new MailWatcher({ onResult: cb })))(
          onResult
        )

  // --- Shutdown ------------------------------------------------------------
  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    stopping = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    try {
      if (watcher) await watcher.stop()
    } catch (err) {
      log(`watcher shutdown: ${messageOf(err)}`)
    }
    try {
      await confirmSearcher?.close?.()
    } catch {
      /* closing a diagnostic connection must never stall a shutdown */
    }
    if (inflight !== null) {
      // Let an in-flight tick finish rather than killing it mid-send: a
      // half-finished send is precisely the ambiguous state reconciliation
      // exists to clean up, and there is no reason to manufacture one.
      log("waiting for the in-flight tick to finish...")
      await inflight.catch(() => undefined)
    }
    try {
      ;(deps.closeDb ?? closeDb)()
    } catch (err) {
      log(`db close: ${messageOf(err)}`)
    }
    log("engine stopped")
  }

  // --- Process-level safety nets ------------------------------------------
  if (deps.registerProcessHandlers !== false) {
    process.on("unhandledRejection", (reason) => {
      // Without this the loop dies silently: an unhandled rejection
      // terminates the process by default, and the last log line is a normal
      // tick summary.
      log(`UNHANDLED REJECTION (the loop continues): ${messageOf(reason)}`)
      emit("engine.unhandled_rejection", {
        detail: { reason: String(reason).slice(0, 1000) },
      })
    })

    process.on("uncaughtException", (err) => {
      log(`UNCAUGHT EXCEPTION (the loop continues): ${messageOf(err)}`)
      emit("engine.uncaught_exception", {
        detail: { error: err.message, stack: err.stack?.slice(0, 2000) },
      })
    })

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        log(`${signal} received, shutting down`)
        void stop().then(() => exit(0))
      })
    }
  }

  // --- Startup reconciliation (spec §9.5), BEFORE the first tick ----------
  await startupReconcile(deps, log)

  if (watcher) {
    try {
      watcher.start()
      log("IMAP watcher started (INBOX + [Gmail]/Spam per mailbox)")
    } catch (err) {
      log(`could not start the IMAP watcher: ${messageOf(err)}`)
    }
  }

  await runTickGuarded()

  return { runTickNow: runTickGuarded, stop }
}

/**
 * Spec §9.5. Two jobs, both of which fix state a crash left behind:
 *
 *  1. expired leases — tasks a dead worker is still nominally holding;
 *  2. `messages` rows stuck in `sending` — resolved against `[Gmail]/Sent
 *     Mail` by `X-Outreach-Id`. Until this runs, those (lead, step) pairs are
 *     blocked from any further attempt, which is the correct safe default but
 *     is also a stalled campaign.
 *
 * Every step is individually guarded: an IMAP failure at boot must not stop
 * the engine from processing enrich and compose tasks.
 */
async function startupReconcile(
  deps: WorkerDeps,
  log: (line: string) => void
): Promise<void> {
  try {
    const reaped = (deps.reapExpiredLeases ?? reapExpiredLeases)(Date.now())
    if (reaped.length > 0) {
      log(`startup: reclaimed ${reaped.length} expired task lease(s)`)
    }
  } catch (err) {
    log(`startup: lease reaper failed: ${messageOf(err)}`)
  }

  let mailboxes: MailboxRow[] = []
  try {
    mailboxes = (deps.listMailboxes ?? listMailboxes)()
  } catch (err) {
    log(`startup: could not list mailboxes: ${messageOf(err)}`)
    return
  }
  const active = mailboxes.filter((m) => m.status !== "disabled")
  if (active.length === 0) {
    log("startup: no active mailboxes — nothing to reconcile")
    return
  }

  let searcher: SentMailSearcher
  try {
    searcher = (deps.createSearcher ?? createImapSentMailSearcher)()
  } catch (err) {
    log(`startup: no Sent Mail searcher available: ${messageOf(err)}`)
    return
  }

  const reconcile = deps.reconcilePendingSends ?? reconcilePendingSends
  for (const mailbox of active) {
    try {
      const result = await reconcile(mailbox, { searcher })
      if (result.checked > 0) {
        log(
          `startup: reconciled ${mailbox.email} — ${result.checked} pending, ` +
            `${result.sent} already sent, ${result.retryable} resendable, ` +
            `${result.unknown} still unknown`
        )
      }
    } catch (err) {
      // `unknown` leaves the row in `sending`, which nothing retries. A
      // delayed email beats a duplicate one.
      log(`startup: reconciling ${mailbox.email} failed: ${messageOf(err)}`)
    }
  }

  try {
    await searcher.close?.()
  } catch {
    /* closing a diagnostic connection must never stop the boot */
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Only auto-starts when this file IS the process entry point, so the test file
 * can import `startWorker` without booting an engine as a side effect of the
 * import.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  void startWorker().catch((err: unknown) => {
    defaultLog(`engine failed to start: ${messageOf(err)}`)
    process.exit(1)
  })
}
