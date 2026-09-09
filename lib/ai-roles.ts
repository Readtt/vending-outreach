/**
 * The pure, dependency-free half of the AI layer's role system: types and
 * static data, with zero import of `lib/db.ts` (and therefore zero import
 * of `node:sqlite`, which cannot be bundled for the browser).
 *
 * `lib/ai.ts` re-exports everything here, so every server-side consumer can
 * keep importing from `"@/lib/ai"` as usual — this file exists purely so
 * client components (e.g. the Settings page's role/model pickers) can pull
 * in `AI_ROLES`, `ROLE_LABELS`, etc. WITHOUT transitively dragging
 * `node:sqlite` into the client bundle. Only `type`-only imports of
 * `ProviderKind` from `lib/db.ts` happen here (erased at compile time) —
 * never a value import from `./db`.
 */

import type { ProviderKind } from "./db.ts"

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
  writer: "Writer",
  triage: "Triage",
  research: "Research",
}

export const ROLE_DESCRIPTIONS: Record<AiRole, string> = {
  writer: "First emails, follow-ups, call scripts — worth spending more on.",
  triage: "Classifies replies. Needs to be cheap and fast, not clever.",
  research: "Distills scraped page text into facts. Cheap and fast.",
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
 * Best-effort per-role model suggestions, keyed by provider *kind* rather
 * than a specific provider — never hardcode which provider the user must
 * use. These are only ever applied opportunistically against whatever
 * `listModels` actually returns for the provider the user configured (see
 * `suggestDefaultModelId`), so a stale or wrong guess here just means no
 * default is preselected, not a broken app.
 */
const DEFAULT_MODEL_SUGGESTIONS: Record<
  ProviderKind,
  Partial<Record<AiRole, readonly string[]>>
> = {
  anthropic: {
    writer: ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"],
    triage: ["claude-haiku-4-5", "claude-3-5-haiku-20241022"],
    research: ["claude-haiku-4-5", "claude-3-5-haiku-20241022"],
  },
  google: {
    writer: ["gemini-2.5-pro"],
    triage: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    research: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
  },
  openai_compatible: {
    // Wildly provider-dependent (OpenRouter/Groq/DeepSeek/xAI/Together/
    // Fireworks/Ollama/LM Studio all have different catalogues) — these are
    // just plausible names to opportunistically match against whatever
    // /models actually returns.
    writer: ["gpt-4o", "llama-3.3-70b-versatile", "deepseek-chat"],
    triage: ["gpt-4o-mini", "llama-3.1-8b-instant", "deepseek-chat"],
    research: ["gpt-4o-mini", "llama-3.1-8b-instant", "deepseek-chat"],
  },
}

/**
 * Picks the first suggested model id for `(providerKind, role)` that's
 * actually present in `availableModelIds`. Returns `undefined` rather than
 * guessing when nothing matches — an unselected dropdown is fine, silently
 * picking the wrong model is not.
 */
export function suggestDefaultModelId(
  providerKind: ProviderKind,
  role: AiRole,
  availableModelIds: readonly string[]
): string | undefined {
  const suggestions = DEFAULT_MODEL_SUGGESTIONS[providerKind]?.[role] ?? []
  return suggestions.find((id) => availableModelIds.includes(id))
}
