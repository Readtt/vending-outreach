"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { rearmCircuitBreakerAction } from "./actions"

export function RearmBreakerButton() {
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRearm() {
    startTransition(() => {
      rearmCircuitBreakerAction("Switched back on from the dashboard")
        .then(() => {
          setConfirming(false)
          toast.success("Safety limit cleared. Sending can start again.")
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Could not clear it."
          )
        )
    })
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleRearm}
          disabled={isPending}
        >
          {isPending ? "Clearing…" : "Yes, clear it"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
      Clear it
    </Button>
  )
}
