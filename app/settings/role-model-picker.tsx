"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  // Only what the user (or the saved setting) actually chose. Which provider
  // is *shown* is derived below, so that adding the very first provider
  // selects it instead of leaving the row blank until a reload — this
  // component is keyed by role, so it does not remount when `providers`
  // changes and initial state alone would never catch up.
  const [pickedProviderId, setPickedProviderId] = useState<string | null>(
    initial?.providerId ?? null
  )
  const [modelId, setModelId] = useState<string | undefined>(initial?.modelId)
  const [fetched, setFetched] = useState<FetchedModels | null>(null)
  const [, startTransition] = useTransition()

  // `null`, never `undefined`, when there is nothing to select. Base UI reads
  // `undefined` as "this Select is uncontrolled" and settles that on the
  // first render, so a picker that began with no providers and gained one
  // later flipped from uncontrolled to controlled and warned about it. `null`
  // is the controlled way to say nothing is selected.
  const providerId: string | null = pickedProviderId ?? providers[0]?.id ?? null

  const selectedProvider = providers.find((p) => p.id === providerId)
  const current =
    fetched && fetched.providerId === providerId ? fetched : undefined
  const loading = providerId !== null && current === undefined
  const models = current?.status === "ok" ? current.models : EMPTY_MODELS
  const error = current?.status === "error" ? current.message : null

  // Read inside the fetch callback below to decide whether a default is still
  // wanted by the time the catalogue arrives.
  const modelIdRef = useRef(modelId)
  useEffect(() => {
    modelIdRef.current = modelId
  })

  function save(nextModelId: string, forProviderId: string) {
    setModelId(nextModelId)
    startTransition(() => {
      saveRoleModelAction(role, forProviderId, nextModelId).catch(
        (err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Could not save.")
        }
      )
    })
  }

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
            message: body.error ?? "Could not load the model list.",
          })
          return
        }
        setFetched({ providerId, status: "ok", models: body.models })

        // Finish the setup rather than leaving three empty dropdowns behind.
        // Someone who has just pasted an API key has no way to know which of a
        // provider's models belongs in which job, and an unset role fails
        // hours later, at compose time, far from this page. This only ever
        // fills a blank; an existing choice is never overwritten.
        if (modelIdRef.current) return
        const pick = suggestDefaultModelId(
          role,
          body.models.map((m) => m.id)
        )
        if (pick) save(pick, providerId)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFetched({
          providerId,
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Could not load the model list.",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    providerId,
    role,
    selectedProvider?.apiKeyMasked,
    selectedProvider?.baseUrl,
  ])

  // Without this the closed dropdown shows the provider's internal id.
  const providerItems = useMemo(
    () => providers.map((p) => ({ value: p.id, label: p.label })),
    [providers]
  )

  const modelOptions: ComboboxOption[] = useMemo(
    () => models.map((m) => ({ value: m.id, label: m.name?.trim() || m.id })),
    [models]
  )

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
            items={providerItems}
            value={providerId}
            onValueChange={(next) => {
              if (!next) return
              setPickedProviderId(next)
              setModelId(undefined)
            }}
            disabled={providers.length === 0}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {providerItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Combobox
            className="w-48"
            options={modelOptions}
            value={modelId}
            onValueChange={(next) => providerId && save(next, providerId)}
            disabled={!providerId || loading}
            placeholder={loading ? "Loading…" : "Pick a model"}
            searchPlaceholder="Search models…"
            emptyText="No model matches."
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
