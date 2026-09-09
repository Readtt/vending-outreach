"use client"

import { useState, useTransition } from "react"
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
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { clearDryRunMessagesAction, setSendEnabledAction } from "./actions"

interface SendToggleProps {
  initialEnabled: boolean
  initialDryRunCount: number
}

export function SendToggle({
  initialEnabled,
  initialDryRunCount,
}: SendToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [dryRunCount, setDryRunCount] = useState(initialDryRunCount)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleCheckedChange(next: boolean) {
    if (next) {
      // Turning ON always goes through the confirmation dialog below —
      // never flips straight from a switch click.
      setConfirmOpen(true)
      return
    }
    startTransition(() => {
      setSendEnabledAction(false)
        .then(() => {
          setEnabled(false)
          toast.success(
            "Sending is off. Emails are saved as files instead of going out."
          )
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Could not turn sending off."
          )
        )
    })
  }

  function handleConfirmEnable() {
    startTransition(() => {
      setSendEnabledAction(true)
        .then(() => {
          setEnabled(true)
          setConfirmOpen(false)
          toast.success("Sending is on. Real emails will go out.")
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Could not turn sending on."
          )
        )
    })
  }

  function handleClearDryRun() {
    startTransition(() => {
      clearDryRunMessagesAction()
        .then((count) => {
          setDryRunCount(0)
          toast.success(
            count > 0
              ? `Deleted ${count} practice email${count === 1 ? "" : "s"}.`
              : "There were no practice emails to delete."
          )
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error
              ? err.message
              : "Could not delete the practice emails."
          )
        )
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="send-enabled">Send real emails</Label>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Real emails are going out from your Gmail account."
              : "Practice mode. Nothing leaves this computer."}
          </p>
        </div>
        <Switch
          id="send-enabled"
          checked={enabled}
          onCheckedChange={handleCheckedChange}
          disabled={isPending}
        />
      </div>

      {!enabled && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Nothing is being sent. Each email is saved in the{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs whitespace-nowrap">
            outbox-dryrun
          </code>{" "}
          folder as a file you can open and read in any email app.
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start sending real emails?</DialogTitle>
            <DialogDescription>
              From now on, real emails go out from your Gmail account.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
            <p>
              {dryRunCount > 0 ? (
                <>
                  You have{" "}
                  <strong>
                    {dryRunCount} practice email
                    {dryRunCount === 1 ? "" : "s"}
                  </strong>{" "}
                  saved in the <code className="text-xs">outbox-dryrun</code>{" "}
                  folder.
                </>
              ) : (
                "You have no practice emails saved right now."
              )}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Practice emails never block a real one from going out. Deleting
              them is just tidying up.
            </p>
            {dryRunCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={handleClearDryRun}
                disabled={isPending}
              >
                Delete practice emails
              </Button>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button onClick={handleConfirmEnable} disabled={isPending}>
              {isPending ? "Turning on…" : "Start sending"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
