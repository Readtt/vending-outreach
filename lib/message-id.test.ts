/**
 * Tests for `confirmSentMessageIds`.
 *
 * The scenario being defended: nodemailer reports the Message-ID it generated,
 * but Gmail may replace it on submission. If it does, the day-4 follow-up sets
 * `In-Reply-To` to an ID that never existed — the follow-up does not thread and
 * a bounce quoting the real ID cannot be matched back to the lead. Neither
 * failure raises an error anywhere, which is what makes it worth testing rather
 * than assuming.
 *
 * INVARIANT FOR THIS FILE: throwaway database, and no socket is ever opened —
 * the searcher is a stub.
 */

import { test, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vending-msgid-test-"))
process.env.VENDING_DB_PATH = path.join(TMP_ROOT, "app.db")

import {
  closeDb,
  getDb,
  insertLead,
  listRecentEvents,
  upsertMailbox,
  type MailboxRow,
} from "./db.ts"
import {
  confirmSentMessageIds,
  type SentMailHit,
  type SentMailSearcher,
} from "./mail-send.ts"

assert.ok(
  process.env.VENDING_DB_PATH?.includes("vending-msgid-test-"),
  "refusing to run: the tests are not pointed at a throwaway database"
)

after(() => {
  closeDb()
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true })
  } catch {
    // Windows keeps a handle on the db file briefly; a leftover temp dir is
    // the OS's problem, not this test's.
  }
})

const NOW = Date.UTC(2026, 8, 9, 15, 0, 0)
const HOUR = 3600_000

let mailbox: MailboxRow
let counter = 0

beforeEach(() => {
  const db = getDb()
  db.exec("DELETE FROM messages")
  db.exec("DELETE FROM events")
  db.exec("DELETE FROM leads")
  counter++
  mailbox = upsertMailbox({
    email: `sender${counter}@gmail.com`,
    appPassword: "abcd efgh ijkl mnop",
    dailyCap: 25,
  })
})

interface Sent {
  rowId: string
  outreachId: string
  leadId: string
}

function seedSent(
  overrides: {
    localMessageId?: string | null
    gmThrid?: string | null
    sentAt?: number
    dryRun?: number
    status?: string
  } = {}
): Sent {
  const lead = insertLead({
    name: "Joe's Gym",
    type: "gym",
    source: "test",
    osmId: `node/${randomUUID()}`,
  })
  const rowId = randomUUID()
  const outreachId = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO messages
         (id, lead_id, mailbox_id, direction, sequence_step, subject, body,
          outreach_id, message_id, gm_thrid, status, sent_at, created_at, dry_run)
       VALUES (?, ?, ?, 'out', 1, 'Quick question', 'body', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      rowId,
      lead.id,
      mailbox.id,
      outreachId,
      overrides.localMessageId === undefined
        ? "<local-generated@vendco.example>"
        : overrides.localMessageId,
      overrides.gmThrid ?? null,
      overrides.status ?? "sent",
      overrides.sentAt ?? NOW - HOUR,
      overrides.sentAt ?? NOW - HOUR,
      overrides.dryRun ?? 0
    )
  return { rowId, outreachId, leadId: lead.id }
}

function readRow(rowId: string): {
  message_id: string | null
  gm_thrid: string | null
} {
  return getDb()
    .prepare(`SELECT message_id, gm_thrid FROM messages WHERE id = ?`)
    .get(rowId) as { message_id: string | null; gm_thrid: string | null }
}

/** A searcher that returns whatever Gmail "stored", with no socket. */
function stubSearcher(
  stored: Record<string, { messageId: string | null; gmThrid?: string | null }>
): SentMailSearcher & { batchCalls: number } {
  const searcher = {
    batchCalls: 0,
    async find(
      _m: MailboxRow,
      outreachId: string
    ): Promise<SentMailHit | null> {
      const hit = stored[outreachId]
      if (!hit) return null
      return {
        outreachId,
        messageId: hit.messageId,
        gmThrid: hit.gmThrid ?? "thr-1",
        uid: 1,
        internalDate: NOW,
      }
    },
    async findMany(
      _m: MailboxRow,
      ids: readonly string[]
    ): Promise<Map<string, SentMailHit>> {
      searcher.batchCalls++
      const out = new Map<string, SentMailHit>()
      for (const id of ids) {
        const hit = stored[id]
        if (!hit) continue
        out.set(id, {
          outreachId: id,
          messageId: hit.messageId,
          gmThrid: hit.gmThrid ?? "thr-1",
          uid: 1,
          internalDate: NOW,
        })
      }
      return out
    },
  }
  return searcher
}

// ---------------------------------------------------------------------------

