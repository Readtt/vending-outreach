/**
 * Structured output on an OpenAI-compatible provider.
 *
 * INVARIANT FOR THIS FILE: no network. It builds a model and inspects what
 * the SDK was told, which is the thing that was wrong.
 */

import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-struct-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")

import { getModel } from "./ai.ts"
import { closeDb, getDb } from "./db.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-struct-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

after(() => {
  closeDb()
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

function provider(kind: string, baseUrl: string | null, apiKey: string | null) {
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO providers (id, kind, label, api_key, base_url, created_at)
       VALUES (?, ?, 'Test', ?, ?, ?)`
    )
    .run(id, kind, apiKey, baseUrl, Date.now())
  return id
}

test("an OpenAI-compatible model is built asking for structured output", () => {
  // Without this the SDK logs "responseFormat is not supported" and sends the
  // request with no schema at all, so `generateObject` is left parsing
  // whatever prose comes back. On real leads that failed eight times out of
  // sixteen — every one of them a business with a website, the only ones
  // worth anything.
  const id = provider("openai_compatible", "http://127.0.0.1:9/v1", null)

  const model = getModel(id, "some/model") as unknown as {
    supportsStructuredOutputs?: boolean
  }

  assert.equal(model.supportsStructuredOutputs, true)
})

test("a provider with no base URL still says so plainly", () => {
  const id = provider("openai_compatible", null, null)

  assert.throws(() => getModel(id, "some/model"), /no base URL/i)
})
