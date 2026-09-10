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

import {
  contactPageUrls,
  enrichLead,
  deobfuscateEmailText,
  extractEncodedEmails,
  findLocations,
  MAX_CONTACT_PAGES,
  parseSitemapUrls,
} from "./leads.ts"
import { parseRobots } from "./leads.ts"
import { closeDb, getDb, getLeadById, insertLead, listCallList } from "./db.ts"

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

// ---------------------------------------------------------------------------
// Email indicators a plain text pass never sees
// ---------------------------------------------------------------------------

const CF = "2b434e4747446b58484a59494459445e4c434c524605484a"

test("a Cloudflare-obfuscated address is decoded", () => {
  // Cloudflare rewrites a real mailto into this and reassembles it in JS, so
  // the address is on the page for a visitor and invisible to us. It is one
  // of the most common ways a small business site hides its own address.
  const html = `<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${CF}">[email&#160;protected]</a>`

  const found = extractEncodedEmails(html, "https://scarboroughgym.ca/")

  assert.deepEqual(
    found.map((c) => c.email),
    ["hello@scarboroughgym.ca"]
  )
  assert.equal(found[0].origin, "encoded")
  assert.equal(found[0].foundOn, "https://scarboroughgym.ca/")
})

test("a malformed cfemail is skipped rather than yielding rubbish", () => {
  for (const bad of ["", "2b", "zz4344", "2b4"]) {
    const html = `<span class="__cf_email__" data-cfemail="${bad}"></span>`
    assert.deepEqual(extractEncodedEmails(html, "p"), [], `for "${bad}"`)
  }
})

test("an address in JSON-LD is found", () => {
  // htmlToText drops <script> contents wholesale, so structured data is
  // invisible to the text scan even though it is the single most reliable
  // place a business states its own address.
  const html = `<script type="application/ld+json">
    {"@type":"LocalBusiness","name":"Guildwood Storage","email":"info@guildwoodstorage.ca"}
  </script>`

  assert.deepEqual(
    extractEncodedEmails(html, "p").map((c) => c.email),
    ["info@guildwoodstorage.ca"]
  )
})

test("JSON-LD with a mailto: value still yields a bare address", () => {
  const html = `<script type="application/ld+json">{"email":"mailto:ops@ellesmere.ca"}</script>`

  assert.deepEqual(
    extractEncodedEmails(html, "p").map((c) => c.email),
    ["ops@ellesmere.ca"]
  )
})

test("a data-email attribute is found", () => {
  const html = `<button data-email="book@morningsideclinic.ca">Email us</button>`

  assert.deepEqual(
    extractEncodedEmails(html, "p").map((c) => c.email),
    ["book@morningsideclinic.ca"]
  )
})

test("encoded sources dedupe within a page", () => {
  const html =
    `<span class="__cf_email__" data-cfemail="${CF}"></span>` +
    `<b data-email="hello@scarboroughgym.ca"></b>`

  assert.equal(extractEncodedEmails(html, "p").length, 1)
})

test("a page with none of these yields nothing", () => {
  assert.deepEqual(
    extractEncodedEmails("<p>call us on 416-555-0100</p>", "p"),
    []
  )
})

test("spelled-out addresses are put back together", () => {
  // What a site writes when it is trying to dodge scrapers. A human reads
  // every one of these as an address.
  const cases: [string, string][] = [
    ["hello [at] gym [dot] ca", "hello@gym.ca"],
    ["hello (at) gym (dot) ca", "hello@gym.ca"],
    ["hello AT gym DOT ca", "hello@gym.ca"],
    ["hello&commat;gym.ca", "hello@gym.ca"],
    ["hello [at] gym.ca", "hello@gym.ca"],
  ]
  for (const [input, expected] of cases) {
    assert.match(
      deobfuscateEmailText(input),
      new RegExp(expected.replace(".", "\.")),
      `"${input}" should read as ${expected}`
    )
  }
})

