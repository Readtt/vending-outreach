/**
 * Pure types + pure constant data for the Leads page, shared between
 * `data.ts`/`actions.ts` (server-only) and the client components. Zero
 * value-import of `@/lib/db`, `@/lib/leads`, or `@/lib/osm` — all three
 * reach `node:sqlite` (directly, or via `lib/osm.ts`'s own import of
 * `lib/db.ts` for the HTTP cache) and would break the client bundle. Only
 * `import type` happens here, which TypeScript erases at compile time —
 * same rule as `app/settings/types.ts`.
 *
 * `LEAD_STATUS_LABELS`/`LEAD_STATUS_BADGE_VARIANT` hardcode all eleven
 * `LeadStatus` values rather than deriving them from `lib/db`'s
 * `LEAD_STATUSES` array, specifically so the status filter dropdown never
 * needs that array as a value on the client — `Object.keys(LEAD_STATUS_LABELS)`
 * gives the same list from data that was always client-safe.
 */

import type { LeadStatus } from "@/lib/db"
import type { LeadType, OsmCandidate } from "@/lib/osm"

export type { OsmCandidate }

export interface LeadListItem {
  id: string
  name: string | null
  type: string | null
  status: LeadStatus
  score: number
  email: string | null
  phone: string | null
  fact: string | null
}

export interface BusinessTypeOption {
  id: LeadType
  label: string
}

export interface FindLocationsFormResult {
  totalFound: number
  newCount: number
  clamped: boolean
  resolvedPlace?: string
  candidates: OsmCandidate[]
}

export interface LeadMessageItem {
  id: string
  direction: "in" | "out"
  subject: string | null
  body: string | null
  status: string
  sentAt: number | null
  createdAt: number | null
  dryRun: boolean
}

export interface LeadEventItem {
  id: number
  text: string
  extra?: string
  createdAt: number | null
}

export interface LeadDetail {
  id: string
  name: string | null
  type: string | null
  status: LeadStatus
  score: number
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  fact: string | null
  factCategory: string | null
  messages: LeadMessageItem[]
  events: LeadEventItem[]
}

export function formatDateTime(epochMs: number | null): string {
  if (epochMs === null) return ""
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  enriching: "Enriching",
  ready: "Ready",
  held: "Held",
  contacted: "Contacted",
  replied: "Replied",
  hot: "Hot",
  won: "Won",
  dead: "Dead",
  unqualified: "Unqualified",
  suppressed: "Suppressed",
}

type BadgeVariant = "default" | "secondary" | "outline" | "destructive"

/** The accent colour ("default") is spent deliberately on `hot` only — the
 * one status that means "a person needs to look at this." Everything else
 * stays quiet by design (brief: "one accent colour"). */
export const LEAD_STATUS_BADGE_VARIANT: Record<LeadStatus, BadgeVariant> = {
  new: "secondary",
  enriching: "secondary",
  ready: "outline",
  held: "outline",
  contacted: "outline",
  replied: "outline",
  hot: "default",
  won: "outline",
  dead: "destructive",
  unqualified: "destructive",
  suppressed: "destructive",
}
