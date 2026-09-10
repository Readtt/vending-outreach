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
  MIGRATION_COUNT,
  listLeads,
  saveSearchResult,
  getSearchResult,
  SEARCH_RESULT_KEEP,
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

function indexSql(name: string): string {
  const row = getDb()
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(name) as { sql: string } | undefined
  assert.ok(row, `index ${name} is missing`)
  return row.sql
}

test("migration 3 adds dry_run and splits ux_msg_step into two namespaces", () => {
  const db = getDb()

  const { user_version: version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number
  }
  // Not `=== 3`: this must keep passing the moment a migration 4 lands.
  assert.ok(version >= 3, `expected user_version >= 3, got ${version}`)

  const columns = db
    .prepare(`PRAGMA table_info(messages)`)
    .all() as unknown as { name: string; notnull: number; dflt_value: string }[]
  const dryRun = columns.find((column) => column.name === "dry_run")
  assert.ok(dryRun, "messages.dry_run is missing")
  assert.equal(dryRun.notnull, 1)
  assert.equal(dryRun.dflt_value, "0")

  // Every term is asserted, not just the new one. This index is *the*
  // structural guarantee that a lead cannot receive the same step twice
  // (spec §0.4); a migration that quietly dropped `direction = 'out'` or
  // `sequence_step IS NOT NULL` would widen or void it, and a test that only
  // looked for `dry_run` would wave that through.
  const real = indexSql("ux_msg_step")
  assert.match(real, /ON messages\(lead_id, sequence_step\)/)
  assert.match(real, /direction = 'out'/)
  assert.match(real, /sequence_step IS NOT NULL/)
  assert.match(real, /dry_run = 0/)
  assert.match(real, /^CREATE UNIQUE INDEX/)

  const rehearsal = indexSql("ux_msg_step_dryrun")
  assert.match(rehearsal, /ON messages\(lead_id, sequence_step\)/)
  assert.match(rehearsal, /direction = 'out'/)
  assert.match(rehearsal, /sequence_step IS NOT NULL/)
  assert.match(rehearsal, /dry_run = 1/)
  assert.match(rehearsal, /^CREATE UNIQUE INDEX/)
})

