"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { formatCount } from "@/lib/format"
import { retryAbandonedLeadsAction } from "./actions"

/**
 * Asks again about every lead that was given up on for a reason that has
 * since stopped applying.
 *
 * Shown only when there are some, because on a healthy list it is a button
 * that does nothing. The count is server-rendered rather than fetched, so it
 * is right on first paint.
 */
export function RetryAbandonedButton({ count }: { count: number }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  if (count === 0 || done) return null

  function handleClick() {
    startTransition(() => {
      retryAbandonedLeadsAction()
        .then(({ requeued }) => {
          setDone(true)
          toast.success(
            `Looking again at ${formatCount(requeued)} business${
              requeued === 1 ? "" : "es"
            }. This runs in the background.`
          )
          router.refresh()
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Could not start that."
          )
        )
    })
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={isPending}
      title="Businesses skipped because no address could be found. The search for one has since got better."
    >
      {isPending ? "Starting…" : `Look again at ${formatCount(count)} skipped`}
    </Button>
  )
}
