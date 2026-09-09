"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ModelSelectorContent,
  ModelSelectorRoot,
  ModelSelectorTrigger,
  type ModelOption,
} from "@/components/assistant-ui/elements/model-selector"
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  suggestDefaultModelId,
  type AiRole,
  type ModelSummary,
  type RoleModelSetting,
} from "@/lib/ai-roles"
import type { ProviderPublic } from "./types"
import { saveRoleModelAction } from "./actions"

interface RoleModelPickerProps {
  role: AiRole
  providers: ProviderPublic[]
  initial: RoleModelSetting | null
}

/**
 * The outcome of the most recent `/api/models` fetch, tagged with which
 * provider it's for. Deliberately one piece of state instead of separate
 * `loading`/`error`/`models` booleans-and-values kept in sync by hand: a
 * fetch in flight (or not yet started) for the current `providerId` is
 * derived at render time by comparing `fetched.providerId !== providerId`,
 * so nothing needs to synchronously setState "loading" from inside the
 * effect — only the eventual async result does, which is the pattern
 * `react-hooks/set-state-in-effect` actually wants.
 */
type FetchedModels =
  | { providerId: string; status: "ok"; models: ModelSummary[] }
  | { providerId: string; status: "error"; message: string }

// A single stable reference (not a fresh `[]` literal on every render) so it
// doesn't make the useMemo below think its input changed every time there's
// nothing loaded yet.
const EMPTY_MODELS: readonly ModelSummary[] = []

export function RoleModelPicker({
  role,
  providers,
  initial,
}: RoleModelPickerProps) {
  const [providerId, setProviderId] = useState<string | undefined>(
    initial?.providerId ?? providers[0]?.id
  )
  const [modelId, setModelId] = useState<string | undefined>(initial?.modelId)
  const [fetched, setFetched] = useState<FetchedModels | null>(null)
  const [, startTransition] = useTransition()

  const selectedProvider = providers.find((p) => p.id === providerId)
  const current =
    fetched && fetched.providerId === providerId ? fetched : undefined
  const loading = providerId !== undefined && current === undefined
  const models = current?.status === "ok" ? current.models : EMPTY_MODELS
  const error = current?.status === "error" ? current.message : null

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    fetch(`/api/models?providerId=${encodeURIComponent(providerId)}`)
      .then(async (res) => {
        const body = (await res.json()) as {
          models?: ModelSummary[]
          error?: string
        }
        if (cancelled) return
        if (!res.ok || !body.models) {
          setFetched({
            providerId,
            status: "error",
            message: body.error ?? "Failed to load models.",
          })
          return
        }
        setFetched({ providerId, status: "ok", models: body.models })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFetched({
          providerId,
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load models.",
        })
      })
    return () => {
      cancelled = true
    }
    // Re-fetch when the provider changes, or when its stored credentials
    // change under the same id (e.g. the user just pasted a new key). The
    // masked key / base URL strings change whenever the underlying secret
    // does, so they double as a cheap, safe re-fetch trigger — this is what
    // makes the dropdown repopulate after adding a key with no manual
    // refresh.
  }, [providerId, selectedProvider?.apiKeyMasked, selectedProvider?.baseUrl])

  const modelOptions: ModelOption[] = useMemo(
    () => models.map((m) => ({ id: m.id, name: m.name?.trim() || m.id })),
    [models]
  )

  const suggestion =
    !modelId && selectedProvider && models.length > 0
      ? suggestDefaultModelId(
          selectedProvider.kind,
          role,
          models.map((m) => m.id)
        )
      : undefined

  function handleProviderChange(next: string | null) {
    if (!next) return
    setProviderId(next)
    setModelId(undefined)
  }

  function handleModelChange(next: string) {
    setModelId(next)
    if (!providerId) return
    startTransition(() => {
      saveRoleModelAction(role, providerId, next).catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Failed to save.")
      })
    })
  }

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium">{ROLE_LABELS[role]}</div>
          <div className="text-xs text-muted-foreground">
            {ROLE_DESCRIPTIONS[role]}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={providerId}
            onValueChange={handleProviderChange}
            disabled={providers.length === 0}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ModelSelectorRoot
            models={modelOptions}
            value={modelId}
            onValueChange={handleModelChange}
          >
            <ModelSelectorTrigger
              className="w-48"
              disabled={!providerId || loading}
            >
              {loading ? "Loading…" : undefined}
            </ModelSelectorTrigger>
            <ModelSelectorContent searchable />
          </ModelSelectorRoot>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {suggestion && (
        <button
          type="button"
          onClick={() => handleModelChange(suggestion)}
          className="self-end text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Use suggested default: {suggestion}
        </button>
      )}
    </div>
  )
}
