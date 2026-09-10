/**
 * A model call must always come back.
 *
 * INVARIANT FOR THIS FILE: the only server it talks to is the stalling one it
 * starts itself, on a loopback port, and the database is a throwaway.
 */

import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { randomUUID } from "node:crypto"

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-ai-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")
// Short enough that the test is quick, long enough that it is the timeout
// firing rather than a race with connection setup.
process.env.VENDING_AI_TIMEOUT_MS = "1500"

import { aiTimeoutMs, DEFAULT_AI_TIMEOUT_MS, generateGuarded } from "./ai.ts"
import { closeDb, getDb, setSetting } from "./db.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-ai-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

/** Accepts the request, sends headers, then never sends a body. */
const stalling = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" })
  // Deliberately no end() — this is the failure being reproduced.
})

after(() => {
  stalling.close()
  closeDb()
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

test("the timeout is configurable, and falls back to the default", () => {
  assert.equal(aiTimeoutMs(), 1500)

  const saved = process.env.VENDING_AI_TIMEOUT_MS
  for (const bad of ["", "nonsense", "0", "-5"]) {
    process.env.VENDING_AI_TIMEOUT_MS = bad
    assert.equal(
      aiTimeoutMs(),
      DEFAULT_AI_TIMEOUT_MS,
      `for ${JSON.stringify(bad)}`
    )
  }
  process.env.VENDING_AI_TIMEOUT_MS = saved
})

test("a provider that accepts a request and then stalls does not hang forever", async () => {
  // Three leads in a real run stopped here permanently, and the process
  // exited with "unfinished top-level await" instead of finishing the batch.
  const port = await new Promise<number>((resolve) => {
    stalling.listen(0, "127.0.0.1", () => {
      resolve((stalling.address() as { port: number }).port)
    })
  })

  const providerId = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO providers (id, kind, label, api_key, base_url, created_at)
       VALUES (?, 'openai_compatible', 'Stalling', 'x', ?, ?)`
    )
    .run(providerId, `http://127.0.0.1:${port}/v1`, Date.now())
  setSetting("ai.role.research", { providerId, modelId: "stalls/forever" })

  const startedAt = Date.now()
  await assert.rejects(
    generateGuarded({ role: "research", prompt: "hello", system: "hi" }),
    "it has to come back with something, even if that something is an error"
  )
  const elapsed = Date.now() - startedAt

  assert.ok(
    elapsed < 20_000,
    `gave up after ${elapsed}ms — the point is that it gives up at all`
  )
})
