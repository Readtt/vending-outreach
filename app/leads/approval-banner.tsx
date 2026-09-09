"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { approveAllHeldAction } from "./actions"

interface ApprovalBannerProps {
  heldCount: number
}

/**
 * The review gate for the first batch of emails.
 *
 * The first twenty researched leads get an email written but parked at `held`
 * (spec 9.2), and the send handler waits on them indefinitely. Nothing in the
 * app released them until this existed, so those leads sat forever with no
 * explanation — the queue looked busy and no email ever went out.
 *
 * It is worth reading them rather than clicking straight through: this batch
 * is the only cheap chance to notice the writing is wrong, before hundreds of
 * businesses see the same mistake.
 */
export function ApprovalBanner({ heldCount }: ApprovalBannerProps) {
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  if (heldCount === 0) return null

  function handleApproveAll() {
    startTransition(() => {
      approveAllHeldAction()
        .then(({ approved }) => {
          setConfirming(false)
          toast.success(
            `Approved ${approved} email${approved === 1 ? "" : "s"}. They will go out at the usual pace.`
          )
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Could not approve them."
          )
        )
    })
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {heldCount} email{heldCount === 1 ? "" : "s"} waiting for your OK
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Nothing goes out until you approve these. Open a few and read them
            first. This is the cheapest moment to catch bad writing, before the
            rest of your list gets the same email.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {confirming ? (
            <>
              <Button size="sm" onClick={handleApproveAll} disabled={isPending}>
                {isPending ? "Approving…" : `Yes, approve all ${heldCount}`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming(true)}
            >
              Approve all
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