test("deobfuscation leaves ordinary prose alone", () => {
  // "at" and "dot" are ordinary words; rewriting them mid-sentence would
  // manufacture addresses out of copy that never had one.
  const prose = "Open at 9. We are at the corner of Kingston and Morningside."
  assert.equal(deobfuscateEmailText(prose), prose)
})

// ---------------------------------------------------------------------------
// Finding the page the address is on
// ---------------------------------------------------------------------------

const BASE = new URL("https://guildwoodgym.ca/")

function link(href: string, text = "Link"): string {
  return `<a href="${href}">${text}</a>`
}

test("a contact link is found however the site spells the path", () => {
  // The old pattern was anchored to the site root, so every one of these —
  // all ordinary ways to build a site — was invisible.
  const paths = [
    "/contact",
    "/contact/",
    "/contact.html",
    "/contact.php",
    "/contact-us",
    "/contact_us",
    "/en/contact",
    "/pages/contact-us",
    "/about/team",
    "/get-in-touch",
    "/our-team",
    "/locations",
  ]
  for (const path of paths) {
    const found = contactPageUrls(link(path), BASE)
    assert.deepEqual(
      found,
      [new URL(path, BASE).href],
      `${path} should be worth a look`
    )
  }
})

test("a word merely containing 'contact' or 'about' is not a contact page", () => {
  // /contactlenses is an optician's product page, not a contact page. Matching
  // on substrings would spend the page budget on it.
  for (const path of ["/contactlenses", "/aboutbats", "/shop/teams-kit"]) {
    assert.deepEqual(contactPageUrls(link(path), BASE), [], path)
  }
})

test("a link is followed on its text when the path says nothing", () => {
  // Plenty of sites route through opaque ids. The visible label is the only
  // thing that says where the link goes.
  const html = link("/p/9f2c", "Contact Us") + link("/p/1a1a", "Email us")

  assert.deepEqual(contactPageUrls(html, BASE), [
    "https://guildwoodgym.ca/p/9f2c",
    "https://guildwoodgym.ca/p/1a1a",
  ])
})

test("contact pages outrank about pages", () => {
  // Both are worth fetching; only one usually carries the address, and the
  // page budget is spent in order.
  const html = link("/about") + link("/contact")

  assert.deepEqual(contactPageUrls(html, BASE), [
    "https://guildwoodgym.ca/contact",
    "https://guildwoodgym.ca/about",
  ])
})

test("off-site, mailto and duplicate links are left out", () => {
  const html =
    link("https://facebook.com/contact") +
    link("mailto:hi@guildwoodgym.ca") +
    link("/contact") +
    link("/contact#form") +
    link("/contact?utm_source=x")

  assert.deepEqual(contactPageUrls(html, BASE), [
    "https://guildwoodgym.ca/contact",
  ])
})

test(`no more than ${MAX_CONTACT_PAGES} pages are ever queued`, () => {
  const html = [
    "/contact",
    "/contact-us",
    "/about",
    "/about-us",
    "/team",
    "/staff",
    "/locations",
    "/support",
  ]
    .map((p) => link(p))
    .join("")

  assert.equal(contactPageUrls(html, BASE).length, MAX_CONTACT_PAGES)
})

test("robots.txt Sitemap: lines are collected", () => {
  const rules = parseRobots(
    [
      "User-agent: *",
      "Disallow: /admin",
      "Sitemap: https://guildwoodgym.ca/sitemap.xml",
      "sitemap: https://guildwoodgym.ca/sitemap-pages.xml",
    ].join("\n")
  )

  assert.deepEqual(rules.sitemaps, [
    "https://guildwoodgym.ca/sitemap.xml",
    "https://guildwoodgym.ca/sitemap-pages.xml",
  ])
  // The rest of robots.txt must still be understood.
  assert.equal(rules.allows("/admin"), false)
  assert.equal(rules.allows("/contact"), true)
})

