"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { getSettingsStatusAction } from "./actions"
import type { SettingsStatus } from "./types"

/**
 * One line at the top of Settings answering "is this working right now?".
 *
 * It polls its own numbers instead of letting the page refresh underneath it,
 * because every section on this page is a form — a whole-page refresh while
 * someone is typing their address is worse than a slightly stale count.
 */
export function StatusBar({ initial }: { initial: SettingsStatus }) {
  const [status, setStatus] = useState(initial)

  useEffect(() => {
    const load = () => {
      if (document.visibilityState !== "visible") return
      getSettingsStatusAction()
        .then(setStatus)
        // A failed poll just means this line is briefly stale. Nothing is
        // broken and there is nothing for the reader to do, so say nothing.
        .catch(() => {})
    }
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [])

  const { engine, jobs, missing } = status

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              engine.running ? "bg-primary" : "bg-muted-foreground/50"
            )}
          />
          {engine.running ? (
            "Engine running"
          ) : (
            <span className="text-muted-foreground">
              Engine stopped. Start it with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                pnpm dev
              </code>
            </span>
          )}
        </span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <Count value={jobs.waiting} label="waiting" />
          <Count value={jobs.working} label="working" />
          {jobs.failed > 0 && (
            <span className="text-destructive">
              <Count value={jobs.failed} label="failed" />
            </span>
          )}
          <Count value={jobs.done} label="done" />
        </span>
      </div>

      {missing.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Still to fill in: {formatList(missing)}.
        </p>
      )}
    </div>
  )
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>{" "}
      {label}
    </span>
  )
}

/** "a, b and c" — reads like a sentence, because it is inside one. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}
