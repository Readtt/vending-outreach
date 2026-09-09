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
      rearmCircuitBreakerAction("Re-armed from the dashboard")
        .then(() => {
          setConfirming(false)
          toast.success("Circuit breaker re-armed. Sending can resume.")
        })
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to re-arm.")
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
          {isPending ? "Re-arming…" : "Confirm re-arm"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
      Re-arm
    </Button>
  )
}
