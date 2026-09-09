/**
 * Tests for lead sourcing.
 *
 * INVARIANT FOR THIS FILE: no test may reach Overpass, Nominatim, or DNS, and
 * none may touch the user's live outreach data. Every fetching function takes
 * `deps.fetch` and every test supplies one.
 */

import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// The database path must be redirected BEFORE anything calls getDb():
// `findLocations` dedupes against the leads table and caches through
// `http_cache`, and a stray real database would write test rows into live data.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-leads-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")

import { findLocations } from "./leads.ts"
import { closeDb, getDb, insertLead } from "./db.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-leads-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

after(() => {
  closeDb()
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const US = ["US"] as const

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

let clock = Date.parse("2025-03-11T14:00:00Z")

/** Replays a queue of responses; a request past the end is a test bug. */
function stubFetch(responses: readonly Response[]): typeof fetch {
  const queue = [...responses]
  return async (input) => {
    const next = queue.shift()
    if (!next) throw new Error(`unexpected request to ${String(input)}`)
    return next
  }
}

function deps(fetchFn: typeof fetch) {
  return {
    fetch: fetchFn,
    now: () => {
      clock += 5000
      return clock
    },
    sleep: async () => {},
  }
}

/** Nominatim's answer for a place, at a caller-chosen point. */
function geocoded(displayName: string, lat: number, lng: number): Response {
  return jsonResponse([
    {
      lat: String(lat),
      lon: String(lng),
      display_name: displayName,
      boundingbox: [
        String(lat - 0.1),
        String(lat + 0.1),
        String(lng - 0.1),
        String(lng + 0.1),
      ],
    },
  ])
}

function storageUnit(
  type: "node" | "way",
  id: number,
  name: string,
  lat: number,
  lng: number
): Record<string, unknown> {
  return {
    type,
    id,
    ...(type === "way" ? { center: { lat, lon: lng } } : { lat, lon: lng }),
    tags: { name, shop: "storage_rental" },
  }
}

// ---------------------------------------------------------------------------
// findLocations — the counts the dialog reports
// ---------------------------------------------------------------------------

test("a node and a way for one business count as one business found", async () => {
  // Overpass returns both the point and the polygon centre for a business
  // that is mapped twice. `totalFound` counts elements, so it says 3 where a
  // person would say 2 — and the dialog subtracted the two numbers and told
  // the user the difference was businesses they already had.
  const result = await findLocations(
    {
      place: "Dublin, OH",
      radiusMiles: 5,
      types: ["storage"],
      countries: US,
    },
    deps(
      stubFetch([
        geocoded("Dublin, Franklin County, Ohio", 40.0992, -83.1141),
        jsonResponse({
          elements: [
            storageUnit("node", 1, "Scioto Self Storage", 40.0992, -83.1141),
            storageUnit("way", 2, "Scioto Self Storage", 40.0992, -83.1141),
            storageUnit("node", 3, "Bridge Street Storage", 40.1, -83.12),
          ],
        }),
      ])
    )
  )

  assert.equal(result.totalFound, 3, "elements Overpass returned")
  assert.equal(result.distinctFound, 2, "businesses, once deduped")
  assert.equal(result.newCount, 2)
})

test("with an empty leads table, nothing may be reported as already had", async () => {
  // The bug the user hit: "Found 7435 … Of those, 7373 are new to you" on a
  // Leads page holding zero businesses. Whatever the element count says, a
  // business cannot already be on a list that is empty.
  getDb().exec("DELETE FROM leads")

  const result = await findLocations(
    {
      place: "Westerville, OH",
      radiusMiles: 5,
      types: ["storage"],
      countries: US,
    },
    deps(
      stubFetch([
        geocoded("Westerville, Franklin County, Ohio", 40.126, -82.929),
        jsonResponse({
          elements: [
            storageUnit("node", 10, "Cleveland Ave Storage", 40.126, -82.929),
            storageUnit("way", 11, "Cleveland Ave Storage", 40.126, -82.929),
          ],
        }),
      ])
    )
  )

  assert.equal(
    result.distinctFound,
    result.newCount,
    "no lead exists, so every business found is new"
  )
})

test("a business already imported is the one thing that is not new", async () => {
  getDb().exec("DELETE FROM leads")
  insertLead({
    name: "Olde Towne Storage",
    type: "storage",
    source: "osm",
    osmId: "node/20",
  })

  const result = await findLocations(
    {
      place: "Gahanna, OH",
      radiusMiles: 5,
      types: ["storage"],
      countries: US,
    },
    deps(
      stubFetch([
        geocoded("Gahanna, Franklin County, Ohio", 40.019, -82.879),
        jsonResponse({
          elements: [
            storageUnit("node", 20, "Olde Towne Storage", 40.019, -82.879),
            storageUnit("node", 21, "Big Walnut Storage", 40.02, -82.88),
          ],
        }),
      ])
    )
  )

  assert.equal(result.totalFound, 2)
  assert.equal(result.distinctFound, 2)
  assert.equal(result.newCount, 1, "one of the two is already a lead")
})
