/**
 * Server-only data shaping for the Leads page. `page.tsx` and the server
 * actions in `actions.ts` are the only callers — client components import
 * shapes from `./types` instead. See `app/settings/data.ts` for the pattern
 * this mirrors.
 */

import { countLeads, listLeads } from "@/lib/db"
import { TARGET_TYPES, TYPE_LABELS, type LeadType } from "@/lib/osm"
import type { BusinessTypeOption, LeadListItem } from "./types"

/** Brief-sanctioned alternative to real pagination: cap the table at a
 * generous number of the most recently imported leads and filter/search
 * client-side within that window. `total` is still the true count, so the
 * page can say honestly when older leads are not in view. */
export const LEAD_LIST_CAP = 500

export interface LeadListData {
  items: LeadListItem[]
  total: number
  cap: number
}

export function getLeadListData(): LeadListData {
  const total = countLeads()
  const rows = listLeads({ limit: LEAD_LIST_CAP, orderBy: "created_at DESC" })
  return {
    total,
    cap: LEAD_LIST_CAP,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: typeLabel(r.type),
      status: r.status,
      score: r.score,
      email: r.email,
      phone: r.phone,
      fact: r.personalization_fact,
    })),
  }
}

/** The stored `type` is an internal id like `car_dealer`. Nobody outside this
 * codebase should have to read one, so it becomes a real name here. */
function typeLabel(type: string | null): string | null {
  if (!type) return null
  return TYPE_LABELS[type as LeadType] ?? type.replace(/_/g, " ")
}

export function getBusinessTypeOptions(): BusinessTypeOption[] {
  return TARGET_TYPES.map((id) => ({ id, label: TYPE_LABELS[id] }))
}
