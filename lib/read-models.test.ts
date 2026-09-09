/**
 * Tests for the UI read models in `lib/db.ts`.
 *
 * These are hand-written SQL against a schema that several agents edited, so
 * they are exercised against a real database rather than trusted to typecheck.
 *
 * INVARIANT FOR THIS FILE: every test runs against a throwaway database in the
 * OS temp directory, never the user's live outreach data.
 */

import { test, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-readmodel-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")

import {
  closeDb,
  dashboardStats,
  getDb,
  insertLead,
  listCallList,
  listInboxThreads,
  listMessagesForLead,
  listRecentEvents,
  logEvent,
  updateLead,
  type LeadStatus,
} from "./db.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-readmodel-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

after(() => {
  closeDb()
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

const NOW = Date.UTC(2026, 8, 9, 15, 0, 0)
const HOUR = 3600_000

beforeEach(() => {
  const db = getDb()
  for (const t of ["messages", "events", "tasks", "leads"]) {
    db.exec(`DELETE FROM ${t}`)
  }
})

function seedLead(
  overrides: { status?: LeadStatus; phone?: string | null; name?: string } = {}
): string {
  const row = insertLead({
    name: overrides.name ?? "Joe's Gym",
    type: "fitness_centre",
    phone: overrides.phone === undefined ? "+1 614 555 0100" : overrides.phone,
    source: "test",
    osmId: `node/${randomUUID()}`,
  })
  // `email` is not an insert field — leads arrive from OSM without one and get
  // an address later, during enrichment.
  updateLead(row.id, {
    email: "info@joesgym.com",
    ...(overrides.status ? { status: overrides.status } : {}),
  })
  return row.id
}

function insertMessage(
  leadId: string,
  fields: {
    direction: "in" | "out"
    sentAt: number
    step?: number | null
    status?: string
    dryRun?: number
    error?: string | null
    body?: string
  }
): string {
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO messages
         (id, lead_id, direction, sequence_step, subject, body, outreach_id,
          status, error, sent_at, created_at, dry_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      leadId,
      fields.direction,
      fields.step ?? null,
      "Quick question",
      fields.body ?? "body",
      randomUUID(),
      fields.status ?? "sent",
      fields.error ?? null,
      fields.sentAt,
      fields.sentAt,
      fields.dryRun ?? 0
    )
  return id
}

// ---------------------------------------------------------------------------
// listMessagesForLead
// ---------------------------------------------------------------------------

test("listMessagesForLead returns the thread oldest first", () => {
  const lead = seedLead()
  insertMessage(lead, { direction: "out", sentAt: NOW - 2 * HOUR, step: 1 })
  insertMessage(lead, { direction: "in", sentAt: NOW - HOUR })
  const thread = listMessagesForLead(lead)
  assert.equal(thread.length, 2)
  assert.equal(thread[0].direction, "out")
  assert.equal(thread[1].direction, "in")
})

test("listMessagesForLead does not leak another lead's thread", () => {
  const a = seedLead()
  const b = seedLead({ name: "Other Co" })
  insertMessage(a, { direction: "out", sentAt: NOW, step: 1 })
  insertMessage(b, { direction: "out", sentAt: NOW, step: 1 })
  assert.equal(listMessagesForLead(a).length, 1)
})

// ---------------------------------------------------------------------------
// listRecentEvents
// ---------------------------------------------------------------------------

test("listRecentEvents returns newest first and honours the type filter", () => {
  const lead = seedLead()
  logEvent("compose.drafted", { leadId: lead })
  logEvent("inbound.bounce", { leadId: lead, detail: { hard: true } })
  const all = listRecentEvents(10)
  assert.ok(all.length >= 2)
  const bounces = listRecentEvents(10, { types: ["inbound.bounce"] })
  assert.equal(bounces.length, 1)
  assert.equal(bounces[0].type, "inbound.bounce")
})

// ---------------------------------------------------------------------------
// listInboxThreads — only `hot` reaches a human (spec §3)
// ---------------------------------------------------------------------------

test("listInboxThreads surfaces hot leads with their latest inbound", () => {
  const hot = seedLead({ status: "hot", name: "Ready To Talk LLC" })
  insertMessage(hot, { direction: "out", sentAt: NOW - 3 * HOUR, step: 1 })
  insertMessage(hot, {
    direction: "in",
    sentAt: NOW - HOUR,
    body: "call me tomorrow",
  })
  const threads = listInboxThreads()
  assert.equal(threads.length, 1)
  assert.equal(threads[0].lead.id, hot)
  assert.equal(threads[0].messageCount, 2)
  assert.equal(threads[0].latestInbound?.body, "call me tomorrow")
})

test("listInboxThreads excludes everything the bot disposed of itself", () => {
  for (const status of ["contacted", "dead", "suppressed", "unqualified"] as const) {
    seedLead({ status, name: status })
  }
  assert.equal(listInboxThreads().length, 0)
})

// ---------------------------------------------------------------------------
// listCallList
// ---------------------------------------------------------------------------

test("listCallList includes a contacted lead inside the 18-96h window", () => {
  const lead = seedLead({ status: "contacted" })
  insertMessage(lead, { direction: "out", sentAt: NOW - 24 * HOUR, step: 1 })
  const calls = listCallList(NOW)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].lead.id, lead)
  assert.equal(calls[0].hoursSinceContact, 24)
})

test("listCallList excludes a lead contacted too recently to be worth calling", () => {
  const lead = seedLead({ status: "contacted" })
  insertMessage(lead, { direction: "out", sentAt: NOW - 2 * HOUR, step: 1 })
  assert.equal(listCallList(NOW).length, 0)
})

test("listCallList excludes a lead that already replied", () => {
  const lead = seedLead({ status: "replied" })
  insertMessage(lead, { direction: "out", sentAt: NOW - 24 * HOUR, step: 1 })
  insertMessage(lead, { direction: "in", sentAt: NOW - 12 * HOUR })
  assert.equal(listCallList(NOW).length, 0)
})

test("listCallList excludes a lead with no phone number", () => {
  const lead = seedLead({ status: "contacted", phone: null })
  insertMessage(lead, { direction: "out", sentAt: NOW - 24 * HOUR, step: 1 })
  assert.equal(listCallList(NOW).length, 0)
})

test("listCallList ignores an unsent draft", () => {
  const lead = seedLead({ status: "contacted" })
  insertMessage(lead, {
    direction: "out",
    sentAt: NOW - 24 * HOUR,
    step: 1,
    status: "sending",
  })
  assert.equal(listCallList(NOW).length, 0)
})

// ---------------------------------------------------------------------------
// dashboardStats
// ---------------------------------------------------------------------------

test("dashboardStats separates real sends from rehearsals", () => {
  const lead = seedLead({ status: "contacted" })
  const dayStart = NOW - 15 * HOUR
  insertMessage(lead, { direction: "out", sentAt: NOW - HOUR, step: 1 })
  insertMessage(lead, { direction: "out", sentAt: NOW - HOUR, step: 2, dryRun: 1 })
  const stats = dashboardStats(dayStart, NOW)
  assert.equal(stats.sentToday, 1)
  assert.equal(stats.dryRunToday, 1)
})

test("dashboardStats counts inbound replies in the last 7 days only", () => {
  const lead = seedLead()
  insertMessage(lead, { direction: "in", sentAt: NOW - 2 * 24 * HOUR })
  insertMessage(lead, { direction: "in", sentAt: NOW - 30 * 24 * HOUR })
  assert.equal(dashboardStats(NOW - HOUR, NOW).repliesLast7d, 1)
})

test("dashboardStats reports no bounce rate until there is enough history", () => {
  const lead = seedLead()
  for (let i = 0; i < 5; i++) {
    insertMessage(lead, { direction: "out", sentAt: NOW - i * HOUR, step: i + 1 })
  }
  assert.equal(dashboardStats(NOW - 24 * HOUR, NOW).hardBounceRateLast50, null)
})

test("dashboardStats computes the hard bounce rate off the message rows", () => {
  const lead = seedLead()
  for (let i = 0; i < 20; i++) {
    insertMessage(lead, {
      direction: "out",
      sentAt: NOW - i * HOUR,
      step: i + 1,
      // markBounce writes this shape onto the send that bounced.
      error: i < 4 ? JSON.stringify({ bounce: "hard" }) : null,
    })
  }
  const stats = dashboardStats(NOW - 48 * HOUR, NOW)
  assert.equal(stats.hardBounceRateLast50, 0.2)
})

test("dashboardStats counts hot and ready leads by status", () => {
  seedLead({ status: "hot", name: "a" })
  seedLead({ status: "hot", name: "b" })
  seedLead({ status: "ready", name: "c" })
  const stats = dashboardStats(NOW - HOUR, NOW)
  assert.equal(stats.hotLeads, 2)
  assert.equal(stats.readyToSend, 1)
  assert.equal(stats.totalLeads, 3)
})
