/**
 * GET /api/models?providerId=<id>
 *
 * Server-only proxy to a provider's own model-catalogue endpoint (see
 * `listModels` in `lib/ai.ts`). This exists so API keys never reach the
 * browser: the Settings page's model selectors fetch this route, not the
 * provider directly.
 */

import { listModels, ModelListError } from "@/lib/ai"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get("providerId")

  if (!providerId) {
    return Response.json(
      { error: "Missing required query parameter: providerId." },
      { status: 400 }
    )
  }

  try {
    const models = await listModels(providerId)
    return Response.json({ models })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list models."
    // ModelListError carries the right status for caller-fault cases (an
    // unknown/stale providerId, a provider missing its key or base URL);
    // anything else is treated as an upstream problem (502), not ours (500).
    const status = err instanceof ModelListError ? err.status : 502
    return Response.json({ error: message }, { status })
  }
}
