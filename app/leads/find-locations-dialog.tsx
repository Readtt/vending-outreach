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
import { findLocationsAction, importLeadsAction } from "./actions"
import type {
  BusinessTypeOption,
  FindLocationsFormResult,
  OsmCandidate,
} from "./types"

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "error"; message: string }
  | { status: "results"; result: FindLocationsFormResult }
  | { status: "imported"; inserted: number; skipped: number }

interface FindLocationsDialogProps {
  typeOptions: BusinessTypeOption[]
}

export function FindLocationsDialog({ typeOptions }: FindLocationsDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState("")
  const [radiusMiles, setRadiusMiles] = useState(15)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(typeOptions.map((t) => t.id))
  )
  const [state, setState] = useState<SearchState>({ status: "idle" })
  const [isPending, startTransition] = useTransition()

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
      })
        .then((result) => setState({ status: "results", result }))
        .catch((err: unknown) =>
          setState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Search failed. Try again.",
          })
        )
    })
  }

  function handleImport(candidates: OsmCandidate[]) {
    startTransition(() => {
      importLeadsAction(candidates)
        .then(({ inserted, skipped }) => {
          setState({ status: "imported", inserted, skipped })
          toast.success(
            `Imported ${inserted} lead${inserted === 1 ? "" : "s"} — enrichment queued.` +
              (skipped > 0 ? ` ${skipped} already known, skipped.` : "")
          )
          router.refresh()
        })
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Import failed.")
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
        Find locations
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Find locations</DialogTitle>
          <DialogDescription>
            Searches OpenStreetMap for nearby businesses. US only — a search
            outside the US is refused. This can take 10–30 seconds.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="find-place">City, state, or ZIP</Label>
            <Input
              id="find-place"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="Columbus, OH or 43215"
              disabled={state.status === "searching"}
            />
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
            <Label>Business types</Label>
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
              <p>
                Found{" "}
                <strong className="tabular-nums">
                  {state.result.totalFound}
                </strong>
                {state.result.resolvedPlace
                  ? ` near ${state.result.resolvedPlace}`
                  : ""}{" "}
                —{" "}
                <strong className="tabular-nums">
                  {state.result.newCount}
                </strong>{" "}
                new.
              </p>
              {state.result.clamped && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                  The search area was pulled back to US bounds — searches
                  outside the US are refused by design (CASL/GDPR).
                </p>
              )}
              {state.result.newCount === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Nothing new — every match is already a lead.
                </p>
              )}
            </div>
          )}

          {state.status === "imported" && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
              Imported {state.inserted} lead{state.inserted === 1 ? "" : "s"} —
              enrichment queued.
              {state.skipped > 0
                ? ` ${state.skipped} already known, skipped.`
                : ""}
            </div>
          )}
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
              onClick={() => handleImport(state.result.candidates)}
              disabled={isPending}
            >
              {isPending
                ? "Importing…"
                : `Import ${state.result.newCount} lead${state.result.newCount === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
