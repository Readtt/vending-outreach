/**
 * Pure types + pure constant data for the Calls page. Zero value-import of
 * `@/lib/db` — see `app/settings/types.ts` for why.
 */

export interface CallListItem {
  id: string
  name: string | null
  type: string | null
  phone: string
  /** "Columbus, OH" — the caller wants to know whose morning this is. */
  location: string
  hoursSinceContact: number
  fact: string | null
  lastEmailSubject: string | null
  lastEmailBody: string | null
  /** Cached from `leads.research_json.callScript`, if a script has already
   * been generated for this lead — null means the button still says
   * "Generate call script." */
  callScript: string | null
}

/** The four outcome buttons. A discriminating string, not a raw
 * `LeadStatus`, so the client never needs the full status vocabulary —
 * `actions.ts` owns the mapping. */
export type CallOutcome =
  "reached" | "left_voicemail" | "not_interested" | "interested"

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  reached: "Spoke to them",
  left_voicemail: "Left a voicemail",
  not_interested: "Not interested",
  interested: "Interested",
}
