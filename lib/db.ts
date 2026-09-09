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

// ---------------------------------------------------------------------------
// Path resolution (spec §0.2 — hard invariant)
// ---------------------------------------------------------------------------

function resolveDbPath(): string {
  const override = process.env.VENDING_DB_PATH?.trim()
  let dbPath: string

  if (override) {
    dbPath = path.resolve(override)
  } else {
    const localAppData = process.env.LOCALAPPDATA
    if (!localAppData) {
      throw new Error(
        "Cannot resolve a database path: LOCALAPPDATA is not set and " +
          "VENDING_DB_PATH was not provided. Set one of them."
      )
    }
    dbPath = path.join(localAppData, "vending-outreach", "app.db")
  }

  if (dbPath.toLowerCase().includes("onedrive")) {
    throw new Error(
      `Refusing to open the database at "${dbPath}" because the resolved ` +
        'path contains "OneDrive". OneDrive syncs app.db, app.db-wal, and ' +
        "app.db-shm as three independently-versioned files; a sync racing a " +
        "live write corrupts SQLite. Point VENDING_DB_PATH somewhere outside " +
        "any synced folder (the default is " +
        "%LOCALAPPDATA%\\vending-outreach\\app.db, which is safe as long as " +
        "LOCALAPPDATA itself isn't redirected into OneDrive)."
    )
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
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
]

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
  db.exec("PRAGMA foreign_keys = ON")

  migrate(db)
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
  localMidnightEpochMs: number
): number {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT count(*) AS n FROM messages
       WHERE mailbox_id = ? AND status = 'sent' AND sent_at >= ?`
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
                        timezone, status, score, source, osm_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?, ?)
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
