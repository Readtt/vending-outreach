/**
 * The pure, dependency-free half of the AI layer's role system: types and
 * static data, with zero import of `lib/db.ts` (and therefore zero import
 * of `node:sqlite`, which cannot be bundled for the browser).
 *
 * `lib/ai.ts` re-exports everything here, so every server-side consumer can
 * keep importing from `"@/lib/ai"` as usual — this file exists purely so
 * client components (e.g. the Settings page's role/model pickers) can pull
 * in `AI_ROLES`, `ROLE_LABELS`, etc. WITHOUT transitively dragging
 * `node:sqlite` into the client bundle. Nothing here imports from `./db` at
 * all, in any form.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * The three jobs a model does in this app. Kept as named roles (rather than
 * threading a provider/model pair through every call site) so the user can
 * point cheap-and-fast work at a cheap-and-fast model without touching the
 * code that does the work.
 */
export const AI_ROLES = ["writer", "triage", "research"] as const
export type AiRole = (typeof AI_ROLES)[number]

export const ROLE_LABELS: Record<AiRole, string> = {
  writer: "Writing emails",
  triage: "Reading replies",
  research: "Reading websites",
}

export const ROLE_DESCRIPTIONS: Record<AiRole, string> = {
  writer:
    "Writes the first email, the follow-ups and your call scripts. Worth paying more for.",
  triage: "Sorts replies into what you handle and what the app handles.",
  research: "Finds one useful detail on a business's website.",
}

export interface RoleModelSetting {
  providerId: string
  modelId: string
}

// ---------------------------------------------------------------------------
// listModels' return shape — pure data, no fetch logic lives here
// ---------------------------------------------------------------------------

export interface ModelSummary {
  id: string
  name?: string
}

// ---------------------------------------------------------------------------
// Default model suggestions
// ---------------------------------------------------------------------------

/**
 * The models each job would like, best first.
 *
 * One list, not one per provider. The same model reaches you under different
 * ids depending on where you get it (`claude-haiku-4-5` straight from
 * Anthropic, `anthropic/claude-haiku-4.5` through OpenRouter), so both spellings
 * simply sit in the list and whichever the provider actually offers wins.
 *
 * The rule behind the order: writing is the job worth paying for, because a
 * stranger judges you on those emails. Reading replies and reading websites
 * run on every message and every page, so they want the cheapest fast model
 * available.
 *
 * These names go out of date, and that is fine. They are only ever matched
 * against the catalogue the provider itself returned, so a name that no longer
 * exists just does not match and the picker asks you to choose. It never
 * quietly runs on something you did not pick.
 */
const ROLE_PREFERENCES: Record<AiRole, readonly string[]> = {
  writer: [
    "claude-opus-5",
    "claude-sonnet-5",
    "gemini-2.5-pro",
    "gpt-5.5",
    "gpt-4o",
    "deepseek-chat",
    "llama-3.3-70b-versatile",
    "llama-3.3-70b-instruct",
  ],
  triage: [
    "claude-haiku-4-5",
    "claude-haiku-4.5",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gpt-5.4-mini",
    "gpt-4o-mini",
    "llama-3.1-8b-instant",
    "deepseek-chat",
  ],
  research: [
    "claude-haiku-4-5",
    "claude-haiku-4.5",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gpt-5.4-mini",
    "gpt-4o-mini",
    "llama-3.1-8b-instant",
    "deepseek-chat",
  ],
}

/**
 * Whether `modelId` is the model `preference` names.
 *
 * An exact match, or the same name behind a vendor prefix. Deliberately not a
 * substring test: that would let "gpt-4o" match "gpt-4o-mini" (a quiet
 * downgrade for the writing job) and let "claude-opus-5" match
 * "anthropic/claude-opus-5:batch", which answers hours later and would hang
 * every email in the queue.
 */
function matchesPreference(modelId: string, preference: string): boolean {
  return modelId === preference || modelId.endsWith(`/${preference}`)
}

/**
 * The best model for `role` out of the ones the provider actually offers.
 *
 * Returns undefined when none of them match, rather than guessing. An empty
 * dropdown the user has to fill in is a small annoyance; running every email
 * through the wrong model is not.
 */
export function suggestDefaultModelId(
  role: AiRole,
  availableModelIds: readonly string[]
): string | undefined {
  for (const preference of ROLE_PREFERENCES[role]) {
    const match = availableModelIds.find((id) =>
      matchesPreference(id, preference)
    )
    if (match) return match
  }
  return undefined
}
