import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import { dataDir, describeSyncRisk, projectPath, projectRoot } from "./paths.ts"

test("projectRoot finds the folder holding this project's package.json", () => {
  const root = projectRoot()
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  ) as { name: string }
  assert.equal(pkg.name, "vending-outreach")
})

test("everything the app writes stays under the project folder", () => {
  // The point of the module: no %LOCALAPPDATA%, no ~/.config, no temp dir.
  for (const target of [dataDir(), projectPath("outbox-dryrun"), projectPath("STOP")]) {
    assert.ok(
      target.startsWith(projectRoot() + path.sep),
      `${target} escaped the project folder`
    )
  }
})

test("describeSyncRisk names the sync client rather than answering yes/no", () => {
  // Named because the fix differs per vendor, and the warning quotes it.
  assert.equal(
    describeSyncRisk("C:/Users/sam/OneDrive/Documents/app/data/app.db"),
    "OneDrive"
  )
  assert.equal(describeSyncRisk("/Users/sam/Dropbox/app/data/app.db"), "Dropbox")
  assert.equal(
    describeSyncRisk("/Users/sam/Google Drive/app/data/app.db"),
    "Google Drive"
  )
  assert.equal(
    describeSyncRisk("/Users/sam/Library/Mobile Documents/com~apple~CloudDocs/app.db"),
    "iCloud Drive"
  )
})

test("describeSyncRisk is quiet about ordinary paths", () => {
  assert.equal(describeSyncRisk("C:/code/vending-outreach/data/app.db"), null)
  assert.equal(describeSyncRisk("/home/sam/src/vending-outreach/data/app.db"), null)
  // "drive" on its own is a directory name, not a sync client.
  assert.equal(describeSyncRisk("/mnt/drive/app.db"), null)
})
