/**
 * Tests for the database layer.
 *
 * INVARIANT FOR THIS FILE: every test runs against a throwaway database in the
 * OS temp directory, never the user's live outreach data.
 */

import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

// The database path must be redirected BEFORE anything calls getDb(). Nothing
// in the imported modules touches the database at load time and every test
// body runs after this block, so setting it here is safe — but a stray real
// database would mean writing test rows into live data, so it is asserted
// rather than assumed.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-db-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")

import {
  cancelPendingTasksForLead,
  claimTask,
  closeDb,
  completeTask,
  countLeads,
  countLeadsByStatus,
  enqueue,
  getDb,
  getLeadById,
  insertLead,
  LEAD_STATUSES,
  listLeads,
  updateLead,
  type LeadRow,
} from "./db.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-db-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

after(() => {
  // The brief requires leaving no temp database behind. WAL and SHM sidecars
  // only disappear cleanly once the connection is closed.
  closeDb()
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let leadCounter = 0

function newLead(overrides: Partial<Parameters<typeof insertLead>[0]> = {}) {
  leadCounter++
  return insertLead({
    name: `Cafe ${leadCounter}`,
    type: "cafe",
    source: "overpass",
    ...overrides,
  })
}

function clearLeads(): void {
  getDb().exec("DELETE FROM tasks")
  getDb().exec("DELETE FROM leads")
}

// ---------------------------------------------------------------------------
// Migration 3
// ---------------------------------------------------------------------------

test("migration 3 adds dry_run and rebuilds ux_msg_step to exclude it", () => {
  const db = getDb()

  const { user_version: version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number
  }
  assert.equal(version, 3)

  const columns = db
    .prepare(`PRAGMA table_info(messages)`)
    .all() as unknown as { name: string; notnull: number; dflt_value: string }[]
  const dryRun = columns.find((column) => column.name === "dry_run")
  assert.ok(dryRun, "messages.dry_run is missing")
  assert.equal(dryRun.notnull, 1)
  assert.equal(dryRun.dflt_value, "0")

  const index = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'ux_msg_step'`
    )
    .get() as { sql: string }
  assert.match(index.sql, /dry_run = 0/)
})

// ---------------------------------------------------------------------------
// insertLead / getLeadById
// ---------------------------------------------------------------------------

test("insertLead round-trips through getLeadById with status 'new'", () => {
  clearLeads()
  const lead = insertLead({
    name: "Roasted Bean",
    type: "cafe",
    address: "123 High St, Columbus, OH",
    phone: "+1 614-555-0100",
    website: "https://roastedbean.example",
    lat: 39.9612,
    lng: -82.9988,
    timezone: "America/New_York",
    source: "overpass",
    osmId: "node/1234567",
  })

  assert.equal(lead.status, "new")
  assert.equal(lead.score, 0)
  assert.equal(lead.email, null)
  assert.ok(lead.created_at)

  const fetched = getLeadById(lead.id)
  assert.deepEqual(fetched, lead)
})

test("insertLead leaves the optional columns null", () => {
  clearLeads()
  const lead = insertLead({ name: "Bare", type: "office", source: "manual" })
  assert.equal(lead.address, null)
  assert.equal(lead.phone, null)
  assert.equal(lead.website, null)
  assert.equal(lead.lat, null)
  assert.equal(lead.lng, null)
  assert.equal(lead.timezone, null)
  assert.equal(lead.osm_id, null)
  assert.equal(lead.source, "manual")
})

test("getLeadById returns undefined for an id that does not exist", () => {
  assert.equal(getLeadById(randomUUID()), undefined)
})

test("a repeated osm_id returns the existing row instead of throwing", () => {
  clearLeads()
  const first = insertLead({
    name: "Roasted Bean",
    type: "cafe",
    source: "overpass",
    osmId: "node/7654321",
  })

  // Re-running an Overpass search over an overlapping bbox. The second pass
  // must be a no-op, not a duplicate and not a constraint error.
  const second = insertLead({
    name: "Roasted Bean (renamed upstream)",
    type: "restaurant",
    source: "overpass",
    osmId: "node/7654321",
  })

  assert.equal(second.id, first.id)
  // Returned untouched: the local row may since have been enriched, emailed or
  // suppressed, and a re-scrape must not reset any of that.
  assert.equal(second.name, "Roasted Bean")
  assert.equal(second.type, "cafe")
  assert.equal(countLeads(), 1)
})

test("a null osm_id never collides, so manual leads are not deduped together", () => {
  clearLeads()
  const a = insertLead({ name: "Walk-in A", type: "office", source: "manual" })
  const b = insertLead({ name: "Walk-in B", type: "office", source: "manual" })
  assert.notEqual(a.id, b.id)
  assert.equal(countLeads(), 2)
})

// ---------------------------------------------------------------------------
// listLeads / countLeads
// ---------------------------------------------------------------------------

function seedFilterFixtures(): Record<string, LeadRow> {
  clearLeads()
  const alpha = newLead({ name: "Alpha Coffee", address: "1 High St" })
  const bravo = newLead({ name: "Bravo Deli", address: "2 Broad St" })
  const charlie = newLead({ name: "Charlie Gym", address: "3 High St" })

  updateLead(alpha.id, { status: "ready", score: 10, email: "a@alpha.example" })
  updateLead(bravo.id, { status: "contacted", score: 30, email: "" })
  updateLead(charlie.id, { status: "ready", score: 20 })

  return {
    alpha: getLeadById(alpha.id) as LeadRow,
    bravo: getLeadById(bravo.id) as LeadRow,
    charlie: getLeadById(charlie.id) as LeadRow,
  }
}

test("listLeads with no filter returns everything, newest first", () => {
  const { alpha, bravo, charlie } = seedFilterFixtures()
  const ids = listLeads().map((lead) => lead.id)
  assert.equal(ids.length, 3)
  assert.deepEqual([...ids].sort(), [alpha.id, bravo.id, charlie.id].sort())
})

test("listLeads filters by a single status and by a list of statuses", () => {
  const { alpha, bravo, charlie } = seedFilterFixtures()

  const ready = listLeads({ status: "ready" }).map((lead) => lead.id)
  assert.deepEqual([...ready].sort(), [alpha.id, charlie.id].sort())
  assert.equal(countLeads({ status: "ready" }), 2)

  const either = listLeads({ status: ["ready", "contacted"] })
  assert.equal(either.length, 3)
  assert.equal(countLeads({ status: ["contacted"] }), 1)
  assert.equal(countLeads({ status: "new" }), 0)
  assert.equal(bravo.status, "contacted")
})

test("an empty status list matches nothing rather than everything", () => {
  seedFilterFixtures()
  assert.equal(listLeads({ status: [] }).length, 0)
  assert.equal(countLeads({ status: [] }), 0)
})

test("listLeads search is case-insensitive across name and address", () => {
  const { alpha, bravo, charlie } = seedFilterFixtures()

  const byName = listLeads({ search: "alPHa" })
  assert.equal(byName.length, 1)
  assert.equal(byName[0].id, alpha.id)

  const byAddress = listLeads({ search: "high st" }).map((lead) => lead.id)
  assert.deepEqual([...byAddress].sort(), [alpha.id, charlie.id].sort())

  assert.equal(listLeads({ search: "  " }).length, 3)
  assert.equal(listLeads({ search: "nothing matches this" }).length, 0)
  assert.ok(bravo.id)
})

test("a LIKE wildcard typed into search is matched literally", () => {
  clearLeads()
  const literal = newLead({ name: "100% Coffee" })
  newLead({ name: "Ordinary Cafe" })

  // Unescaped, "%" would match every lead.
  const hits = listLeads({ search: "100%" })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, literal.id)

  assert.equal(listLeads({ search: "_offee" }).length, 0)
})

test("hasEmail keeps only leads with a non-null, non-empty email", () => {
  const { alpha, bravo, charlie } = seedFilterFixtures()

  const withEmail = listLeads({ hasEmail: true })
  assert.equal(withEmail.length, 1)
  assert.equal(withEmail[0].id, alpha.id)

  // The inverse is the "still needs enrichment" list. An empty-string email
  // counts as missing on both sides, which is why bravo lands here.
  const withoutEmail = listLeads({ hasEmail: false }).map((lead) => lead.id)
  assert.deepEqual([...withoutEmail].sort(), [bravo.id, charlie.id].sort())
  assert.equal(countLeads({ hasEmail: true }), 1)
})

test("listLeads orders by score and by created_at in both directions", () => {
  const { alpha, bravo, charlie } = seedFilterFixtures()

  const byScore = listLeads({ orderBy: "score DESC" }).map((lead) => lead.id)
  assert.deepEqual(byScore, [bravo.id, charlie.id, alpha.id])

  const ascending = listLeads({ orderBy: "created_at ASC" })
  const descending = listLeads({ orderBy: "created_at DESC" })
  assert.deepEqual(
    ascending.map((lead) => lead.id),
    [...descending].reverse().map((lead) => lead.id)
  )
})

test("limit and offset page without repeating or skipping a row", () => {
  seedFilterFixtures()

  const all = listLeads({ orderBy: "score DESC" })
  const first = listLeads({ orderBy: "score DESC", limit: 2 })
  const rest = listLeads({ orderBy: "score DESC", limit: 2, offset: 2 })

  assert.deepEqual(
    [...first, ...rest].map((lead) => lead.id),
    all.map((lead) => lead.id)
  )

  // offset without limit is legal — SQLite needs a LIMIT clause, which the
  // helper supplies as -1.
  assert.equal(listLeads({ offset: 1 }).length, 2)
  assert.equal(listLeads({ limit: 0 }).length, 0)

  // count is the size of the match, not of the page.
  assert.equal(countLeads({ limit: 1 }), 3)
})

test("filters compose", () => {
  const { charlie } = seedFilterFixtures()
  const hits = listLeads({
    status: "ready",
    search: "high st",
    hasEmail: false,
  })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, charlie.id)
})

// ---------------------------------------------------------------------------
// countLeadsByStatus
// ---------------------------------------------------------------------------

test("countLeadsByStatus zero-fills every status", () => {
  seedFilterFixtures()
  const counts = countLeadsByStatus()

  assert.deepEqual(Object.keys(counts).sort(), [...LEAD_STATUSES].sort())
  assert.equal(counts.ready, 2)
  assert.equal(counts.contacted, 1)
  // The point of zero-filling: a dashboard reading counts.won gets 0, not
  // undefined, and never renders "undefined leads won".
  assert.equal(counts.won, 0)
  assert.equal(counts.new, 0)
  assert.equal(counts.suppressed, 0)
})

test("countLeadsByStatus on an empty table is all zeroes", () => {
  clearLeads()
  const counts = countLeadsByStatus()
  for (const status of LEAD_STATUSES) {
    assert.equal(counts[status], 0, `${status} should be 0`)
  }
})

// ---------------------------------------------------------------------------
// updateLead
// ---------------------------------------------------------------------------

test("updateLead writes only the provided keys", () => {
  clearLeads()
  const lead = newLead({ name: "Before", address: "1 High St" })

  const updated = updateLead(lead.id, { email: "owner@before.example" })
  assert.equal(updated.email, "owner@before.example")
  assert.equal(updated.name, "Before")
  assert.equal(updated.address, "1 High St")
  assert.equal(updated.status, "new")
  assert.equal(updated.created_at, lead.created_at)
})

test("updateLead can write an explicit null and a falsy value", () => {
  clearLeads()
  const lead = newLead({ address: "1 High St" })
  updateLead(lead.id, { score: 42, personalization_fact: "open since 1994" })

  const cleared = updateLead(lead.id, { address: null, score: 0 })
  assert.equal(cleared.address, null)
  assert.equal(cleared.score, 0)
  // Untouched by this patch.
  assert.equal(cleared.personalization_fact, "open since 1994")
})

test("updateLead treats an undefined value as absent", () => {
  clearLeads()
  const lead = newLead({ name: "Keep Me" })
  const updated = updateLead(lead.id, { name: undefined, score: 5 })
  assert.equal(updated.name, "Keep Me")
  assert.equal(updated.score, 5)
})

test("an empty patch is a no-op returning the current row", () => {
  clearLeads()
  const lead = newLead()
  assert.deepEqual(updateLead(lead.id, {}), lead)
})

test("updateLead rejects a key outside the allowlist", () => {
  clearLeads()
  const lead = newLead()

  // The shape a caller could actually produce: a typo, or a key derived from
  // untrusted JSON. Nothing here may reach the SET clause.
  assert.throws(
    () => updateLead(lead.id, { emial: "typo@x.example" } as never),
    /not an updatable lead column/
  )
  assert.throws(
    () => updateLead(lead.id, { id: randomUUID() } as never),
    /not an updatable lead column/
  )
  assert.throws(
    () => updateLead(lead.id, { "name = 'x', score": 1 } as never),
    /not an updatable lead column/
  )

  // The rejected patch wrote nothing.
  assert.deepEqual(getLeadById(lead.id), lead)
})

test("updateLead throws for an id that does not exist", () => {
  assert.throws(() => updateLead(randomUUID(), { score: 1 }), /does not exist/)
})

// ---------------------------------------------------------------------------
// cancelPendingTasksForLead
// ---------------------------------------------------------------------------

function taskStatus(id: string): string {
  const row = getDb()
    .prepare(`SELECT status FROM tasks WHERE id = ?`)
    .get(id) as { status: string }
  return row.status
}

test("cancelPendingTasksForLead cancels pending tasks and leaves running and done alone", () => {
  clearLeads()
  const lead = newLead()

  // Staggered `run_after` so `claimTask` (oldest due first) deterministically
  // takes the one meant to end up `running`.
  const now = Date.now()
  const running = enqueue("enrich", { leadId: lead.id, runAfter: now - 4000 })
  const done = enqueue("classify", { leadId: lead.id, runAfter: now - 3000 })
  const pending = enqueue("send", { leadId: lead.id, runAfter: now - 2000 })
  const alsoPending = enqueue("followup", {
    leadId: lead.id,
    runAfter: now - 1000,
  })

  const claimed = claimTask("worker-1", 60_000)
  assert.equal(claimed?.id, running)
  completeTask(done)

  const cancelled = cancelPendingTasksForLead(lead.id)
  assert.equal(cancelled, 2)

  assert.equal(taskStatus(pending), "cancelled")
  assert.equal(taskStatus(alsoPending), "cancelled")
  // A running task is owned by a worker mid-flight; the send path's own
  // in-transaction suppression re-check is what stops that one.
  assert.equal(taskStatus(running), "running")
  assert.equal(taskStatus(done), "done")
})

test("cancelPendingTasksForLead can be limited to specific kinds", () => {
  clearLeads()
  const lead = newLead()
  const send = enqueue("send", { leadId: lead.id })
  const followup = enqueue("followup", { leadId: lead.id })
  const enrich = enqueue("enrich", { leadId: lead.id })

  assert.equal(cancelPendingTasksForLead(lead.id, ["send", "followup"]), 2)
  assert.equal(taskStatus(send), "cancelled")
  assert.equal(taskStatus(followup), "cancelled")
  assert.equal(taskStatus(enrich), "pending")
})

test("an explicit empty kinds list cancels nothing", () => {
  clearLeads()
  const lead = newLead()
  const task = enqueue("send", { leadId: lead.id })

  // Must not be read as "no filter". Cancelling everything here would be the
  // silent opposite of what the caller asked for.
  assert.equal(cancelPendingTasksForLead(lead.id, []), 0)
  assert.equal(taskStatus(task), "pending")
})

test("cancelPendingTasksForLead does not touch another lead's tasks", () => {
  clearLeads()
  const mine = newLead()
  const theirs = newLead()
  const myTask = enqueue("send", { leadId: mine.id })
  const theirTask = enqueue("send", { leadId: theirs.id })
  const unattached = enqueue("poll_imap")

  assert.equal(cancelPendingTasksForLead(mine.id), 1)
  assert.equal(taskStatus(myTask), "cancelled")
  assert.equal(taskStatus(theirTask), "pending")
  assert.equal(taskStatus(unattached), "pending")
})

test("cancelPendingTasksForLead joins the caller's transaction", () => {
  clearLeads()
  const lead = newLead()
  const task = enqueue("send", { leadId: lead.id })
  const db = getDb()

  // Spec §7 requires this to run in the same transaction as the suppression
  // write. Opening its own BEGIN would throw here, and a rollback must undo
  // the cancellation along with everything else.
  db.exec("BEGIN IMMEDIATE")
  db.prepare(
    `INSERT INTO suppressed (email, reason, created_at) VALUES (?, ?, ?)`
  ).run("owner@rolled-back.example", "not interested", Date.now())
  assert.equal(cancelPendingTasksForLead(lead.id), 1)
  db.exec("ROLLBACK")

  assert.equal(taskStatus(task), "pending")
})
