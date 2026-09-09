"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { COUNTRIES, COUNTRY_LABELS, type Country } from "@/lib/geo"
import { findLocationsAction, importLeadsAction } from "./actions"
import { formatCount } from "@/lib/format"
import type {
  BusinessTypeOption,
  FindLocationsFormResult,
  TargetingDefaults,
} from "./types"

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "error"; message: string }
  | { status: "results"; result: FindLocationsFormResult }
  | { status: "imported"; inserted: number; skipped: number }

interface FindLocationsDialogProps {
  typeOptions: BusinessTypeOption[]
  /**
   * What Settings → "Who to find" says. The dialog opens on these and can be
   * changed for one search without saving anything back — which is what the
   * Settings copy has always promised, and what it did not do: every field
   * here started from a hardcoded default and the saved values went unread.
   */
  defaults: TargetingDefaults
}

export function FindLocationsDialog({
  typeOptions,
  defaults,
}: FindLocationsDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState(defaults.location)
  const [radiusMiles, setRadiusMiles] = useState(defaults.radiusMiles)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(defaults.businessTypes)
  )
  const [countries, setCountries] = useState<Country[]>(defaults.countries)
  const [state, setState] = useState<SearchState>({ status: "idle" })
  const [isPending, startTransition] = useTransition()

  /** Unticking the last country would leave nowhere to search, so the last
   * one ticked stays ticked. */
  function toggleCountry(code: Country) {
    setCountries((prev) =>
      prev.includes(code)
        ? prev.length > 1
          ? prev.filter((c) => c !== code)
          : prev
        : [...prev, code]
    )
  }

  function toggleType(id: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSearch() {
    setState({ status: "searching" })
    startTransition(() => {
      findLocationsAction({
        place,
        radiusMiles,
        types: Array.from(selectedTypes),
        countries,
      })
        .then((result) => setState({ status: "results", result }))
        .catch((err: unknown) =>
          setState({
            status: "error",
            message:
              err instanceof Error
                ? err.message
                : "The search did not work. Try again.",
          })
        )
    })
  }

  function handleImport(searchId: string) {
    startTransition(() => {
      importLeadsAction(searchId)
        .then(({ inserted, skipped }) => {
          setState({ status: "imported", inserted, skipped })
          toast.success(
            `Added ${formatCount(inserted)} business${inserted === 1 ? "" : "es"}. Research starts now.` +
              (skipped > 0
                ? ` ${formatCount(skipped)} were already on the list.`
                : "")
          )
          router.refresh()
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Could not add them."
          )
        )
    })
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Let the close animation run before resetting, so it doesn't flash.
      setTimeout(() => setState({ status: "idle" }), 150)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        Find businesses
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Find businesses</DialogTitle>
          <DialogDescription>
            Searches OpenStreetMap, a free public map, for businesses near a
            place. It can take 10–30 seconds.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="find-place">Town, ZIP, or postal code</Label>
            <Input
              id="find-place"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={
                countries.includes("CA")
                  ? "Columbus, OH — London, ON — K1A 0B1"
                  : "Columbus, OH or 43215"
              }
              disabled={state.status === "searching"}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Countries</Label>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {COUNTRIES.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={countries.includes(code)}
                    onChange={() => toggleCountry(code)}
                    disabled={state.status === "searching"}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {COUNTRY_LABELS[code]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Radius</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {radiusMiles} mi
              </span>
            </div>
            <Slider
              min={1}
              max={60}
              step={1}
              value={[radiusMiles]}
              onValueChange={(v) => setRadiusMiles(Array.isArray(v) ? v[0] : v)}
              disabled={state.status === "searching"}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Kinds of business</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {typeOptions.map((type) => (
                <label
                  key={type.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(type.id)}
                    onChange={() => toggleType(type.id)}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {type.label}
                </label>
              ))}
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          {state.status === "results" && (
            <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
              {/* Counts businesses, and only mentions a shortfall when one
                  actually exists. The old copy read the gap between Overpass's
                  element count and this one as "businesses you already have",
                  so a first-ever search on an empty Leads page announced sixty
                  businesses the user had never seen. */}
              <p>
                Found{" "}
                <strong className="tabular-nums">
                  {formatCount(state.result.distinctFound)}
                </strong>
                {state.result.resolvedPlace
                  ? ` near ${state.result.resolvedPlace}`
                  : ""}
                .
                {state.result.newCount > 0 &&
                  state.result.newCount < state.result.distinctFound && (
                    <>
                      {" "}
                      <strong className="tabular-nums">
                        {formatCount(state.result.newCount)}
                      </strong>{" "}
                      are new to you; the rest are already on your list.
                    </>
                  )}
              </p>
              {state.result.clamped && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                  The search area was trimmed to stay inside{" "}
                  {countries.map((c) => COUNTRY_LABELS[c]).join(" and ")}.
                </p>
              )}
              {state.result.newCount === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Nothing new. You already have all of these.
                </p>
              )}
            </div>
          )}

          {state.status === "imported" && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
              Added {formatCount(state.inserted)} business
              {state.inserted === 1 ? "" : "es"}. Research starts now.
              {state.skipped > 0
                ? ` ${formatCount(state.skipped)} were already on the list.`
                : ""}
            </div>
          )}

          {/* Both licences require the credit, and this is the screen the
              data is actually used on. GeoNames is what makes a Canadian
              postal code resolve at all — OpenStreetMap does not carry them,
              because Canada Post claims copyright over the list. */}
          <p className="text-xs text-muted-foreground">
            Businesses from{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              OpenStreetMap
            </a>{" "}
            (ODbL). Canadian postal code locations from{" "}
            <a
              href="https://www.geonames.org/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              GeoNames
            </a>{" "}
            (CC BY 4.0).
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {state.status === "imported" ? "Done" : "Cancel"}
          </DialogClose>
          {state.status !== "imported" && (
            <Button
              onClick={handleSearch}
              disabled={isPending || !place.trim()}
              variant={state.status === "results" ? "outline" : "default"}
            >
              {state.status === "searching"
                ? "Searching…"
                : state.status === "results"
                  ? "Search again"
                  : "Search"}
            </Button>
          )}
          {state.status === "results" && state.result.newCount > 0 && (
            <Button
              onClick={() => handleImport(state.result.searchId)}
              disabled={isPending}
            >
              {isPending
                ? "Adding…"
                : `Add ${formatCount(state.result.newCount)} business${state.result.newCount === 1 ? "" : "es"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