test("a rewritten Message-ID is replaced with the one Gmail actually stored", async () => {
  const sent = seedSent()
  const searcher = stubSearcher({
    [sent.outreachId]: {
      messageId: "<CAF=abc123@mail.gmail.com>",
      gmThrid: "thr-99",
    },
  })

  const result = await confirmSentMessageIds(mailbox, {
    searcher,
    now: () => NOW,
  })

  assert.equal(result.checked, 1)
  assert.equal(result.confirmed, 1)
  assert.equal(
    result.rewritten,
    1,
    "Gmail changed it, so that must be recorded"
  )

  const row = readRow(sent.rowId)
  assert.equal(row.message_id, "<CAF=abc123@mail.gmail.com>")
  assert.equal(row.gm_thrid, "thr-99")

  // The rewrite is logged, so the question "does Gmail actually do this?" gets
  // answered from real traffic rather than assumed either way.
  const events = listRecentEvents(10, { types: ["send.message_id_rewritten"] })
  assert.equal(events.length, 1)
  const detail = JSON.parse(events[0].detail_json ?? "{}")
  assert.equal(detail.submitted, "<local-generated@vendco.example>")
  assert.equal(detail.stored, "<CAF=abc123@mail.gmail.com>")
})

test("an unchanged Message-ID is confirmed without being reported as rewritten", async () => {
  const sent = seedSent({ localMessageId: "<same@vendco.example>" })
  const searcher = stubSearcher({
    [sent.outreachId]: { messageId: "<same@vendco.example>" },
  })

  const result = await confirmSentMessageIds(mailbox, {
    searcher,
    now: () => NOW,
  })

  assert.equal(result.confirmed, 1)
  assert.equal(result.rewritten, 0, "Gmail preserved it — nothing to report")
  assert.equal(readRow(sent.rowId).gm_thrid, "thr-1", "still marked confirmed")
})

test("a confirmed row is never re-checked", async () => {
  seedSent({ gmThrid: "thr-already" })
  const searcher = stubSearcher({})
  const result = await confirmSentMessageIds(mailbox, {
    searcher,
    now: () => NOW,
  })
  assert.equal(result.checked, 0)
  assert.equal(searcher.batchCalls, 0, "no IMAP work when there is none to do")
})

test("rehearsals and unsent rows are ignored", async () => {
  seedSent({ dryRun: 1 })
  seedSent({ status: "sending" })
  const result = await confirmSentMessageIds(mailbox, {
    searcher: stubSearcher({}),
    now: () => NOW,
  })
  assert.equal(result.checked, 0)
})

test("a row not found in Sent Mail stays unconfirmed for the next pass", async () => {
  const sent = seedSent()
  const result = await confirmSentMessageIds(mailbox, {
    searcher: stubSearcher({}),
    now: () => NOW,
  })
  assert.equal(result.checked, 1)
  assert.equal(result.confirmed, 0)
  assert.equal(
    readRow(sent.rowId).gm_thrid,
    null,
    "gm_thrid is the confirmed marker — it must stay null so this is retried"
  )
})

test("a hit with no readable Message-ID is not treated as an answer", async () => {
  const sent = seedSent()
  const result = await confirmSentMessageIds(mailbox, {
    searcher: stubSearcher({ [sent.outreachId]: { messageId: null } }),
    now: () => NOW,
  })
  assert.equal(result.incomplete, 1)
  assert.equal(result.confirmed, 0)
  assert.equal(
    readRow(sent.rowId).gm_thrid,
    null,
    "a non-answer must not be recorded as final"
  )
})

test("sends older than the window are left alone", async () => {
  seedSent({ sentAt: NOW - 10 * 24 * HOUR })
  const result = await confirmSentMessageIds(mailbox, {
    searcher: stubSearcher({}),
    now: () => NOW,
  })
  assert.equal(result.checked, 0, "beyond the searcher's own scan window")
})

test("the whole batch goes over one connection", async () => {
  const sent = [seedSent(), seedSent(), seedSent()]
  const stored: Record<string, { messageId: string }> = {}
  for (const [i, s] of sent.entries()) {
    stored[s.outreachId] = { messageId: `<real-${i}@mail.gmail.com>` }
  }
  const searcher = stubSearcher(stored)

  const result = await confirmSentMessageIds(mailbox, {
    searcher,
    now: () => NOW,
  })

  assert.equal(result.confirmed, 3)
  // One login for the batch, not one per message: a login per message is how
  // an account earns `454 4.7.0 Too many login attempts`.
  assert.equal(searcher.batchCalls, 1)
})

test("another mailbox's sends are not touched", async () => {
  const sent = seedSent()
  const other = upsertMailbox({
    email: "someone-else@gmail.com",
    appPassword: "abcd efgh ijkl mnop",
    dailyCap: 25,
  })
  const result = await confirmSentMessageIds(other, {
    searcher: stubSearcher({
      [sent.outreachId]: { messageId: "<wrong@mail.gmail.com>" },
    }),
    now: () => NOW,
  })
  assert.equal(result.checked, 0)
  assert.equal(
    readRow(sent.rowId).message_id,
    "<local-generated@vendco.example>"
  )
})
