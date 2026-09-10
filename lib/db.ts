/**
 * The single point of access to the application's SQLite database.
 *
 * No other module may construct a `DatabaseSync`. Every other layer (worker,
 * mail, AI, UI server actions/routes) goes through the exported helpers here,
 * or through `getDb()` for anything not covered by a helper.
 */

import { DatabaseSync } from "node:sqlite"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { countryForPoint, type Country } from "./geo.ts"
import { dataDir, describeSyncRisk } from "./paths.ts"

// ---------------------------------------------------------------------------
// Path resolution — everything this app writes stays under the project folder
// ---------------------------------------------------------------------------

let syncWarningShown = false

/**
 * Warns once per process when the database sits in a folder a cloud client
 * syncs. Deliberately not an exception: refusing to start would mean this app
 * cannot live in Documents on a machine where Documents is OneDrive, which is
 * the default on Windows and not something a user of this app chose.
 */
function warnIfSynced(dbPath: string): void {
  if (syncWarningShown) return
  const vendor = describeSyncRisk(dbPath)
  if (!vendor) return
  syncWarningShown = true
  console.warn(
    [
      "",
      `  Heads up: your data lives in a folder ${vendor} is syncing.`,
      `    ${dbPath}`,
      "  A database is three files that have to stay in step (app.db plus a",
      "  -wal and a -shm sidecar), and a sync client copies them one at a",
      "  time, so a sync landing mid-write can leave them disagreeing.",
      "  Two ways out, either is fine:",
      `    - Exclude the "data" folder in ${vendor}'s settings.`,
      "    - Or point VENDING_DB_PATH at somewhere unsynced, for example",
      "      VENDING_DB_PATH=C:/vending-outreach/app.db",
      "",
    ].join("\n")
  )
}

/**
 * The database file. Defaults to `data/app.db` inside the project folder, so
 * one folder holds the code and everything it produces. `VENDING_DB_PATH`
 * overrides it — that is what the tests use, and what to reach for if the
 * project folder is being synced.
 */
export function resolveDbPath(): string {
  const override = process.env.VENDING_DB_PATH?.trim()
  const dbPath = override
    ? path.resolve(override)
    : path.join(dataDir(), "app.db")

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  warnIfSynced(dbPath)
  return dbPath
}

// ---------------------------------------------------------------------------
// Migrations — user_version-based, no external library
// ---------------------------------------------------------------------------

type Migration = (db: DatabaseSync) => void

