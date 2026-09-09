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

export type LeadStatus =
  | "new"
  | "enriching"
  | "ready"
  | "held"
  | "contacted"
  | "replied"
  | "hot"
  | "won"
  | "dead"
  | "unqualified"
  | "suppressed"

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
    | ProviderRow
    | undefined
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
    throw new Error(`upsertProvider: row "${id}" missing immediately after write.`)
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
    | MailboxRow
    | undefined
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
  ).run(
    id,
    input.email,
    input.appPassword ?? null,
    input.dailyCap ?? 25,
    now
  )

  const row = getMailboxById(id)
  if (!row) {
    throw new Error(`upsertMailbox: row "${id}" missing immediately after write.`)
  }
  return row
}

export function deleteMailbox(id: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM mailboxes WHERE id = ?`).run(id)
}
