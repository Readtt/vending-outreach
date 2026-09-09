/**
 * The multi-provider AI layer.
 *
 * Every model call this app makes — first emails, follow-ups, call scripts,
 * reply classification, research distillation — goes through this module.
 * Deliberately tiny: OpenRouter, Groq, DeepSeek, xAI, Together, Fireworks,
 * Ollama and LM Studio are all OpenAI-compatible, so one branch in
 * `getModel` covers all eight of them. Anthropic and Google get their own
 * branch because they have their own SDKs and their own model-catalogue
 * endpoints.
 *
 * Nothing here ever hands an API key to the browser: `listModels` is called
 * exclusively from `app/api/models/route.ts` (a server-only route handler),
 * and provider rows read here are never passed straight to a client
 * component — that redaction lives in `app/settings/data.ts`.
 */

import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateObject, generateText, type LanguageModel } from "ai"
import { createHash } from "node:crypto"
import type { z } from "zod"
import {
  deleteSetting,
  getProviderById,
  getSetting,
  logEvent,
  setSetting,
  type ProviderRow,
} from "./db"

/**
 * An error from resolving/listing models, carrying an HTTP-status-shaped
 * hint for callers that want one (currently just `app/api/models/route.ts`).
 * `status` defaults to 502 (upstream problem) — the specific spots below
 * that are really the caller's fault (an unknown provider, a provider
 * that's missing its key/URL) use 404/400 instead, so a stale providerId in
 * the UI doesn't get reported as if the provider itself were down.
 */
export class ModelListError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = "ModelListError"
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

function getProvider(providerId: string): ProviderRow {
  const p = getProviderById(providerId)
  if (!p) {
    throw new ModelListError(
      `Unknown AI provider "${providerId}" — it may have been deleted in Settings.`,
      404
    )
  }
  return p
}

/**
 * Resolves a `(providerId, modelId)` pair to an AI SDK model. OpenRouter,
 * Groq, DeepSeek, xAI, Together, Fireworks, Ollama and LM Studio are all
 * OpenAI-compatible, so they share the fallback branch below — only
 * Anthropic and Google need their own SDK.
 */
export function getModel(providerId: string, modelId: string): LanguageModel {
  const p = getProvider(providerId)

  if (p.kind === "anthropic") {
    if (!p.api_key) {
      throw new Error(`Provider "${p.label ?? p.id}" has no API key set.`)
    }
    return createAnthropic({ apiKey: p.api_key })(modelId)
  }

  if (p.kind === "google") {
    if (!p.api_key) {
      throw new Error(`Provider "${p.label ?? p.id}" has no API key set.`)
    }
    return createGoogleGenerativeAI({ apiKey: p.api_key })(modelId)
  }

  // openai_compatible: OpenRouter, Groq, DeepSeek, xAI, Together, Fireworks,
  // Ollama, LM Studio, ...
  if (!p.base_url) {
    throw new Error(`Provider "${p.label ?? p.id}" has no base URL set.`)
  }
  return createOpenAICompatible({
    name: p.id,
    baseURL: p.base_url,
    apiKey: p.api_key ?? undefined,
  })(modelId)
}

// ---------------------------------------------------------------------------
// Roles
//
// The pure parts (role names/labels/descriptions, default-suggestion data,
// the RoleModelSetting/ModelSummary shapes) live in `./ai-roles`, which has
// zero dependency on `./db` — that's what lets client components (the
// Settings page's role/model pickers) import them directly without
// dragging `node:sqlite` into the browser bundle. Re-exported here so every
// server-side caller can keep importing everything from "@/lib/ai".
// ---------------------------------------------------------------------------

export * from "./ai-roles"
import {
  ROLE_LABELS,
  type AiRole,
  type ModelSummary,
  type RoleModelSetting,
} from "./ai-roles"

function roleSettingKey(role: AiRole): string {
  return `ai.role.${role}`
}