const migrations: Migration[] = [
  // Migration 1: initial schema.
  (db) => {
    db.exec(`
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE providers (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('anthropic','google','openai_compatible')),
        label      TEXT,
        api_key    TEXT,
        base_url   TEXT,
        created_at INTEGER
      );

      CREATE TABLE mailboxes (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        app_password  TEXT NOT NULL,
        daily_cap     INTEGER DEFAULT 25,
        status        TEXT DEFAULT 'active',
        last_error    TEXT,
        last_poll_at  INTEGER,
        uidvalidity   INTEGER,
        last_uid      INTEGER,
        watermark_at  INTEGER,
        created_at    INTEGER
      );

      CREATE TABLE leads (
        id                    TEXT PRIMARY KEY,
        name                  TEXT,
        type                  TEXT,
        address               TEXT,
        phone                 TEXT,
        website               TEXT,
        lat                   REAL,
        lng                   REAL,
        timezone              TEXT,
        email                 TEXT,
        contact_name          TEXT,
        status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                                 'new','enriching','ready','held','contacted',
                                 'replied','hot','won','dead','unqualified','suppressed'
                               )),
        score                 INTEGER DEFAULT 0,
        research_json         TEXT,
        personalization_fact  TEXT,
        fact_category         TEXT,
        source                TEXT,
        osm_id                TEXT UNIQUE,
        created_at            INTEGER
      );

      CREATE TABLE messages (
        id             TEXT PRIMARY KEY,
        lead_id        TEXT NOT NULL REFERENCES leads(id),
        mailbox_id     TEXT,
        direction      TEXT NOT NULL CHECK (direction IN ('in','out')),
        sequence_step  INTEGER,
        subject        TEXT,
        body           TEXT,
        outreach_id    TEXT UNIQUE,
        message_id     TEXT,
        gm_thrid       TEXT,
        in_reply_to    TEXT,
        refs           TEXT,
        status         TEXT NOT NULL,
        error          TEXT,
        sent_at        INTEGER,
        created_at     INTEGER
      );

      -- Structural guarantee (spec §0.4): a lead can never receive the same
      -- outbound sequence step twice.
      CREATE UNIQUE INDEX ux_msg_step ON messages(lead_id, sequence_step)
        WHERE direction = 'out' AND sequence_step IS NOT NULL;

      CREATE TABLE tasks (
        id            TEXT PRIMARY KEY,
        lead_id       TEXT,
        kind          TEXT NOT NULL,
        run_after     INTEGER NOT NULL,
        lease_until   INTEGER,
        worker_id     TEXT,
        attempts      INTEGER DEFAULT 0,
        last_error    TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        payload_json  TEXT,
        created_at    INTEGER
      );

      CREATE INDEX ix_tasks_status_run_after ON tasks(status, run_after);

      CREATE TABLE events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id     TEXT,
        type        TEXT NOT NULL,
        detail_json TEXT,
        created_at  INTEGER
      );

      CREATE TABLE suppressed (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        email      TEXT,
        domain     TEXT,
        reason     TEXT,
        created_at INTEGER
      );

      -- SQLite treats every NULL as distinct for uniqueness purposes, so
      -- these indexes enforce "at most one row per non-null value" while
      -- still allowing many rows where email (or domain) is NULL.
      CREATE UNIQUE INDEX ux_suppressed_email ON suppressed(email);
      CREATE UNIQUE INDEX ux_suppressed_domain ON suppressed(domain);

      CREATE TABLE singleton_lock (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        owner_pid     INTEGER,
        heartbeat_at  INTEGER
      );
    `)
  },
  // Migration 2: HTTP response cache for lib/osm.ts (Overpass + Nominatim).
  // Both are donated/free capacity with strict usage policies (Overpass:
  // concurrency 1; Nominatim: 1 req/sec) — caching aggressively is part of
  // being a good citizen, not just a performance nicety. One generic table
  // rather than one per API: same shape, same TTL semantics, and it leaves
  // room for a future caller (e.g. robots.txt) without another migration.
  (db) => {
    db.exec(`
      CREATE TABLE http_cache (
        cache_key      TEXT PRIMARY KEY,
        kind           TEXT NOT NULL,
        response_json  TEXT NOT NULL,
        fetched_at     INTEGER NOT NULL
      );

      CREATE INDEX ix_http_cache_kind ON http_cache(kind);
    `)
  },
  // Migration 3: mark dry-run sends structurally instead of by a marker
  // stuffed into `error`, and split the uniqueness guarantee in two.
  //
  // `ux_msg_step` (spec §0.4) is what stops a lead receiving the same sequence
  // step twice. A dry run also writes a row, so under the old single index
  // every lead that was dry-run was permanently blocked from ever receiving
  // that real email — dry-running the first 200 leads silently burned them.
  //
  // Two partial indexes rather than one, over disjoint row sets:
  //   - dry run no longer blocks the real send of that step (the bug), but
  //   - a rehearsal still dedupes against other rehearsals, so a repeated
  //     dry run reports `duplicate` exactly as a repeated real send does.
  //
  // That second half is load-bearing for `countSentToday`, which counts
  // dry-run rows on purpose (spec §7) so a rehearsal exercises the daily cap
  // and warm-up ramp faithfully. With nothing bounding dry-run rows, a
  // repeated rehearsal would *over*-consume the cap without limit and the
  // model would stop being faithful in the opposite direction.
  //
  // The backfill is what makes this migration safe to run on a database that
  // predates it: rows written before the column existed carry the old
  // `{"dryRun":true}` marker in `error` and would otherwise be stamped as real
  // sends by the NOT NULL DEFAULT 0 — still blocking their lead's real send,
  // and now invisible to both `countDryRunMessages` and `clearDryRunMessages`,
  // which key off the column. That would leave the affected rows with no
  // remediation at all.
  (db) => {
    db.exec(`
      ALTER TABLE messages ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0;

      UPDATE messages SET dry_run = 1
        WHERE direction = 'out' AND error LIKE '%"dryRun":true%';

      DROP INDEX ux_msg_step;

      CREATE UNIQUE INDEX ux_msg_step ON messages(lead_id, sequence_step)
        WHERE direction = 'out' AND sequence_step IS NOT NULL AND dry_run = 0;

      CREATE UNIQUE INDEX ux_msg_step_dryrun ON messages(lead_id, sequence_step)
        WHERE direction = 'out' AND sequence_step IS NOT NULL AND dry_run = 1;
    `)
  },
  // Migration 4: record which country each lead is in.
  //
  // Not cosmetic. The country decides which law the email is written to
  // satisfy — CAN-SPAM in the US, CASL in Canada — and CASL wants a phone or
  // website next to the postal address that CAN-SPAM is happy without. It
  // also decides which public holidays the send window skips, and which
  // implied-consent rule applies to the address itself. None of that can be
  // re-derived at send time from a lead row that only has an address string.
  //
  // Existing rows are backfilled from their coordinates where the bounding
  // strips can answer. Rows the strips cannot place stay NULL, which
  // `lib/leads.ts` reads as "assume Canada" — the stricter of the two.
  (db) => {
    db.exec(`
      ALTER TABLE leads ADD COLUMN country TEXT
        CHECK (country IN ('US','CA'));
    `)

    const rows = db
      .prepare(
        `SELECT id, lat, lng FROM leads
          WHERE country IS NULL AND lat IS NOT NULL AND lng IS NOT NULL`
      )
      .all() as unknown as { id: string; lat: number; lng: number }[]

    const update = db.prepare(`UPDATE leads SET country = ? WHERE id = ?`)
    for (const row of rows) {
      const country = countryForPoint(row.lat, row.lng)
      if (country) update.run(country, row.id)
    }
  },
  // Migration 5: park a search's candidates here instead of sending them to
  // the browser and back.
  //
  // The Leads dialog runs in two steps — search, then Add — so the candidate
  // list has to survive between two requests. It used to survive in React
  // state, which meant the whole list was serialized down to the browser and
  // posted back up again on Add. A 20-mile search around Toronto is 7,435
  // candidates and 1.62 MB, and Next.js caps a server action body at 1 MB, so
  // Add answered "Body exceeded 1 MB limit" and imported nothing. The browser
  // never showed a single one of those candidates — it renders two counts —
  // so the round trip bought nothing at any size.
  //
  // Not `http_cache`, despite the near-identical shape: that table caches
  // *responses from an HTTP API*, keyed by the request that produced them and
  // read back by whoever repeats that request. These rows are keyed by an
  // opaque handle that only the browser holds, and are evicted by count
  // rather than by age, because one row here is bigger than everything in
  // that table put together.
  (db) => {
    db.exec(`
      CREATE TABLE searches (
        id           TEXT PRIMARY KEY,
        result_json  TEXT NOT NULL,
        created_at   INTEGER NOT NULL
      );
    `)
  },
  // Migration 6: a business we cannot email but can phone is a lead, not a
  // dead end.
  //
  // Roughly 78% of what a search finds has no email address anywhere — no
  // website to scrape and no `contact:email` tag — and all of it was landing
  // as `unqualified`, which the Leads page says in red as "Not a fit". Around
  // one in nine of those does have a phone number, and the Calls page already
  // knows how to work a lead with nothing but a name and a number: its script
  // prompt is fact-agnostic by design.
  //
  // `to_call` sits where `ready` sits — a lead waiting on an action, but a
  // call rather than an email. The four call outcomes already map onto
  // `replied`/`contacted`/`dead`/`hot`, so nothing downstream needs teaching.
  //
  // The table is rebuilt because SQLite cannot alter a CHECK constraint. The
  // column list is spelled out rather than `SELECT *` so a future column
  // added ahead of this migration cannot silently shift into the wrong slot,
  // and enforcement of the `messages` foreign key is off for the whole of
  // `migrate` (see `openDatabase`), which is what lets the old table go.
  (db) => {
    db.exec(`
      CREATE TABLE leads_new (
        id                    TEXT PRIMARY KEY,
        name                  TEXT,
        type                  TEXT,
        address               TEXT,
        phone                 TEXT,
        website               TEXT,
        lat                   REAL,
        lng                   REAL,
        timezone              TEXT,
        email                 TEXT,
        contact_name          TEXT,
        status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                                 'new','enriching','ready','held','to_call',
                                 'contacted','replied','hot','won','dead',
                                 'unqualified','suppressed'
                               )),
        score                 INTEGER DEFAULT 0,
        research_json         TEXT,
        personalization_fact  TEXT,
        fact_category         TEXT,
        source                TEXT,
        osm_id                TEXT UNIQUE,
        created_at            INTEGER,
        country               TEXT CHECK (country IN ('US','CA'))
      );

      INSERT INTO leads_new
        SELECT id, name, type, address, phone, website, lat, lng, timezone,
               email, contact_name, status, score, research_json,
               personalization_fact, fact_category, source, osm_id,
               created_at, country
          FROM leads;

      DROP TABLE leads;
      ALTER TABLE leads_new RENAME TO leads;
    `)
  },
]

/**
 * The schema version a freshly-opened database ends up at. Exported so a test
 * that rewinds the schema can assert it came all the way back forward without
 * being edited every time a migration is added.
 */
export const MIGRATION_COUNT = migrations.length