test("a sitemap yields its urls", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://guildwoodgym.ca/</loc></url>
      <url><loc>https://guildwoodgym.ca/contact-us/</loc></url>
      <url><loc><![CDATA[https://guildwoodgym.ca/about]]></loc></url>
    </urlset>`

  assert.deepEqual(parseSitemapUrls(xml), [
    "https://guildwoodgym.ca/",
    "https://guildwoodgym.ca/contact-us/",
    "https://guildwoodgym.ca/about",
  ])
})

test("a sitemap index yields the sitemaps it points at", () => {
  const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://guildwoodgym.ca/sitemap-1.xml</loc></sitemap>
    </sitemapindex>`

  assert.deepEqual(parseSitemapUrls(xml), [
    "https://guildwoodgym.ca/sitemap-1.xml",
  ])
})

test("rubbish where a sitemap should be yields nothing, never a throw", () => {
  for (const junk of ["", "<html><body>404</body></html>", "not xml at all"]) {
    assert.deepEqual(parseSitemapUrls(junk), [], JSON.stringify(junk))
  }
})

// ---------------------------------------------------------------------------
// A business we cannot email but can phone
// ---------------------------------------------------------------------------

const forbiddenFetch: typeof fetch = async () => {
  throw new Error("no test may reach the network")
}

test("no website but a phone number makes a call, not a dead end", async () => {
  getDb().exec("DELETE FROM leads")
  const lead = insertLead({
    name: "Ellesmere Auto Repair",
    type: "car_repair",
    phone: "+1 416-555-0142",
    source: "osm",
    osmId: "node/900",
  })

  const outcome = await enrichLead(lead.id, { fetch: forbiddenFetch })

  assert.equal(outcome.status, "to_call")
  assert.equal(getLeadById(lead.id)?.status, "to_call")
})

test("no website and no phone is still a dead end", async () => {
  // Nothing to reach them by at all. Calling it "to call" would put a row on
  // the Calls page with no number on it.
  getDb().exec("DELETE FROM leads")
  const lead = insertLead({
    name: "Guildwood Storage",
    type: "storage",
    source: "osm",
    osmId: "node/901",
  })

  const outcome = await enrichLead(lead.id, { fetch: forbiddenFetch })

  assert.equal(outcome.status, "unqualified")
  assert.equal(getLeadById(lead.id)?.status, "unqualified")
})

test("a suppressed business is never phoned instead", async () => {
  // "Stop contacting me" is about being contacted, not about email, so it
  // must not be answered by picking up the phone.
  getDb().exec("DELETE FROM leads")
  const lead = insertLead({
    name: "Morningside Clinic",
    type: "clinic",
    phone: "+1 416-555-0199",
    source: "osm",
    osmId: "node/902",
  })
  getDb()
    .prepare(`UPDATE leads SET status = 'suppressed' WHERE id = ?`)
    .run(lead.id)

  const outcome = await enrichLead(lead.id, { fetch: forbiddenFetch })

  assert.equal(outcome.status, "unqualified")
})

test("a never-emailed lead reaches the call list with no hours since contact", () => {
  getDb().exec("DELETE FROM leads")
  const callable = insertLead({
    name: "Kingston Road Gym",
    type: "gym",
    phone: "+1 416-555-0110",
    source: "osm",
    osmId: "node/903",
  })
  getDb()
    .prepare(`UPDATE leads SET status = 'to_call' WHERE id = ?`)
    .run(callable.id)

  // Same status, no phone: there is nothing to ring, so it stays off the list.
  const unreachable = insertLead({
    name: "No Phone Storage",
    type: "storage",
    source: "osm",
    osmId: "node/904",
  })
  getDb()
    .prepare(`UPDATE leads SET status = 'to_call' WHERE id = ?`)
    .run(unreachable.id)

  const list = listCallList()

  assert.deepEqual(
    list.map((e) => e.lead.id),
    [callable.id]
  )
  assert.equal(list[0].lastContactedAt, null)
  assert.equal(list[0].hoursSinceContact, null)
})