/** The `{providerId, modelId}` currently assigned to `role`, if any. */
export function getRoleModel(role: AiRole): RoleModelSetting | undefined {
  return getSetting<RoleModelSetting>(roleSettingKey(role))
}

export function setRoleModel(
  role: AiRole,
  providerId: string,
  modelId: string
): void {
  const setting: RoleModelSetting = { providerId, modelId }
  setSetting(roleSettingKey(role), setting)
}

export function clearRoleModel(role: AiRole): void {
  deleteSetting(roleSettingKey(role))
}

/** Resolves `role` all the way to a ready-to-use AI SDK model. */
function resolveRoleModel(role: AiRole): RoleModelSetting & {
  model: LanguageModel
} {
  const setting = getRoleModel(role)
  if (!setting) {
    throw new Error(
      `No model is configured for the "${ROLE_LABELS[role]}" role yet. ` +
        "Set one in Settings → AI Providers."
    )
  }
  return { ...setting, model: getModel(setting.providerId, setting.modelId) }
}

// ---------------------------------------------------------------------------
// listModels — live catalogue fetch, one normalized shape
// ---------------------------------------------------------------------------

const LIST_MODELS_TIMEOUT_MS = 15_000

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIST_MODELS_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Best-effort extraction of a human-readable message from an error body. */
async function readableErrorFromResponse(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error: unknown }).error
      if (typeof err === "string") return err
      if (err && typeof err === "object" && "message" in err) {
        const message = (err as { message: unknown }).message
        if (typeof message === "string" && message.trim()) return message
      }
    }
  } catch {
    // Body wasn't JSON (or was empty) — fall through to the status text.
  }
  return `${res.status} ${res.statusText || "Request failed"}`.trim()
}

function wrapNetworkError(providerLabel: string, err: unknown): Error {
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(
      `Timed out reaching ${providerLabel} after ${LIST_MODELS_TIMEOUT_MS / 1000}s. ` +
        "Check the base URL and that the server is running."
    )
  }
  const message = err instanceof Error ? err.message : String(err)
  return new Error(`Could not reach ${providerLabel}: ${message}`)
}

interface AnthropicModelsResponse {
  data: Array<{ id: string; display_name?: string }>
}

interface GoogleModelsResponse {
  models: Array<{
    name: string
    displayName?: string
    supportedGenerationMethods?: string[]
  }>
}

interface OpenAICompatibleModelsResponse {
  data: Array<{ id: string; name?: string }>
}

/**
 * Fetches a provider's own model catalogue so the user never has to type a
 * model id by hand. Normalizes Anthropic's, Google's, and the OpenAI-
 * compatible family's three different response shapes into one. Always
 * either resolves with the list or rejects with a message that's safe and
 * useful to show directly in the UI — never throws something that would
 * crash the settings page.
 */