function migrate(db: DatabaseSync): void {
  const { user_version: currentVersion } = db
    .prepare("PRAGMA user_version")
    .get() as { user_version: number }

  for (let i = currentVersion; i < migrations.length; i++) {
    db.exec("BEGIN IMMEDIATE")
    try {
      migrations[i](db)
      // PRAGMA does not support bound parameters; `i + 1` is an
      // internally-computed integer, never user input.
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec("COMMIT")
    } catch (err) {
      db.exec("ROLLBACK")
      throw err
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

declare global {
  // HMR-safe singleton: stashed on globalThis so Next.js dev-mode module
  // reloads don't accumulate additional open connections/WAL locks.
  var __vendingOutreachDb: DatabaseSync | undefined
}

function openDatabase(): DatabaseSync {
  const dbPath = resolveDbPath()
  const db = new DatabaseSync(dbPath)

  // Pragmas, applied on every open (spec §7). These are per-connection
  // settings (journal_mode is persisted in the file too, but re-asserting it
  // is cheap and keeps every open point identical).
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000") // default is 0 — instant SQLITE_BUSY
  db.exec("PRAGMA synchronous = NORMAL")

  // Enforcement is turned off across `migrate` and back on once the schema is
  // final. SQLite cannot alter a CHECK constraint, so changing one means
  // rebuilding the table — and dropping a `leads` that `messages` references
  // registers a violation that survives re-creating the rows, whether the
  // constraint is immediate or deferred. Turning it off is what the SQLite
  // docs prescribe for exactly this, and it cannot be done inside a
  // transaction, which is where every migration runs.
  //
  // The OFF is explicit because `node:sqlite` turns enforcement on when the
  // connection is constructed, so a migration would otherwise never see it
  // off no matter where the ON below sits.
  db.exec("PRAGMA foreign_keys = OFF")
  migrate(db)
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

/**
 * Returns the shared database connection, opening and migrating it on first
 * use. This is the only function in the codebase allowed to construct a
 * `DatabaseSync`.
 */
export function getDb(): DatabaseSync {
  if (!globalThis.__vendingOutreachDb) {
    globalThis.__vendingOutreachDb = openDatabase()
  }
  return globalThis.__vendingOutreachDb
}

/** Closes the shared connection, if open. Intended for graceful shutdown. */
export function closeDb(): void {
  if (globalThis.__vendingOutreachDb) {
    globalThis.__vendingOutreachDb.close()
    globalThis.__vendingOutreachDb = undefined
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type ProviderKind = "anthropic" | "google" | "openai_compatible"

/**
 * Every `leads.status`, in one runtime list so `countLeadsByStatus` can
 * zero-fill without a second copy of the vocabulary drifting from the type.
 *
 * The CHECK constraint in migration 1 is a third copy, unavoidably: it is
 * frozen into a shipped migration and cannot be derived from here. Adding a
 * status means a new migration, not an edit to this array alone.
 */
export const LEAD_STATUSES = [
  "new",
  "enriching",
  "ready",
  "held",
  "to_call",
  "contacted",
  "replied",
  "hot",
  "won",
  "dead",
  "unqualified",
  "suppressed",
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type MessageDirection = "in" | "out"

export interface SettingsRow {
  key: string
  value_json: string
}

export interface ProviderRow {
  id: string
  kind: ProviderKind
  label: string | null
  api_key: string | null
  base_url: string | null
  created_at: number | null
}

export interface MailboxRow {
  id: string
  email: string
  app_password: string
  daily_cap: number
  status: string
  last_error: string | null
  last_poll_at: number | null
  uidvalidity: number | null
  last_uid: number | null
  watermark_at: number | null
  created_at: number | null
}

export interface LeadRow {
  id: string
  name: string | null
  type: string | null
  address: string | null
  phone: string | null
  website: string | null
  lat: number | null
  lng: number | null
  timezone: string | null
  /** NULL where nothing could place the business. See migration 4. */
  country: Country | null
  email: string | null
  contact_name: string | null
  status: LeadStatus
  score: number
  research_json: string | null
  personalization_fact: string | null
  fact_category: string | null
  source: string | null
  osm_id: string | null
  created_at: number | null
}

export interface MessageRow {
  id: string
  lead_id: string
  mailbox_id: string | null
  direction: MessageDirection
  sequence_step: number | null
  subject: string | null
  body: string | null
  outreach_id: string | null
  message_id: string | null
  gm_thrid: string | null
  in_reply_to: string | null
  refs: string | null
  status: string
  error: string | null
  sent_at: number | null
  created_at: number | null
  /**
   * 1 when the send went to `FileTransport` (an `.eml` on disk, nothing on the
   * wire).
   *
   * Rehearsals and real sends live in separate uniqueness namespaces
   * (`ux_msg_step_dryrun` and `ux_msg_step`), so a dry run cannot block the
   * real send of a step but still dedupes against other dry runs. Counted by
   * `countSentToday` either way.
   */
  dry_run: number
}

export interface TaskRow {
  id: string
  lead_id: string | null
  kind: string
  run_after: number
  lease_until: number | null
  worker_id: string | null
  attempts: number
  last_error: string | null
  status: string
  payload_json: string | null
  created_at: number | null
}

export interface EventRow {
  id: number
  lead_id: string | null
  type: string
  detail_json: string | null
  created_at: number | null
}

export interface SuppressedRow {
  id: number
  email: string | null
  domain: string | null
  reason: string | null
  created_at: number | null
}

export interface SingletonLockRow {
  id: 1
  owner_pid: number | null
  heartbeat_at: number | null
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value
}

/**
 * Claims one due task (status='pending' and run_after <= now) atomically,
 * marking it 'running' and incrementing `attempts` at claim time (spec §7 —
 * not on failure, so a crash mid-task can't retry forever). Returns the
 * claimed row, or undefined if nothing is due.
 */
export function claimTask(
  workerId: string,
  leaseMs: number
): TaskRow | undefined {
  const db = getDb()
  const now = Date.now()

  db.exec("BEGIN IMMEDIATE")
  try {
    const row = db
      .prepare(
        `UPDATE tasks
         SET status = 'running',
             lease_until = ?,
             worker_id = ?,
             attempts = attempts + 1
         WHERE id = (
           SELECT id FROM tasks
           WHERE status = 'pending' AND run_after <= ?
           ORDER BY run_after ASC, created_at ASC
           LIMIT 1
         )
         RETURNING *`
      )
      .get(now + leaseMs, workerId, now) as TaskRow | undefined
    db.exec("COMMIT")
    return row
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }
}

/** Marks a task done and releases its lease. */
export function completeTask(id: string): void {
  const db = getDb()
  db.prepare(
    `UPDATE tasks SET status = 'done', lease_until = NULL, worker_id = NULL WHERE id = ?`
  ).run(id)
}

/**
 * Records a task failure. Pass `nextRunAfter` to requeue it (status goes back
 * to 'pending' with a new `run_after`); pass `null` to dead-letter it (status
 * becomes 'failed', and it stops being claimed). Never touches `attempts` —
 * that's only incremented at claim time.
 */
export function failTask(
  id: string,
  error: string,
  nextRunAfter: number | null
): void {
  const db = getDb()
  if (nextRunAfter === null) {
    db.prepare(
      `UPDATE tasks
       SET status = 'failed', last_error = ?, lease_until = NULL, worker_id = NULL
       WHERE id = ?`
    ).run(error, id)
  } else {
    db.prepare(
      `UPDATE tasks
       SET status = 'pending', last_error = ?, run_after = ?, lease_until = NULL, worker_id = NULL
       WHERE id = ?`
    ).run(error, nextRunAfter, id)
  }
}

/**
 * Resets tasks stuck in 'running' whose lease has expired (e.g. the worker
 * crashed mid-task) back to 'pending' so they can be claimed again. Returns
 * the reset rows.
 */
export function reapExpiredLeases(now: number): TaskRow[] {
  const db = getDb()

  db.exec("BEGIN IMMEDIATE")
  try {
    const stale = db
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < ?`
      )
      .all(now) as unknown as TaskRow[]

    if (stale.length > 0) {
      const update = db.prepare(
        `UPDATE tasks SET status = 'pending', lease_until = NULL, worker_id = NULL WHERE id = ?`
      )
      for (const task of stale) {
        update.run(task.id)
      }
    }

    db.exec("COMMIT")
    return stale.map((task) => ({
      ...task,
      status: "pending",
      lease_until: null,
      worker_id: null,
    }))
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }
}

export interface EnqueueOptions {
  leadId?: string
  runAfter?: number
  payload?: unknown
}

/** Inserts a new pending task and returns its id. */
export function enqueue(kind: string, options: EnqueueOptions = {}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO tasks (id, lead_id, kind, run_after, attempts, status, payload_json, created_at)
     VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)`
  ).run(
    id,
    options.leadId ?? null,
    kind,
    options.runAfter ?? now,
    options.payload !== undefined ? JSON.stringify(options.payload) : null,
    now
  )

  return id
}

/**
 * Cancels pending tasks for a lead, so a "not interested" arriving at 9:02 can
 * kill a follow-up due at 9:05 (spec §7, TOCTOU). Call inside the same
 * transaction as the suppression write. Pass `kinds` to limit it; omit to
 * cancel all pending tasks for the lead. Sets status='cancelled'. Returns the
 * number cancelled.
 *
 * Only `pending` rows move. A `running` task is mid-flight and owned by a
 * worker — the send path re-checks suppression inside its own transaction, so
 * that is where an in-flight send is stopped, not here.
 *
 * Deliberately opens no transaction of its own: it is meant to join the
 * caller's `BEGIN IMMEDIATE`, and a nested BEGIN would throw.
 */
export function cancelPendingTasksForLead(
  leadId: string,
  kinds?: readonly string[]
): number {
  // An explicit empty list means "cancel none of the kinds I named". Falling
  // through to the unfiltered UPDATE would cancel everything instead — the
  // exact opposite, and silent.
  if (kinds !== undefined && kinds.length === 0) return 0

  const db = getDb()
  const params: string[] = [leadId]
  let sql = `UPDATE tasks SET status = 'cancelled'
             WHERE lead_id = ? AND status = 'pending'`

  if (kinds !== undefined) {
    sql += ` AND kind IN (${kinds.map(() => "?").join(", ")})`
    params.push(...kinds)
  }

  return toNumber(db.prepare(sql).run(...params).changes)
}

/**
 * Derives today's sent count for a mailbox from `messages` (spec §7 — never
 * store a daily counter).
 */
export function countSentToday(
  mailboxId: string,
  localMidnightEpochMs: number,
  options: { includeDryRun?: boolean } = {}
): number {
  const db = getDb()
  // Rehearsals do not count against the daily cap.
  //
  // They used to. The cap exists to protect the sending account's standing
  // with Gmail, and a rehearsal writes a file — it never touches the wire, so
  // it costs that account nothing. Counting them meant an afternoon of
  // reading drafts silently spent the day's real quota: sending was then
  // switched on, nothing went out, and the dashboard (which has always
  // excluded rehearsals) read "Sent today 0 / 25" with no explanation
  // anywhere.
  //
  // `includeDryRun` is for callers asking "how much has this mailbox done",
  // rather than "may it send now".
  const dryRunClause = options.includeDryRun ? "" : " AND dry_run = 0"
  const row = db
    .prepare(
      `SELECT count(*) AS n FROM messages
       WHERE mailbox_id = ? AND status = 'sent' AND sent_at >= ?${dryRunClause}`
    )
    .get(mailboxId, localMidnightEpochMs) as { n: number | bigint }
  return toNumber(row.n)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Checks the suppression list by exact (normalized) address and by domain. */
export function isSuppressed(email: string): boolean {
  const db = getDb()
  const normalized = normalizeEmail(email)
  const atIndex = normalized.lastIndexOf("@")
  const domain = atIndex >= 0 ? normalized.slice(atIndex + 1) : ""

  const row = domain
    ? (db
        .prepare(
          `SELECT 1 AS hit FROM suppressed WHERE email = ? OR domain = ? LIMIT 1`
        )
        .get(normalized, domain) as { hit: number } | undefined)
    : (db
        .prepare(`SELECT 1 AS hit FROM suppressed WHERE email = ? LIMIT 1`)
        .get(normalized) as { hit: number } | undefined)

  return row !== undefined
}

export interface LogEventOptions {
  leadId?: string
  detail?: unknown
}

export function logEvent(type: string, options: LogEventOptions = {}): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO events (lead_id, type, detail_json, created_at) VALUES (?, ?, ?, ?)`
  ).run(
    options.leadId ?? null,
    type,
    options.detail !== undefined ? JSON.stringify(options.detail) : null,
    Date.now()
  )
}

const STALE_LOCK_MS = 3 * 60 * 1000 // ~3 minutes

/**
 * Attempts to acquire the single-instance lock for `pid`. Succeeds if no one
 * holds it, `pid` already holds it, or the current holder's heartbeat is
 * stale (older than ~3 minutes — presumed crashed).
 */
export function acquireSingletonLock(pid: number): boolean {
  const db = getDb()
  const now = Date.now()

  db.exec("BEGIN IMMEDIATE")
  try {
    const existing = db
      .prepare(
        `SELECT owner_pid, heartbeat_at FROM singleton_lock WHERE id = 1`
      )
      .get() as
      { owner_pid: number | null; heartbeat_at: number | null } | undefined

    if (!existing) {
      db.prepare(
        `INSERT INTO singleton_lock (id, owner_pid, heartbeat_at) VALUES (1, ?, ?)`
      ).run(pid, now)
      db.exec("COMMIT")
      return true
    }

    const isStale =
      existing.heartbeat_at === null ||
      now - existing.heartbeat_at > STALE_LOCK_MS
    const isSameOwner = existing.owner_pid === pid

    if (isStale || isSameOwner) {
      db.prepare(
        `UPDATE singleton_lock SET owner_pid = ?, heartbeat_at = ? WHERE id = 1`
      ).run(pid, now)
      db.exec("COMMIT")
      return true
    }

    db.exec("COMMIT")
    return false
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }
}

/**
 * Renews the heartbeat for a lock already held by `pid`. Returns false if
 * `pid` doesn't currently hold it (e.g. it was taken over as stale).
 */
export function renewSingletonLock(pid: number): boolean {
  const db = getDb()
  const result = db
    .prepare(
      `UPDATE singleton_lock SET heartbeat_at = ? WHERE id = 1 AND owner_pid = ?`
    )
    .run(Date.now(), pid)
  return toNumber(result.changes) === 1
}

// ---------------------------------------------------------------------------
// HTTP cache — lib/osm.ts (Overpass + Nominatim), keyed by caller-computed hash
// ---------------------------------------------------------------------------

export interface HttpCacheRow {
  cache_key: string
  kind: string
  response_json: string
  fetched_at: number
}

/**
 * Reads a cache entry if present AND fresher than `maxAgeMs`. A stale row is
 * treated as a miss but is deliberately NOT deleted here — the caller is
 * about to refetch and overwrite it via `setCachedFetch`, and leaving it in
 * place means a failed refetch can still fall back to serving stale data if
 * the caller chooses to (this function just doesn't hand it back itself).
 */
export function getCachedFetch(
  cacheKey: string,
  maxAgeMs: number
): HttpCacheRow | undefined {
  const db = getDb()
  const row = db
    .prepare(`SELECT * FROM http_cache WHERE cache_key = ?`)
    .get(cacheKey) as HttpCacheRow | undefined
  if (!row) return undefined
  if (Date.now() - row.fetched_at > maxAgeMs) return undefined
  return row
}

/** Upserts a cache entry, stamping the current time as `fetched_at`. */
export function setCachedFetch(
  cacheKey: string,
  kind: string,
  responseJson: string
): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO http_cache (cache_key, kind, response_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       kind = excluded.kind,
       response_json = excluded.response_json,
       fetched_at = excluded.fetched_at`
  ).run(cacheKey, kind, responseJson, Date.now())
}

// ---------------------------------------------------------------------------
// Search results — the handoff between "Search" and "Add" on the Leads page
// ---------------------------------------------------------------------------

/**
 * How many past searches stay readable.
 *
 * One wide search is ~1.6 MB, so this is a disk budget, not a history
 * feature: nothing reads a search except the Add button belonging to it, and
 * the dialog only ever has one result on screen. A handful of rows is slack
 * for a second tab, not something anyone navigates back through.
 */
export const SEARCH_RESULT_KEEP = 5

/**
 * Stores one search's candidates and returns the handle the browser holds
 * onto. The JSON is opaque here — `lib/leads.ts` owns its shape, exactly as
 * it owns the shape of what `getCachedFetch` hands back.
 */
export function saveSearchResult(resultJson: string): string {
  const db = getDb()
  const id = randomUUID()

  db.exec("BEGIN IMMEDIATE")
  try {
    db.prepare(
      `INSERT INTO searches (id, result_json, created_at) VALUES (?, ?, ?)`
    ).run(id, resultJson, Date.now())

    // By rowid, not by created_at: several searches can land inside the same
    // millisecond, and a tie there could evict the row this call just wrote —
    // which is the one row that is certain to be read back.
    db.prepare(
      `DELETE FROM searches
        WHERE rowid NOT IN (
          SELECT rowid FROM searches ORDER BY rowid DESC LIMIT ?
        )`
    ).run(SEARCH_RESULT_KEEP)
    db.exec("COMMIT")
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }

  return id
}

/** Reads a stored search back, or `undefined` once it has aged out. */
export function getSearchResult(id: string): string | undefined {
  const row = getDb()
    .prepare(`SELECT result_json FROM searches WHERE id = ?`)
    .get(id) as { result_json: string } | undefined
  return row?.result_json
}

// ---------------------------------------------------------------------------
// Settings — generic JSON key-value store
// ---------------------------------------------------------------------------

/** Reads and JSON-parses a settings value. Returns `undefined` if unset. */
export function getSetting<T>(key: string): T | undefined {
  const db = getDb()
  const row = db
    .prepare(`SELECT value_json FROM settings WHERE key = ?`)
    .get(key) as SettingsRow | undefined
  return row ? (JSON.parse(row.value_json) as T) : undefined
}

/** JSON-serializes and writes a settings value, overwriting any existing one. */
export function setSetting(key: string, value: unknown): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(key, JSON.stringify(value))
}

/** Removes a settings key entirely (as opposed to setting it to `null`). */
export function deleteSetting(key: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface UpsertProviderInput {
  /** Omit to insert a new provider (an id is generated). */
  id?: string
  kind: ProviderKind
  label?: string | null
  /**
   * Omit (`undefined`) to leave an existing provider's key untouched — this
   * is what lets the Settings UI edit a provider's label/base URL without
   * forcing the user to retype an already-saved API key. Pass an empty
   * string only if you actually want to attempt storing an empty key (the
   * key is still required to create a new anthropic/google provider; that
   * validation lives in the caller, not here — this function is purely
   * mechanical).
   */
  apiKey?: string
  baseUrl?: string | null
}

/** All configured providers, oldest first. */
export function listProviders(): ProviderRow[] {
  const db = getDb()
  return db
    .prepare(`SELECT * FROM providers ORDER BY created_at ASC`)
    .all() as unknown as ProviderRow[]
}

export function getProviderById(id: string): ProviderRow | undefined {
  const db = getDb()
  return db.prepare(`SELECT * FROM providers WHERE id = ?`).get(id) as
    ProviderRow | undefined
}

/**
 * Inserts or updates a provider. On update, an omitted `apiKey` preserves
 * the existing stored key (see `UpsertProviderInput.apiKey`) — it can never
 * be cleared back to null this way, only replaced with a new non-empty
 * value, which is an intentional, safe default for a single-user tool.
 */
export function upsertProvider(input: UpsertProviderInput): ProviderRow {
  const db = getDb()
  const id = input.id ?? randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO providers (id, kind, label, api_key, base_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       label = excluded.label,
       base_url = excluded.base_url,
       api_key = COALESCE(excluded.api_key, providers.api_key)`
  ).run(
    id,
    input.kind,
    input.label ?? null,
    input.apiKey ?? null,
    input.baseUrl ?? null,
    now
  )

  const row = getProviderById(id)
  if (!row) {
    throw new Error(
      `upsertProvider: row "${id}" missing immediately after write.`
    )
  }
  return row
}

export function deleteProvider(id: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM providers WHERE id = ?`).run(id)
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

export interface UpsertMailboxInput {
  /** Omit to insert a new mailbox (an id is generated). */
  id?: string
  email: string
  /** Omit to leave an existing mailbox's app password untouched (see UpsertProviderInput.apiKey — same reasoning). */
  appPassword?: string
  dailyCap?: number
}

/** All configured mailboxes, oldest first. */
export function listMailboxes(): MailboxRow[] {
  const db = getDb()
  return db
    .prepare(`SELECT * FROM mailboxes ORDER BY created_at ASC`)
    .all() as unknown as MailboxRow[]
}

export function getMailboxById(id: string): MailboxRow | undefined {
  const db = getDb()
  return db.prepare(`SELECT * FROM mailboxes WHERE id = ?`).get(id) as
    MailboxRow | undefined
}

export function upsertMailbox(input: UpsertMailboxInput): MailboxRow {
  const db = getDb()
  const id = input.id ?? randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO mailboxes (id, email, app_password, daily_cap, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       daily_cap = excluded.daily_cap,
       app_password = COALESCE(excluded.app_password, mailboxes.app_password)`
  ).run(id, input.email, input.appPassword ?? null, input.dailyCap ?? 25, now)

  const row = getMailboxById(id)
  if (!row) {
    throw new Error(
      `upsertMailbox: row "${id}" missing immediately after write.`
    )
  }
  return row
}

export function deleteMailbox(id: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM mailboxes WHERE id = ?`).run(id)
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface InsertLeadInput {
  name: string
  type: string
  address?: string | null
  phone?: string | null
  website?: string | null
  lat?: number | null
  lng?: number | null
  timezone?: string | null
  country?: Country | null
  source: string
  /** Stable OSM identity, e.g. "node/1234567". Used for dedupe. */
  osmId?: string | null
}

/**
 * Inserts a lead with status 'new'. `osm_id` is UNIQUE — if a lead with that
 * osm_id already exists, insert nothing and return the existing row. This is
 * how re-running an Overpass search over an overlapping bbox stays idempotent.
 *
 * The existing row is returned untouched, not merged with `input`: a lead that
 * has since been enriched, emailed, or suppressed must not be reset by a
 * re-scrape of the same OSM node.
 */
export function insertLead(input: InsertLeadInput): LeadRow {
  const db = getDb()
  // An empty or whitespace-only osm_id is "no OSM identity", not an identity
  // that happens to be blank. SQLite treats every NULL as distinct but two
  // empty strings as equal, so passing "" through would silently collapse
  // every un-identified lead in an import into a single row.
  const osmId = input.osmId?.trim() || null
  const id = randomUUID()

  // One statement rather than a SELECT-then-INSERT: the conflict is resolved
  // by the unique index, which cannot race, where a pre-check can.
  db.prepare(
    `INSERT INTO leads (id, name, type, address, phone, website, lat, lng,
                        timezone, country, status, score, source, osm_id,
                        created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?, ?)
     ON CONFLICT(osm_id) DO NOTHING`
  ).run(
    id,
    input.name,
    input.type,
    input.address ?? null,
    input.phone ?? null,
    input.website ?? null,
    input.lat ?? null,
    input.lng ?? null,
    input.timezone ?? null,
    input.country ?? null,
    input.source,
    osmId,
    Date.now()
  )

  // With an osm_id, that column identifies the winner whether the insert
  // happened or was skipped. Without one, no conflict was possible (SQLite
  // treats every NULL as distinct), so the new row is ours by id.
  const row = (
    osmId !== null
      ? db.prepare(`SELECT * FROM leads WHERE osm_id = ?`).get(osmId)
      : db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id)
  ) as LeadRow | undefined

  if (!row) {
    throw new Error("insertLead: row missing immediately after write.")
  }
  return row
}

export function getLeadById(id: string): LeadRow | undefined {
  const db = getDb()
  return db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id) as
    LeadRow | undefined
}

export interface ListLeadsFilter {
  status?: LeadStatus | LeadStatus[]
  /** Case-insensitive substring match against name and address. */
  search?: string
  /** Only leads that have a non-null, non-empty email. */
  hasEmail?: boolean
  limit?: number
  offset?: number
  /** Default "created_at DESC". */
  orderBy?: "created_at DESC" | "created_at ASC" | "score DESC"
}

export type LeadOrderBy = NonNullable<ListLeadsFilter["orderBy"]>

/**
 * The only orderings that can reach SQL, resolved through a lookup so a
 * caller-supplied string is never interpolated.
 *
 * Every one carries `id` as a final tiebreaker. `created_at` is epoch-ms and a
 * bulk Overpass import writes hundreds of leads inside the same millisecond;
 * without a unique tiebreaker, LIMIT/OFFSET paging over them silently repeats
 * and skips rows.
 */
const LEAD_ORDER_BY: Readonly<Record<LeadOrderBy, string>> = {
  "created_at DESC": "created_at DESC, id DESC",
  "created_at ASC": "created_at ASC, id ASC",
  "score DESC": "score DESC, created_at DESC, id DESC",
}

/** Neutralizes LIKE wildcards in a user-typed search term. */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}

interface LeadWhere {
  sql: string
  params: (string | number)[]
}

function buildLeadWhere(filter: ListLeadsFilter): LeadWhere {
  const clauses: string[] = []
  const params: (string | number)[] = []

  if (filter.status !== undefined) {
    const statuses = Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    if (statuses.length === 0) {
      // "None of these statuses" matches nothing. Dropping the clause would
      // return every lead — a filter doing the opposite of what it says.
      clauses.push("0")
    } else {
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`)
      params.push(...statuses)
    }
  }

  const search = filter.search?.trim()
  if (search) {
    // SQLite's LIKE is already case-insensitive for ASCII. The ESCAPE clause
    // stops a literal % or _ in a business name ("100% Coffee") from being
    // read as a wildcard.
    const needle = `%${escapeLikeTerm(search)}%`
    clauses.push(`(name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\')`)
    params.push(needle, needle)
  }

  if (filter.hasEmail === true) {
    clauses.push(`(email IS NOT NULL AND email <> '')`)
  } else if (filter.hasEmail === false) {
    clauses.push(`(email IS NULL OR email = '')`)
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  }
}

export function listLeads(filter: ListLeadsFilter = {}): LeadRow[] {
  const db = getDb()
  const where = buildLeadWhere(filter)
  const order = LEAD_ORDER_BY[filter.orderBy ?? "created_at DESC"]

  let sql = `SELECT * FROM leads${where.sql} ORDER BY ${order}`
  const params = [...where.params]

  if (filter.limit !== undefined || filter.offset !== undefined) {
    // SQLite has no bare OFFSET; -1 is its spelling of "no limit".
    sql += ` LIMIT ? OFFSET ?`
    params.push(
      filter.limit === undefined ? -1 : Math.max(0, Math.trunc(filter.limit)),
      filter.offset === undefined ? 0 : Math.max(0, Math.trunc(filter.offset))
    )
  }

  return db.prepare(sql).all(...params) as unknown as LeadRow[]
}

/** How many leads match `filter`. `limit` and `offset` are ignored. */
export function countLeads(filter: ListLeadsFilter = {}): number {
  const db = getDb()
  const where = buildLeadWhere(filter)
  const row = db
    .prepare(`SELECT count(*) AS n FROM leads${where.sql}`)
    .get(...where.params) as { n: number | bigint }
  return toNumber(row.n)
}

/** Per-status counts. Every LeadStatus is present, zero-filled. */
export function countLeadsByStatus(): Record<LeadStatus, number> {
  const db = getDb()
  const counts = Object.fromEntries(
    LEAD_STATUSES.map((status) => [status, 0])
  ) as Record<LeadStatus, number>

  const rows = db
    .prepare(`SELECT status, count(*) AS n FROM leads GROUP BY status`)
    .all() as unknown as { status: LeadStatus; n: number | bigint }[]

  for (const row of rows) {
    // A status outside the vocabulary cannot exist (migration 1 CHECKs it),
    // but a hand-edited database is not worth crashing the dashboard over.
    if (row.status in counts) counts[row.status] = toNumber(row.n)
  }
  return counts
}

/**
 * Columns `updateLead` may write, as a hardcoded allowlist. This is the only
 * thing standing between a caller-supplied object key and the SET clause;
 * nothing outside this array can reach SQL.
 */
export const UPDATABLE_LEAD_COLUMNS = [
  "name",
  "type",
  "address",
  "phone",
  "website",
  "lat",
  "lng",
  "timezone",
  "country",
  "email",
  "contact_name",
  "status",
  "score",
  "research_json",
  "personalization_fact",
  "fact_category",
] as const

export type UpdatableLeadColumn = (typeof UPDATABLE_LEAD_COLUMNS)[number]

export type LeadPatch = Partial<Pick<LeadRow, UpdatableLeadColumn>>

/**
 * Partial update. Only the provided keys are written. Returns the updated row.
 * Throws if `id` does not exist.
 *
 * An unknown key throws rather than being skipped: a typo like `{ emial }`
 * that silently succeeds is a fact the caller believes it saved and did not.
 * A key set to `undefined` is treated as absent — write an explicit `null` to
 * clear a column.
 *
 * An empty patch is a no-op that returns the current row.
 */
export function updateLead(id: string, patch: LeadPatch): LeadRow {
  const db = getDb()

  const existing = getLeadById(id)
  if (!existing) {
    throw new Error(`updateLead: lead "${id}" does not exist`)
  }

  for (const key of Object.keys(patch)) {
    if (!(UPDATABLE_LEAD_COLUMNS as readonly string[]).includes(key)) {
      throw new Error(
        `updateLead: "${key}" is not an updatable lead column. ` +
          `Allowed: ${UPDATABLE_LEAD_COLUMNS.join(", ")}.`
      )
    }
  }

  const assignments: string[] = []
  const params: (string | number | null)[] = []

  // Driven by the allowlist, not by the patch's keys, so the column names in
  // the SQL are literals from this module even if the check above ever moves.
  for (const column of UPDATABLE_LEAD_COLUMNS) {
    const value = patch[column]
    if (value === undefined) continue
    assignments.push(`${column} = ?`)
    params.push(value)
  }

  if (assignments.length === 0) return existing

  params.push(id)
  db.prepare(`UPDATE leads SET ${assignments.join(", ")} WHERE id = ?`).run(
    ...params
  )

  const row = getLeadById(id)
  if (!row) {
    throw new Error(`updateLead: row "${id}" missing immediately after write.`)
  }
  return row
}

// ---------------------------------------------------------------------------
// Read models for the UI
// ---------------------------------------------------------------------------
//
// Everything below is read-only and shaped for a screen. Kept here rather than
// in the pages so that a Server Component never builds SQL, and so the worker
// and the UI agree on what "a reply" or "due for a call" means.

/** Every message on a lead's thread, oldest first. */
export function listMessagesForLead(leadId: string): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM messages WHERE lead_id = ?
       ORDER BY COALESCE(sent_at, created_at) ASC, id ASC`
    )
    .all(leadId) as unknown as MessageRow[]
}

/**
 * Most recent activity first. `types` narrows to a subset; `excludeTypes`
 * drops one. Excluding is not the same as narrowing — the activity feed wants
 * everything except a handful of duplicates, and listing the ~60 types it does
 * want would go stale the first time one was added.
 */
export function listRecentEvents(
  limit = 50,
  options: {
    leadId?: string
    types?: readonly string[]
    excludeTypes?: readonly string[]
  } = {}
): EventRow[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (options.leadId) {
    where.push("lead_id = ?")
    params.push(options.leadId)
  }
  if (options.types?.length) {
    where.push(`type IN (${options.types.map(() => "?").join(", ")})`)
    params.push(...options.types)
  }
  if (options.excludeTypes?.length) {
    where.push(
      `type NOT IN (${options.excludeTypes.map(() => "?").join(", ")})`
    )
    params.push(...options.excludeTypes)
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  params.push(limit)
  return getDb()
    .prepare(
      `SELECT * FROM events ${clause} ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(...params) as unknown as EventRow[]
}

export interface InboxThread {
  lead: LeadRow
  latestInbound: MessageRow | null
  messageCount: number
}

/**
 * The human queue: leads triage or classification escalated.
 *
 * Everything the bot can dispose of on its own — a refusal, an existing
 * vendor, an out-of-office — is suppressed or closed instead, which is the
 * whole point of the narrow auto-reply action set (spec §3).
 *
 * `replied` is included as well as `hot`. A lead sits at `replied` between the
 * inbound message landing and the classify task running; if that task fails —
 * no API key, provider down, five retries exhausted — the lead would otherwise
 * stay there forever, invisible, while the inbox reported that nothing needed
 * attention. A reply nobody has dispositioned belongs in front of a human even
 * when the model never got to it.
 */
export function listInboxThreads(limit = 100): InboxThread[] {
  const leads = getDb()
    .prepare(
      `SELECT * FROM leads WHERE status IN ('hot', 'replied')
       ORDER BY CASE status WHEN 'hot' THEN 0 ELSE 1 END,
                COALESCE(created_at, 0) DESC
       LIMIT ?`
    )
    .all(limit) as unknown as LeadRow[]

  return leads.map((lead) => {
    const latestInbound = getDb()
      .prepare(
        `SELECT * FROM messages WHERE lead_id = ? AND direction = 'in'
         ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1`
      )
      .get(lead.id) as unknown as MessageRow | undefined
    const messageCount = Number(
      (
        getDb()
          .prepare(`SELECT count(*) AS n FROM messages WHERE lead_id = ?`)
          .get(lead.id) as { n: number }
      ).n
    )
    return { lead, latestInbound: latestInbound ?? null, messageCount }
  })
}

export interface CallListEntry {
  lead: LeadRow
  /** Null for a lead that was never emailable, so was never emailed. */
  lastContactedAt: number | null
  /** Null for the same reason — there is no contact to be hours since. */
  hoursSinceContact: number | null
}

/**
 * Leads worth phoning: either contacted and still silent, or never reachable
 * by email at all.
 *
 * The window is 18–96 hours rather than literally "yesterday". This app only
 * runs while the user has it open, so a strict calendar-day rule would silently
 * drop every lead contacted on a day the machine was asleep. Operators describe
 * the play as "call the day after you make contact"; a few days of slack
 * preserves that without losing anyone.
 *
 * Measured from the MOST RECENT email, not the first. Keying off the first one
 * meant a lead had exactly one window, ever: miss it, and the day-4 and day-9
 * follow-ups came and went with no call prompt behind either of them, and the
 * lead was permanently uncallable. That is the same "the laptop was closed"
 * failure the 96-hour window exists to prevent, so it should not survive one
 * layer down. Each step of the sequence now opens its own window the day
 * after it goes out.
 */
export function listCallList(
  now: number = Date.now(),
  options: { minHours?: number; maxHours?: number } = {}
): CallListEntry[] {
  const minHours = options.minHours ?? 18
  const maxHours = options.maxHours ?? 96
  // Two ways onto this list. The original: emailed, and gone quiet inside the
  // window. The second: never emailable at all — no address exists for them —
  // but a phone number does, so the call is the whole outreach rather than a
  // nudge after one. Those have no `last_sent`, which is what
  // `lastContactedAt: null` means downstream.
  const rows = getDb()
    .prepare(
      `SELECT l.*, MAX(m.sent_at) AS last_sent
         FROM leads l
         JOIN messages m
           ON m.lead_id = l.id AND m.direction = 'out' AND m.status = 'sent'
              AND m.sequence_step IS NOT NULL
        WHERE l.phone IS NOT NULL AND trim(l.phone) <> ''
          AND l.status IN ('contacted', 'replied')
          AND NOT EXISTS (
            SELECT 1 FROM messages i
             WHERE i.lead_id = l.id AND i.direction = 'in'
          )
        GROUP BY l.id
       HAVING last_sent IS NOT NULL
          AND last_sent <= ? AND last_sent >= ?

        UNION ALL

       SELECT l.*, NULL AS last_sent
         FROM leads l
        WHERE l.phone IS NOT NULL AND trim(l.phone) <> ''
          AND l.status = 'to_call'

        ORDER BY last_sent ASC`
    )
    .all(
      now - minHours * 3600_000,
      now - maxHours * 3600_000
    ) as unknown as (LeadRow & {
    last_sent: number | null
  })[]

  return rows.map((row) => {
    const { last_sent, ...lead } = row
    return {
      lead: lead as LeadRow,
      lastContactedAt: last_sent,
      hoursSinceContact:
        last_sent === null ? null : Math.floor((now - last_sent) / 3600_000),
    }
  })
}

export interface DashboardStats {
  sentToday: number
  dryRunToday: number
  repliesLast7d: number
  hotLeads: number
  readyToSend: number
  hardBounceRateLast50: number | null
  byStatus: Record<LeadStatus, number>
  totalLeads: number
}

/** One query pass for the dashboard tiles. `dayStart` is operator-local midnight. */
export function dashboardStats(
  dayStart: number,
  now: number = Date.now()
): DashboardStats {
  const db = getDb()
  const scalar = (sql: string, ...params: (string | number)[]): number =>
    Number(
      (db.prepare(sql).get(...params) as { n: number } | undefined)?.n ?? 0
    )

  const sentToday = scalar(
    `SELECT count(*) AS n FROM messages
      WHERE direction = 'out' AND status = 'sent'
        AND dry_run = 0 AND sent_at >= ?`,
    dayStart
  )
  const dryRunToday = scalar(
    `SELECT count(*) AS n FROM messages
      WHERE direction = 'out' AND status = 'sent'
        AND dry_run = 1 AND sent_at >= ?`,
    dayStart
  )
  const repliesLast7d = scalar(
    `SELECT count(*) AS n FROM messages
      WHERE direction = 'in' AND COALESCE(sent_at, created_at) >= ?`,
    now - 7 * 24 * 3600_000
  )

  // Bounce rate over the last 50 real sends — the number that decides whether
  // the sending account survives.
  //
  // Counted off `messages.error`, where `markBounce` writes `{"bounce":"hard"}`
  // against the specific send that bounced. The `events` table also records
  // `inbound.bounce`, but only per lead and per moment, so it cannot be scoped
  // to "the last 50 sends" without a time-window guess. Null until there is
  // enough history to mean anything, so the UI can say "not enough data"
  // rather than a reassuring 0%.
  const recent = db
    .prepare(
      `SELECT error FROM messages
        WHERE direction = 'out' AND status = 'sent' AND dry_run = 0
        ORDER BY sent_at DESC LIMIT 50`
    )
    .all() as unknown as { error: string | null }[]
  let hardBounceRateLast50: number | null = null
  if (recent.length >= 10) {
    const bounced = recent.filter((r) =>
      (r.error ?? "").includes('"bounce":"hard"')
    ).length
    hardBounceRateLast50 = bounced / recent.length
  }

  const byStatus = countLeadsByStatus()
  return {
    sentToday,
    dryRunToday,
    repliesLast7d,
    hotLeads: byStatus.hot ?? 0,
    readyToSend: byStatus.ready ?? 0,
    hardBounceRateLast50,
    byStatus,
    totalLeads: Object.values(byStatus).reduce((a, b) => a + b, 0),
  }
}

export interface TaskQueueSummary {
  pending: number
  running: number
  failed: number
  /** Finished successfully, all-time. Rows are never pruned, so this only grows. */
  done: number
  /** Pending + running, per kind. */
  byKind: Record<string, number>
}

/**
 * What the engine still has to do.
 *
 * The dashboard needs this because the tick interval is 60 seconds: without a
 * visible queue depth, importing 200 leads looks like nothing happened, and a
 * working system reads as a broken one. `failed` is the dead-letter count —
 * tasks that exhausted their retries and will never run again, which is
 * otherwise invisible until someone goes looking.
 */
export function taskQueueSummary(): TaskQueueSummary {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT status, kind, count(*) AS n FROM tasks GROUP BY status, kind`
    )
    .all() as unknown as { status: string; kind: string; n: number }[]

  const summary: TaskQueueSummary = {
    pending: 0,
    running: 0,
    failed: 0,
    done: 0,
    byKind: {},
  }
  for (const row of rows) {
    const n = Number(row.n)
    if (row.status === "pending") summary.pending += n
    else if (row.status === "running") summary.running += n
    else if (row.status === "failed") summary.failed += n
    else if (row.status === "done") summary.done += n
    if (row.status === "pending" || row.status === "running") {
      summary.byKind[row.kind] = (summary.byKind[row.kind] ?? 0) + n
    }
  }
  return summary
}

// ---------------------------------------------------------------------------
// Engine liveness
// ---------------------------------------------------------------------------

export interface EngineStatus {
  /** True while the engine process has checked in recently. */
  running: boolean
  /** When it last checked in, or null if it has never run on this machine. */
  lastSeenAt: number | null
}

/**
 * Whether the engine process is alive, read off the heartbeat it already
 * writes to `singleton_lock` on every tick.
 *
 * This exists because the single most common "nothing is happening" report is
 * a UI running without its engine — `pnpm dev:web` instead of `pnpm dev`, or a
 * worker that died in a terminal the user has since closed. The web app cannot
 * see other processes, but it can see whether one has touched this row lately.
 *
 * `STALE_LOCK_MS` is deliberately the same threshold the lock itself uses to
 * decide a holder has crashed, so "the UI says stopped" and "another worker
 * may take over" can never disagree.
 */
export function engineStatus(now: number = Date.now()): EngineStatus {
  const row = getDb()
    .prepare(`SELECT heartbeat_at FROM singleton_lock WHERE id = 1`)
    .get() as { heartbeat_at: number | null } | undefined
  const lastSeenAt = row?.heartbeat_at ?? null
  return {
    lastSeenAt,
    running: lastSeenAt !== null && now - lastSeenAt <= STALE_LOCK_MS,
  }
}

// ---------------------------------------------------------------------------
// Daily activity — the dashboard's chart
// ---------------------------------------------------------------------------

export interface DailyActivityPoint {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  /** Real emails that left the machine that day. */
  sent: number
  /** Rehearsals filed to `outbox-dryrun/` that day. Kept separate from `sent`
   * so the chart can show the practice period without ever implying that
   * anything reached a stranger. */
  rehearsed: number
  /** Replies that arrived that day. */
  replies: number
}

function localDayKey(epochMs: number): string {
  const d = new Date(epochMs)
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Emails sent and replies received per day over the last `days` days, oldest
 * first, with quiet days present as zeroes rather than missing.
 *
 * Rehearsals are counted, in their own series. The app ships with sending
 * off, and the setup guide tells you to leave it off until you have read what
 * it wrote — so the whole period when someone most needs to see that this
 * thing is working is a period with no real sends in it at all. Counting only
 * real ones left the chart reading "Nothing sent yet" through days of the
 * engine happily writing and filing emails, which is the same thing it says
 * when the engine is dead.
 *
 * The day buckets are built here in JS and matched against SQLite's
 * `localtime`; both read the same OS timezone, which is the right clock for
 * an app that only ever runs on the operator's own machine.
 */
export function dailyActivity(
  days = 14,
  now: number = Date.now()
): DailyActivityPoint[] {
  const db = getDb()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const windowStart = start.getTime()

  const countByDay = (sql: string): Map<string, number> => {
    const rows = db.prepare(sql).all(windowStart) as unknown as {
      day: string
      n: number
    }[]
    return new Map(rows.map((r) => [r.day, Number(r.n)]))
  }

  const sent = countByDay(
    `SELECT strftime('%Y-%m-%d', sent_at / 1000, 'unixepoch', 'localtime') AS day,
            count(*) AS n
       FROM messages
      WHERE direction = 'out' AND status = 'sent' AND dry_run = 0
        AND sent_at >= ?
      GROUP BY day`
  )
  const rehearsed = countByDay(
    `SELECT strftime('%Y-%m-%d', sent_at / 1000, 'unixepoch', 'localtime') AS day,
            count(*) AS n
       FROM messages
      WHERE direction = 'out' AND status = 'sent' AND dry_run = 1
        AND sent_at >= ?
      GROUP BY day`
  )
  const replies = countByDay(
    `SELECT strftime('%Y-%m-%d', COALESCE(sent_at, created_at) / 1000, 'unixepoch', 'localtime') AS day,
            count(*) AS n
       FROM messages
      WHERE direction = 'in' AND COALESCE(sent_at, created_at) >= ?
      GROUP BY day`
  )

  const points: DailyActivityPoint[] = []
  for (let i = 0; i < days; i++) {
    const at = new Date(windowStart)
    at.setDate(at.getDate() + i)
    const date = localDayKey(at.getTime())
    points.push({
      date,
      sent: sent.get(date) ?? 0,
      rehearsed: rehearsed.get(date) ?? 0,
      replies: replies.get(date) ?? 0,
    })
  }
  return points
}