test("migration 3 backfills legacy dry-run rows and unblocks their real send", () => {
  // Rows written before the column existed carry `{"dryRun":true}` in `error`.
  // `ADD COLUMN ... NOT NULL DEFAULT 0` would stamp them as real sends, so
  // they would keep blocking their lead's real email forever while being
  // invisible to `countDryRunMessages` and unreachable by
  // `clearDryRunMessages` — the fix would ship with no remediation for the
  // rows it was written to rescue.
  const mainPath = process.env.VENDING_DB_PATH as string
  const legacyPath = path.join(TMP_ROOT, "legacy-v2.db")

  try {
    closeDb()
    process.env.VENDING_DB_PATH = legacyPath
    const fresh = getDb()

    // Rewind the schema to its pre-migration-3 shape. Done by undoing the
    // later migrations rather than by restating migrations 1 and 2, so this
    // fixture cannot drift away from the real schema. Every migration added
    // after this one has to be undone here too, or reopening replays it
    // against a schema that already has it.
    fresh.exec(`
      DROP TABLE searches;
      ALTER TABLE leads DROP COLUMN country;
      DROP INDEX ux_msg_step;
      DROP INDEX ux_msg_step_dryrun;
      ALTER TABLE messages DROP COLUMN dry_run;
      CREATE UNIQUE INDEX ux_msg_step ON messages(lead_id, sequence_step)
        WHERE direction = 'out' AND sequence_step IS NOT NULL;
      PRAGMA user_version = 2;
    `)

    const leadId = randomUUID()
    fresh
      .prepare(
        `INSERT INTO leads (id, name, status, score, created_at)
         VALUES (?, 'Legacy Cafe', 'contacted', 0, 1)`
      )
      .run(leadId)

    const legacyDryRunId = randomUUID()
    const legacyRealId = randomUUID()
    const insert = fresh.prepare(
      `INSERT INTO messages (id, lead_id, direction, sequence_step, outreach_id,
                             status, error, sent_at, created_at)
       VALUES (?, ?, 'out', ?, ?, 'sent', ?, 1, 1)`
    )
    insert.run(
      legacyDryRunId,
      leadId,
      1,
      randomUUID(),
      JSON.stringify({ attempts: 1, step: 1, dryRun: true })
    )
    insert.run(
      legacyRealId,
      leadId,
      2,
      randomUUID(),
      JSON.stringify({ attempts: 1, step: 2 })
    )

    closeDb()
    const migrated = getDb() // migrations 3 and 4 run on open

    const { user_version: version } = migrated
      .prepare("PRAGMA user_version")
      .get() as { user_version: number }
    assert.equal(version, MIGRATION_COUNT)

    const rows = migrated
      .prepare(`SELECT id, dry_run FROM messages ORDER BY sequence_step`)
      .all() as unknown as { id: string; dry_run: number }[]
    assert.deepEqual(
      // Re-wrapped because node:sqlite hands back null-prototype objects and
      // deepEqual compares prototypes.
      rows.map((row) => ({ id: row.id, dry_run: row.dry_run })),
      [
        { id: legacyDryRunId, dry_run: 1 },
        { id: legacyRealId, dry_run: 0 },
      ]
    )

    // The remediation helpers can now see it...
    const counted = migrated
      .prepare(
        `SELECT count(*) AS n FROM messages WHERE direction = 'out' AND dry_run = 1`
      )
      .get() as { n: number | bigint }
    assert.equal(Number(counted.n), 1)

    // ...and, the actual point: step 1's real send is no longer blocked.
    migrated
      .prepare(
        `INSERT INTO messages (id, lead_id, direction, sequence_step, outreach_id,
                               status, sent_at, created_at, dry_run)
         VALUES (?, ?, 'out', 1, ?, 'sent', 2, 2, 0)`
      )
      .run(randomUUID(), leadId, randomUUID())

    // Step 2 was a real send and must still be blocked.
    assert.throws(
      () =>
        migrated
          .prepare(
            `INSERT INTO messages (id, lead_id, direction, sequence_step, outreach_id,
                                   status, sent_at, created_at, dry_run)
             VALUES (?, ?, 'out', 2, ?, 'sent', 2, 2, 0)`
          )
          .run(randomUUID(), leadId, randomUUID()),
      /UNIQUE constraint failed/
    )
  } finally {
    closeDb()
    process.env.VENDING_DB_PATH = mainPath
    getDb()
  }
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

test("an empty or blank osm_id is stored as null, not as a shared identity", () => {
  clearLeads()

  // SQLite treats every NULL as distinct but two empty strings as equal, so an
  // importer that emits "" for a way with no stable id would otherwise see
  // every such lead collapse into the first one.
  const a = insertLead({
    name: "Blank A",
    type: "cafe",
    source: "overpass",
    osmId: "",
  })
  const b = insertLead({
    name: "Blank B",
    type: "cafe",
    source: "overpass",
    osmId: "   ",
  })

  assert.equal(a.osm_id, null)
  assert.equal(b.osm_id, null)
  assert.notEqual(a.id, b.id)
  assert.equal(countLeads(), 2)

  // A real id is still trimmed and still dedupes.
  const padded = insertLead({
    name: "Padded",
    type: "cafe",
    source: "overpass",
    osmId: "  node/42  ",
  })
  assert.equal(padded.osm_id, "node/42")
  const again = insertLead({
    name: "Padded again",
    type: "cafe",
    source: "overpass",
    osmId: "node/42",
  })
  assert.equal(again.id, padded.id)
  assert.equal(countLeads(), 3)
})

// ---------------------------------------------------------------------------
// listLeads / countLeads
// ---------------------------------------------------------------------------

/**
 * `created_at` is not in `UPDATABLE_LEAD_COLUMNS` — deliberately, it is set
 * once at insert — so ordering fixtures have to reach past `updateLead`.
 */
function setCreatedAt(id: string, createdAt: number): void {
  getDb()
    .prepare(`UPDATE leads SET created_at = ? WHERE id = ?`)
    .run(createdAt, id)
}

function seedFilterFixtures(): Record<string, LeadRow> {
  clearLeads()
  const alpha = newLead({ name: "Alpha Coffee", address: "1 High St" })
  const bravo = newLead({ name: "Bravo Deli", address: "2 Broad St" })
  const charlie = newLead({ name: "Charlie Gym", address: "3 High St" })

  updateLead(alpha.id, { status: "ready", score: 10, email: "a@alpha.example" })
  updateLead(bravo.id, { status: "contacted", score: 30, email: "" })
  updateLead(charlie.id, { status: "ready", score: 20 })

  // All three land in the same millisecond otherwise, which makes every
  // ordering assertion below unfalsifiable.
  setCreatedAt(alpha.id, 1_000)
  setCreatedAt(bravo.id, 2_000)
  setCreatedAt(charlie.id, 3_000)

  return {
    alpha: getLeadById(alpha.id) as LeadRow,
    bravo: getLeadById(bravo.id) as LeadRow,
    charlie: getLeadById(charlie.id) as LeadRow,
  }
}

test("listLeads with no filter returns everything, newest first", () => {
  const { alpha, bravo, charlie } = seedFilterFixtures()
  assert.deepEqual(
    listLeads().map((lead) => lead.id),
    [charlie.id, bravo.id, alpha.id]
  )
})

test("listLeads filters by a single status and by a list of statuses", () => {
  const { alpha, bravo, charlie } = seedFilterFixtures()

  const ready = listLeads({ status: "ready" }).map((lead) => lead.id)
  assert.deepEqual([...ready].sort(), [alpha.id, charlie.id].sort())
  assert.equal(countLeads({ status: "ready" }), 2)

  assert.deepEqual(
    listLeads({ status: "contacted" }).map((lead) => lead.id),
    [bravo.id]
  )

  const either = listLeads({ status: ["ready", "contacted"] })
  assert.equal(either.length, 3)
  assert.equal(countLeads({ status: ["contacted"] }), 1)
  assert.equal(countLeads({ status: "new" }), 0)
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

  // The other address, so the match is shown to be discriminating rather than
  // just returning whatever shares a street suffix.
  assert.deepEqual(
    listLeads({ search: "Broad" }).map((lead) => lead.id),
    [bravo.id]
  )

  assert.equal(listLeads({ search: "  " }).length, 3)
  assert.equal(listLeads({ search: "nothing matches this" }).length, 0)
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

  // Scores 10/20/30 and created_at 1000/2000/3000, so each ordering below has
  // exactly one correct answer.
  assert.deepEqual(
    listLeads({ orderBy: "score DESC" }).map((lead) => lead.id),
    [bravo.id, charlie.id, alpha.id]
  )
  assert.deepEqual(
    listLeads({ orderBy: "created_at ASC" }).map((lead) => lead.id),
    [alpha.id, bravo.id, charlie.id]
  )
  assert.deepEqual(
    listLeads({ orderBy: "created_at DESC" }).map((lead) => lead.id),
    [charlie.id, bravo.id, alpha.id]
  )
})

test("every ordering resolves ties by id, giving a total order to page over", () => {
  // Why this matters: a bulk Overpass import writes hundreds of leads inside
  // one millisecond, all with the starting score, so `created_at DESC` and
  // `score DESC` are massively tied. SQL leaves the order of tied rows
  // unspecified, and LIMIT/OFFSET paging over an unspecified order is free to
  // repeat and drop rows between pages.
  //
  // Asserting "page1 ++ page2 ++ page3 == unpaged" does NOT catch this: I
  // measured it, and SQLite's sorter happens to be stable for a plain table
  // scan at every size I tried, so that assertion holds with or without a
  // tiebreaker. What is actually falsifiable is the tiebreaker's own contract
  // — ties come back in `id` order — because rows are inserted with random
  // UUIDs, so insertion order and id order disagree. Remove `id` from
  // LEAD_ORDER_BY and this test fails; the paging assertion below does not.
  clearLeads()
  const ids: string[] = []
  for (let index = 0; index < 8; index++) {
    const lead = newLead({ name: `Tied ${index}` })
    updateLead(lead.id, { score: 7 })
    setCreatedAt(lead.id, 5_000)
    ids.push(lead.id)
  }

  const idsDesc = [...ids].sort().reverse()
  const idsAsc = [...ids].sort()

  assert.deepEqual(
    listLeads({ orderBy: "score DESC" }).map((lead) => lead.id),
    idsDesc
  )
  assert.deepEqual(
    listLeads({ orderBy: "created_at DESC" }).map((lead) => lead.id),
    idsDesc
  )
  // created_at ASC tiebreaks ascending, so the whole ordering flips.
  assert.deepEqual(
    listLeads({ orderBy: "created_at ASC" }).map((lead) => lead.id),
    idsAsc
  )

  // The property the total order buys: paging never repeats or drops a row.
  for (const orderBy of [
    "score DESC",
    "created_at DESC",
    "created_at ASC",
  ] as const) {
    const paged = [0, 3, 6].flatMap((offset) =>
      listLeads({ orderBy, limit: 3, offset }).map((lead) => lead.id)
    )
    assert.deepEqual(
      paged,
      listLeads({ orderBy }).map((lead) => lead.id),
      `paging diverged for "${orderBy}"`
    )
    assert.equal(new Set(paged).size, 8)
  }
})

test("limit and offset edge cases", () => {
  seedFilterFixtures()

  // offset without limit is legal — SQLite needs a LIMIT clause, which the
  // helper supplies as -1.
  assert.equal(listLeads({ offset: 1 }).length, 2)
  assert.equal(listLeads({ limit: 0 }).length, 0)
  assert.equal(listLeads({ offset: 99 }).length, 0)

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

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

test("a saved search result comes back byte-for-byte", () => {
  const json = JSON.stringify([
    { osmId: "node/1", name: "Kettle & Co", lat: 43.7, lng: -79.1 },
  ])
  const id = saveSearchResult(json)

  assert.equal(getSearchResult(id), json)
})

test("an unknown search id reads as a miss, not an exception", () => {
  assert.equal(getSearchResult(randomUUID()), undefined)
})

test("each save gets its own id", () => {
  const a = saveSearchResult("[]")
  const b = saveSearchResult("[]")

  assert.notEqual(a, b)
})

test(`only the newest ${SEARCH_RESULT_KEEP} searches are kept`, () => {
  getDb().exec("DELETE FROM searches")
  // One search over a large radius is ~1.6 MB of candidates, so an unbounded
  // table would grow the database by that much on every click of Search.
  const ids = Array.from({ length: SEARCH_RESULT_KEEP + 3 }, (_, i) =>
    saveSearchResult(JSON.stringify({ n: i }))
  )

  const dropped = ids.slice(0, 3)
  const kept = ids.slice(3)
  for (const id of dropped) {
    assert.equal(getSearchResult(id), undefined, `${id} should have aged out`)
  }
  for (const id of kept) {
    assert.ok(getSearchResult(id), `${id} should still be readable`)
  }
})

test("pruning never evicts the search just saved", () => {
  getDb().exec("DELETE FROM searches")
  // The import reads back the id the search handed out. If a prune could
  // race ahead of it, "Add" would fail on a result the user is looking at.
  for (let i = 0; i < SEARCH_RESULT_KEEP * 3; i++) {
    const id = saveSearchResult(JSON.stringify({ n: i }))
    assert.equal(getSearchResult(id), JSON.stringify({ n: i }))
  }
})

test("foreign keys are enforced on a connection that has finished migrating", () => {
  // Migrations run with enforcement OFF, because SQLite cannot alter a CHECK
  // constraint and rebuilding a table means dropping one that `messages`
  // references. That must be the only window: a connection handed to the app
  // with enforcement still off would let orphan rows in silently.
  assert.throws(
    () =>
      getDb()
        .prepare(
          `INSERT INTO messages (id, lead_id, direction, status, created_at)
           VALUES (?, 'no-such-lead', 'out', 'sent', 1)`
        )
        .run(randomUUID()),
    /FOREIGN KEY/i
  )
})
