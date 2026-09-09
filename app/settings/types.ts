/**
 * Pure types + pure functions shared between the Settings page's server
 * data layer (`data.ts`) and its client components. Zero value-import of
 * `@/lib/db` on purpose — client components (`providers-section.tsx`,
 * `role-model-picker.tsx`, `mailboxes-section.tsx`) import from here rather
 * than from `./data` so that `node:sqlite` (pulled in by `@/lib/db`, and
 * unbundleable for the browser) never ends up in the client graph. Only a
 * `type`-only import of `ProviderKind` happens here, which TypeScript
 * erases at compile time.
 */

import type { EngineStatus, ProviderKind } from "@/lib/db"

export function defaultLabelForKind(kind: ProviderKind): string {
  if (kind === "anthropic") return "Anthropic"
  if (kind === "google") return "Google"
  return "OpenAI-compatible"
}

export interface ProviderPublic {
  id: string
  kind: ProviderKind
  label: string
  baseUrl: string | null
  hasApiKey: boolean
  apiKeyMasked: string | null
}

export interface MailboxPublic {
  id: string
  email: string
  dailyCap: number
  status: string
  appPasswordMasked: string
}

export interface SettingsStatus {
  engine: EngineStatus
  /** Plain-language names of the things still to be filled in. Empty when done. */
  missing: string[]
  jobs: {
    waiting: number
    working: number
    failed: number
    done: number
  }
}
