/**
 * The worker's only door to `lib/ai.ts`, and it is a lazy one.
 *
 * ## Why this file exists
 *
 * `lib/ai.ts` imports its siblings WITHOUT a file extension:
 *
 *     import { getSetting, ... } from "./db"      // lib/ai.ts:31
 *     export * from "./ai-roles"                 // lib/ai.ts:111
 *
 * Next's bundler resolves that. Plain Node does not — `node worker/main.ts`
 * fails with `ERR_MODULE_NOT_FOUND: .../lib/db`. Every other library the
 * worker touches (`db`, `mail-send`, `mail-receive`, `prompts`, `untrusted`,
 * `time`) already carries explicit `.ts` extensions and loads fine; `ai.ts`
 * and `ai-roles.ts` are the only two files in `lib/` that do not.
 *
 * The fix is to add the extensions in `lib/ai.ts`, which is out of scope for
 * this task (another agent owns that file). Until that lands, this module
 * quarantines the problem:
 *
 *  - the import is DYNAMIC, so `worker/main.ts` boots and the enrich, send,
 *    and inbound paths all work;
 *  - the specifier is typed `string`, so TypeScript does not resolve it and
 *    the ordinary type checking of the handlers is unaffected;
 *  - the failure, when a model is actually needed, names the exact edit.
 *
 * Tests inject `generateText` / `classifyReply` on the handler deps, so
 * nothing here is reached offline.
 */

import type { z } from "zod"

const AI_MODULE: string = "../../lib/ai.ts"

export type AiRoleName = "writer" | "triage" | "research"

interface GuardedTextParams {
  role: AiRoleName
  prompt: string
  system?: string
  leadId?: string
}

interface AiModuleShape {
  generateGuarded: (params: Record<string, unknown>) => Promise<unknown>
  getRoleModel: (
    role: AiRoleName
  ) => { providerId: string; modelId: string } | undefined
}

let cached: AiModuleShape | null = null

async function loadAi(): Promise<AiModuleShape> {
  if (cached !== null) return cached
  let mod: unknown
  try {
    mod = (await import(AI_MODULE)) as unknown
  } catch (err) {
    throw new Error(
      `the worker cannot load lib/ai.ts under plain Node: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `lib/ai.ts imports "./db" and "./ai-roles" without a ".ts" extension — ` +
        `Next's bundler resolves those, "node worker/main.ts" cannot. ` +
        `Adding the extensions in lib/ai.ts (and lib/ai-roles.ts) fixes it.`
    )
  }
  const shape = mod as Partial<AiModuleShape>
  if (
    typeof shape.generateGuarded !== "function" ||
    typeof shape.getRoleModel !== "function"
  ) {
    throw new Error(
      "lib/ai.ts does not export generateGuarded and getRoleModel as functions"
    )
  }
  cached = shape as AiModuleShape
  return cached
}

/** Whether a model is assigned to `role`, so a handler can dead-letter early. */
export async function hasRoleModel(role: AiRoleName): Promise<boolean> {
  const ai = await loadAi()
  return ai.getRoleModel(role) !== undefined
}

/** Plain-text generation: the email bodies. */
export async function generateGuardedText(
  params: GuardedTextParams
): Promise<{ text: string }> {
  const ai = await loadAi()
  const result = (await ai.generateGuarded({ ...params })) as { text: string }
  return { text: result.text }
}

/** Structured generation: the reply classification. */
export async function generateGuardedObject<T>(
  params: GuardedTextParams & { schema: z.ZodType<T>; schemaName?: string }
): Promise<{ object: T }> {
  const ai = await loadAi()
  const result = (await ai.generateGuarded({ ...params })) as { object: T }
  return { object: result.object }
}
