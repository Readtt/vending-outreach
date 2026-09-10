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
import { formatCount } from "@/lib/format"
import { clearAllLeadsAction } from "./actions"

/**
 * Empties the lead list, so a run can be started over from a fresh search.
 *
 * Behind a confirmation rather than a single click: everything it deletes is
 * gone for good, and it sits next to the button people press all day. The
 * confirmation is one click on a dialog that names the number — no typing a
 * word to prove you meant it, because re-finding the businesses is a search
 * away and the irreversible part (who has already been emailed) is history,
 * not the ability to email them again.
 *
 * Hidden at zero, like `RetryAbandonedButton`: on an empty list it is a
 * button that does nothing, on the one screen that is trying to say "start by
 * finding some businesses".
 */
export function ClearLeadsButton({ count }: { count: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (count === 0) return null

  function handleClear() {
    startTransition(() => {
      clearAllLeadsAction()
        .then(({ leads }) => {
          setOpen(false)
          toast.success(
            `Cleared ${formatCount(leads)} business${leads === 1 ? "" : "es"}. Search again to find them.`
          )
          router.refresh()
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Could not clear the list."
          )
        )
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" variant="destructive" />}
        title="Delete every business on the list, so you can search for them again"
      >
        Clear all
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Clear all {formatCount(count)} business
            {count === 1 ? "" : "es"}?
          </DialogTitle>
          <DialogDescription>
            Deletes every business on the list, along with its emails, its
            queued jobs and its history. Running the same search again finds
            them, as though for the first time.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Your settings, your email accounts, and the never-email list are all
          kept.
        </p>

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="outline" />}
            disabled={isPending}
          >
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleClear}
            disabled={isPending}
          >
            {isPending ? "Clearing…" : `Clear ${formatCount(count)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
