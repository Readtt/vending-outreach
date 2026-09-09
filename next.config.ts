import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly — otherwise Next.js may infer it from
  // an unrelated lockfile elsewhere on disk (e.g. a stray package-lock.json
  // in the user's home directory) and emit a warning.
  turbopack: {
    root: dirname,
  },
  // These packages use Node built-ins / native bindings and must not be
  // bundled for the server runtime.
  serverExternalPackages: ["node:sqlite", "imapflow", "nodemailer"],
}

export default nextConfig
