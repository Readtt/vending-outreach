/**
 * Where this app is allowed to put things on disk.
 *
 * One rule: everything the app writes lives under the project folder. The
 * database, the dry-run outbox, the STOP file. Nothing lands in
 * `%LOCALAPPDATA%`, `~/.config`, or a temp directory, so the whole
 * installation is one folder you can copy, back up, or delete.
 *
 * The trade-off is spelled out in `describeSyncRisk` below: a project folder
 * that a cloud client is syncing is a bad place for a live SQLite file. That
 * is a warning, not a refusal — where the project lives is the user's call,
 * and `VENDING_DB_PATH` moves the database out without moving the project.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_NAME = "vending-outreach"

/** True if `dir` holds this project's own package.json. */
function isProjectRoot(dir: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8")
    return (JSON.parse(raw) as { name?: string }).name === PACKAGE_NAME
  } catch {
    return false
  }
}

/** Walks up from `start` looking for this project's package.json. */
function findUpward(start: string): string | undefined {
  let dir = path.resolve(start)
  for (;;) {
    if (isProjectRoot(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

let cachedRoot: string | undefined

/**
 * The project folder — the one holding package.json.
 *
 * The working directory is tried first because both entry points (`next dev`
 * and `node worker/main.ts`) are started from there by the pnpm scripts, and
 * because it is the only candidate that survives Next bundling server code
 * into `.next/server`, where `import.meta.url` no longer points anywhere near
 * the source tree. Walking up from this module covers being launched from a
 * subdirectory; the last resort is the working directory as-is, which keeps
 * this function total — a path is always returned, never an exception.
 */
export function projectRoot(): string {
  if (cachedRoot) return cachedRoot
  cachedRoot =
    findUpward(process.cwd()) ??
    findUpward(path.dirname(fileURLToPath(import.meta.url))) ??
    process.cwd()
  return cachedRoot
}

/** A path inside the project folder. */
export function projectPath(...segments: string[]): string {
  return path.join(projectRoot(), ...segments)
}

/** Everything the app writes at runtime goes here. Git ignores it. */
export function dataDir(): string {
  return projectPath("data")
}

/**
 * Cloud sync clients and live SQLite files do not mix: `app.db`, `app.db-wal`,
 * and `app.db-shm` are three files that only make sense as one consistent set,
 * and a sync client uploads or restores them independently. Naming the client
 * matters — the fix is different for each one — so the vendor is returned
 * rather than a bare boolean.
 *
 * Returns null when the path looks fine.
 */
export function describeSyncRisk(target: string): string | null {
  // Separators are normalised through path.sep rather than a regex so the
  // patterns below only ever have to match forward slashes.
  const haystack = target.toLowerCase().split(path.sep).join("/")
  const vendors: [RegExp, string][] = [
    [/\bonedrive\b/, "OneDrive"],
    [/\bdropbox\b/, "Dropbox"],
    [/\bgoogle ?drive\b|\/my drive\b/, "Google Drive"],
    [/\bicloud ?drive\b|\/com~apple~clouddocs\b/, "iCloud Drive"],
  ]
  for (const [pattern, vendor] of vendors) {
    if (pattern.test(haystack)) return vendor
  }
  return null
}