export async function listModels(providerId: string): Promise<ModelSummary[]> {
  const p = getProvider(providerId)
  const label = p.label ?? p.id

  if (p.kind === "anthropic") {
    if (!p.api_key) throw new ModelListError(`Provider "${label}" has no API key set.`, 400)
    let res: Response
    try {
      res = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": p.api_key,
          "anthropic-version": "2023-06-01",
        },
      })
    } catch (err) {
      throw wrapNetworkError("Anthropic", err)
    }
    if (!res.ok) {
      throw new Error(`Anthropic rejected the request: ${await readableErrorFromResponse(res)}`)
    }
    const body = (await res.json()) as AnthropicModelsResponse
    return body.data.map((m) => ({ id: m.id, name: m.display_name }))
  }

  if (p.kind === "google") {
    if (!p.api_key) throw new ModelListError(`Provider "${label}" has no API key set.`, 400)
    let res: Response
    try {
      res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(p.api_key)}`,
        {}
      )
    } catch (err) {
      throw wrapNetworkError("Google", err)
    }
    if (!res.ok) {
      throw new Error(`Google rejected the request: ${await readableErrorFromResponse(res)}`)
    }
    const body = (await res.json()) as GoogleModelsResponse
    return body.models
      .filter(
        (m) =>
          !m.supportedGenerationMethods ||
          m.supportedGenerationMethods.includes("generateContent")
      )
      .map((m) => ({
        id: m.name.replace(/^models\//, ""),
        name: m.displayName,
      }))
  }

  // openai_compatible
  if (!p.base_url) throw new ModelListError(`Provider "${label}" has no base URL set.`, 400)
  const url = `${p.base_url.replace(/\/+$/, "")}/models`
  let res: Response
  try {
    res = await fetchWithTimeout(url, {
      headers: p.api_key ? { Authorization: `Bearer ${p.api_key}` } : {},
    })
  } catch (err) {
    throw wrapNetworkError(label, err)
  }
  if (!res.ok) {
    throw new Error(`${label} rejected the request: ${await readableErrorFromResponse(res)}`)
  }
  const body = (await res.json()) as OpenAICompatibleModelsResponse
  if (!Array.isArray(body.data)) {
    throw new Error(`${label} returned an unrecognized response from ${url}.`)
  }
  return body.data.map((m) => ({ id: m.id, name: m.name }))
}

// ---------------------------------------------------------------------------
// generateGuarded — the only way this app is allowed to call a model
// ---------------------------------------------------------------------------

function hashPrompt(system: string | undefined, prompt: string): string {
  return createHash("sha256")
    .update(system ?? "")
    .update(" ")
    .update(prompt)
    .digest("hex")
    .slice(0, 16)
}

export interface GenerateGuardedParams {
  role: AiRole
  prompt: string
  system?: string
  /** Associates the call with a lead in the `events` log, when there is one. */
  leadId?: string
}

export interface GenerateGuardedTextResult {
  text: string
  latencyMs: number
}

export interface GenerateGuardedObjectResult<T> {
  object: T
  latencyMs: number
}

/**
 * A thin wrapper over the AI SDK's `generateObject` / `generateText` that
 * resolves the role to a model and logs every call — role, provider, model,
 * a hash of the prompt (never the prompt text itself), outcome, and latency
 * — to the `events` table via `logEvent`. Nothing this app sends to a model
 * should be unauditable.
 *
 * Pass `schema` for structured output (e.g. reply classification); omit it
 * for plain text (e.g. an email body). The overloads keep both call shapes
 * fully typed with no `any` at the boundary.
 */
export async function generateGuarded<T>(
  params: GenerateGuardedParams & { schema: z.ZodType<T>; schemaName?: string }
): Promise<GenerateGuardedObjectResult<T>>
export async function generateGuarded(
  params: GenerateGuardedParams
): Promise<GenerateGuardedTextResult>
export async function generateGuarded<T>(
  params: GenerateGuardedParams & { schema?: z.ZodType<T>; schemaName?: string }
): Promise<GenerateGuardedTextResult | GenerateGuardedObjectResult<T>> {
  const { role, prompt, system, leadId, schema, schemaName } = params
  const { providerId, modelId, model } = resolveRoleModel(role)
  const promptHash = hashPrompt(system, prompt)
  const startedAt = Date.now()

  const baseDetail = { role, providerId, modelId, promptHash }

  try {
    if (schema) {
      const result = await generateObject({ model, schema, schemaName, system, prompt })
      const latencyMs = Date.now() - startedAt
      logEvent("ai_call", {
        leadId,
        detail: { ...baseDetail, kind: "object", outcome: "ok", latencyMs },
      })
      return { object: result.object, latencyMs }
    }

    const result = await generateText({ model, system, prompt })
    const latencyMs = Date.now() - startedAt
    logEvent("ai_call", {
      leadId,
      detail: { ...baseDetail, kind: "text", outcome: "ok", latencyMs },
    })
    return { text: result.text, latencyMs }
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    const message = err instanceof Error ? err.message : String(err)
    logEvent("ai_call", {
      leadId,
      detail: {
        ...baseDetail,
        kind: schema ? "object" : "text",
        outcome: "error",
        latencyMs,
        error: message,
      },
    })
    throw err
  }
}
