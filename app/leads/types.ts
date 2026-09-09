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
  /** "Columbus, OH" — enough to tell two searches apart at a glance. */
  location: string
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

/** Plain-language names for each stage a lead can be at. */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  enriching: "Researching",
  ready: "Ready to send",
  held: "Needs your OK",
  contacted: "Emailed",
  replied: "Replied",
  hot: "Needs you",
  won: "Won",
  dead: "Not interested",
  unqualified: "Not a fit",
  suppressed: "Asked us to stop",
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

/**
 * The lead score, said in words.
 *
 * The raw number is a 6-12 band nobody outside this codebase can interpret,
 * and a bare "9" in a table column is exactly the kind of number that means
 * nothing to the person reading it. The bands below come from
 * `SCORING` in `lib/leads.ts`: a lead only reaches scoring at all once it has
 * an email, a website and a checked fact, and anything under 7 is dropped
 * before it gets here.
 */
export type LeadFit = "Great" | "Good" | "OK"

export function leadFit(score: number): LeadFit {
  if (score >= 10) return "Great"
  if (score >= 8) return "Good"
  return "OK"
}

export const LEAD_FIT_EXPLANATION =
  "Based on the kind of business, its opening hours, and how much we could find out about it."

export { formatDateTime } from "@/lib/format"
