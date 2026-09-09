/**
 * Regression test: the worker process must stay alive between ticks.
 *
 * This spawns the real entrypoint rather than calling `startWorker()`, because
 * the bug it guards against is invisible to an in-process test. The scheduling
 * timer was once `unref()`'d on the theory that IMAP connections keep the
 * process alive. With no mailbox configured there are no IMAP connections —
 * the first-run state — so the event loop emptied and Node exited cleanly
 * right after the first tick. `concurrently -k` then killed the dev server
 * too, so `pnpm dev` started and immediately died.
 *
 * Every unit test still passed, because in-process tests keep the loop alive
 * by themselves. Only the real process shape catches this.
 *
 * INVARIANT FOR THIS FILE: runs against a throwaway database in the OS temp
 * directory, never the user's live outreach data.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.join(HERE, "main.ts")

/** Long enough to outlast a first tick and prove the loop is still held open. */
const OBSERVE_MS = 6000

test("the worker stays alive after its first tick with no mailboxes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vending-liveness-"))
  const dbPath = path.join(tmp, "app.db")
  assert.ok(
    dbPath.includes("vending-liveness-"),
    "refusing to use a real database"
  )

  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", ENTRY],
    {
      env: { ...process.env, VENDING_DB_PATH: dbPath },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  let output = ""
  child.stdout.on("data", (c: Buffer) => (output += c.toString()))
  child.stderr.on("data", (c: Buffer) => (output += c.toString()))

  const exited = new Promise<{ code: number | null }>((resolve) => {
    child.on("exit", (code) => resolve({ code }))
  })
  const survived = new Promise<"alive">((resolve) =>
    setTimeout(() => resolve("alive"), OBSERVE_MS)
  )

  try {
    const outcome = await Promise.race([exited, survived])

    assert.equal(
      outcome,
      "alive",
      "the worker exited on its own instead of waiting for the next tick. " +
        `It must stay alive with no mailboxes configured — that is first-run ` +
        `state, and concurrently -k takes the dev server down with it.\n\n${output}`
    )
    // It should have actually started, not merely hung before doing anything.
    assert.match(output, /engine started/, `never logged startup:\n${output}`)
  } finally {
    child.kill("SIGKILL")
    await exited.catch(() => undefined)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

/**
 * A contended lock must not kill the UI.
 *
 * `pnpm dev` runs the worker under `concurrently -k`, so the worker exiting
 * takes `next dev` down with it. The lock is held until its heartbeat goes
 * stale (~3 minutes), so after any hard kill the old behaviour left the user
 * with no engine AND no UI for three minutes, and a message telling them to
 * wait. Waiting is something the worker can do itself.
 */
test("a held lock makes the worker wait instead of exiting", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vending-lock-"))
  const dbPath = path.join(tmp, "app.db")
  assert.ok(dbPath.includes("vending-lock-"), "refusing to use a real database")
  process.env.VENDING_DB_PATH = dbPath

  const { acquireSingletonLock, closeDb } = await import("../lib/db.ts")
  // Some other process holds it.
  assert.equal(
    acquireSingletonLock(999_999),
    true,
    "test setup: lock not taken"
  )
  closeDb()

  const { startWorker } = await import("./main.ts")
  const logs: string[] = []
  let exited = false
  let waits = 0

  const handle = await Promise.race([
    startWorker({
      pid: 1234,
      log: (line) => logs.push(line),
      exit: () => {
        exited = true
      },
      lockRetryMs: 5,
      // Give up after a few rounds so the test cannot hang if the loop breaks.
      sleep: async () => {
        if (++waits > 3) throw new Error("STOP_WAITING")
      },
      registerProcessHandlers: false,
      scheduleTicks: false,
      startWatcher: false,
    }).catch((err: unknown) => {
      if (err instanceof Error && err.message === "STOP_WAITING")
        return "waited"
      throw err
    }),
    new Promise((r) => setTimeout(() => r("timeout"), 5000)),
  ])

  try {
    assert.equal(handle, "waited", "the worker should still have been retrying")
    assert.equal(
      exited,
      false,
      "it must not exit — that kills the dev server too"
    )
    assert.ok(waits > 1, "it should have retried more than once")
    const transcript = logs.join(" | ")
    assert.match(
      transcript,
      /Waiting for it to finish or go stale/,
      `should say it is waiting, not that it is giving up: ${transcript}`
    )
  } finally {
    delete process.env.VENDING_DB_PATH
    // The lock read reopens the database, and Windows refuses to delete a file
    // that still has an open handle. Close it, and treat a failed cleanup of a
    // temp directory as noise rather than a test failure.
    try {
      const { closeDb: close } = await import("../lib/db.ts")
      close()
    } catch {
      // Already closed.
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      // A leftover temp directory is the OS's problem, not this test's.
    }
  }
})
