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

/**
 * What a Settings form's save came back with.
 *
 * The save actions return this instead of throwing, because a thrown Server
 * Action rejects the whole form submission: React has nowhere to put the
 * message, so a blank required field showed up as an error overlay in dev and
 * as nothing at all in production. A returned value is something
 * `useActionState` can render.
 *
 * Both outcomes carry `at`, a timestamp, rather than being distinguished by
 * their contents alone. Saving twice with no changes in between, or failing
 * twice the same way, has to read as two results and not one: otherwise the
 * second "Saved" is indistinguishable from the first one still being on
 * screen, which is the exact thing this is meant to make obvious.
 */
export type SaveState =
  | { status: "idle" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string; at: number }

export const IDLE_SAVE: SaveState = { status: "idle" }

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
